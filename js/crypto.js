/*
 * Credentials Manager — cryptographic core.
 *
 * Design (see SECURITY.md for the full write-up):
 *   master password --NFKC--> Argon2id(m=64 MiB, t=3, p=1, 16-byte salt) --> 256-bit KEK
 *   random 256-bit Data Encryption Key (DEK), wrapped with the KEK using AES-256-GCM
 *   vault payload (JSON) encrypted with the DEK using AES-256-GCM, fresh 96-bit IV per save
 *   the vault header (format, version, vaultId, KDF params + salt) is bound as GCM
 *   additional authenticated data, so tampering with parameters is detected.
 *
 * Only Web Crypto (browser-native) and hash-wasm's Argon2id (WebAssembly) are used.
 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = global.crypto && global.crypto.subtle;

  const FORMAT = 'credmgr';
  const VERSION = 1;
  // Above the OWASP Password Storage Cheat Sheet floor (m=19 MiB, t=2, p=1).
  const KDF_DEFAULT = Object.freeze({ alg: 'argon2id', m: 65536, t: 3, p: 1 });
  const KDF_LIMITS = { mMin: 19456, mMax: 1048576, tMin: 1, tMax: 20, pMin: 1, pMax: 8 };

  /* ---------------- encoding helpers ---------------- */
  function b64(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    if (typeof str !== 'string') throw new Error('Bad base64');
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function rand(n) { return global.crypto.getRandomValues(new Uint8Array(n)); }
  function uuid() {
    if (global.crypto.randomUUID) return global.crypto.randomUUID();
    const b = rand(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** Unbiased integer in [0, max) using rejection sampling over a CSPRNG. */
  function randInt(max) {
    if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new Error('randInt range');
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    for (;;) {
      global.crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % max;
    }
  }

  /* ---------------- vault header / AAD ---------------- */
  function canonicalHeader(h) {
    // Fixed key order => deterministic bytes for AAD.
    return enc.encode(JSON.stringify({
      format: h.format, version: h.version, vaultId: h.vaultId,
      kdf: { alg: h.kdf.alg, m: h.kdf.m, t: h.kdf.t, p: h.kdf.p, salt: h.kdf.salt },
    }));
  }

  function validateFile(f) {
    if (!f || typeof f !== 'object') throw new Error('Not a vault file');
    if (f.format !== FORMAT) throw new Error('Not a Credentials Manager file');
    if (f.version !== VERSION) throw new Error('Unsupported vault version ' + f.version);
    const k = f.kdf || {};
    if (k.alg !== 'argon2id') throw new Error('Unsupported KDF');
    const L = KDF_LIMITS;
    if (!(k.m >= L.mMin && k.m <= L.mMax && k.t >= L.tMin && k.t <= L.tMax && k.p >= L.pMin && k.p <= L.pMax)) {
      throw new Error('KDF parameters outside the safe range');
    }
    if (unb64(k.salt).length < 16) throw new Error('Salt too short');
    for (const part of ['key', 'data']) {
      if (!f[part] || unb64(f[part].iv).length !== 12 || typeof f[part].ct !== 'string') throw new Error('Corrupt vault (' + part + ')');
    }
    if (typeof f.vaultId !== 'string') throw new Error('Corrupt vault (id)');
  }

  /* ---------------- key derivation ---------------- */
  async function deriveKEK(password, kdf) {
    if (!global.hashwasm || !global.hashwasm.argon2id) throw new Error('Argon2 library not loaded');
    const pw = enc.encode(String(password).normalize('NFKC'));
    const raw = await global.hashwasm.argon2id({
      password: pw, salt: unb64(kdf.salt), parallelism: kdf.p, iterations: kdf.t,
      memorySize: kdf.m, hashLength: 32, outputType: 'binary',
    });
    try {
      return await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey']);
    } finally { raw.fill(0); pw.fill(0); }
  }

  async function unwrapDEK(file, kek, extractable) {
    const aad = canonicalHeader(file);
    try {
      return await subtle.unwrapKey('raw', unb64(file.key.ct), kek,
        { name: 'AES-GCM', iv: unb64(file.key.iv), additionalData: aad },
        { name: 'AES-GCM', length: 256 }, !!extractable, ['encrypt', 'decrypt']);
    } catch (e) {
      const err = new Error('Wrong master password (or the vault file was modified)');
      err.code = 'BAD_PASSWORD';
      throw err;
    }
  }

  async function wrapDEK(dek, kek, header) {
    const iv = rand(12);
    const ct = await subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: canonicalHeader(header) });
    return { iv: b64(iv), ct: b64(ct) };
  }

  /* ---------------- vault lifecycle ---------------- */
  /** Session = { dek (non-extractable CryptoKey), header, key } — never contains the password. */
  async function createVault(password, kdfOverride) {
    const kdf = Object.assign({}, KDF_DEFAULT, kdfOverride || {}, { salt: b64(rand(16)) });
    const header = { format: FORMAT, version: VERSION, vaultId: uuid(), kdf };
    const kek = await deriveKEK(password, kdf);
    const dekTmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const key = await wrapDEK(dekTmp, kek, header);
    const file = Object.assign({}, header, { key, data: { iv: b64(rand(12)), ct: '' } });
    const dek = await unwrapDEK(file, kek, false); // session copy is non-extractable
    return { dek, header, key };
  }

  async function seal(session, payload) {
    const iv = rand(12);
    const pt = enc.encode(JSON.stringify(payload));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: canonicalHeader(session.header) }, session.dek, pt);
    pt.fill(0);
    return Object.assign({}, session.header, {
      key: session.key, data: { iv: b64(iv), ct: b64(ct) }, savedAt: new Date().toISOString(),
    });
  }

  async function decryptPayload(file, dek) {
    let payload;
    try {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.data.iv), additionalData: canonicalHeader(file) }, dek, unb64(file.data.ct));
      payload = JSON.parse(dec.decode(pt));
    } catch (e) {
      throw new Error('Vault data failed integrity check — the file is corrupted or was tampered with');
    }
    const header = { format: file.format, version: file.version, vaultId: file.vaultId, kdf: Object.assign({}, file.kdf) };
    return { session: { dek, header, key: file.key }, payload };
  }

  async function open(file, password) {
    validateFile(file);
    const kek = await deriveKEK(password, file.kdf);
    const dek = await unwrapDEK(file, kek, false);
    return decryptPayload(file, dek);
  }

  /* ---------------- device unlock (Face ID / Touch ID via WebAuthn PRF) ----------------
   * PRF output (32 bytes, never leaves memory) --HKDF-SHA256--> device key (AES-256-GCM, non-extractable)
   * device key wraps the same DEK. The wrapped DEK is stored only on this device (IndexedDB),
   * never in backup files. AAD binds it to the vault ID. */
  const DEVICE_INFO = 'credmgr-device-unlock-v1';
  function deviceAAD(vaultId) { return enc.encode(DEVICE_INFO + '|' + vaultId); }

  /** Extractable DEK for a few seconds during enrolment only (requires the master password). */
  async function unlockDekForExport(file, password) {
    validateFile(file);
    const kek = await deriveKEK(password, file.kdf);
    return unwrapDEK(file, kek, true);
  }
  async function deviceKeyFromPrf(prfBytes, vaultId) {
    const raw = prfBytes instanceof Uint8Array ? prfBytes : new Uint8Array(prfBytes);
    if (raw.length < 32) throw new Error('Authenticator returned a short PRF output');
    const ikm = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(DEVICE_INFO), info: enc.encode(vaultId) },
      ikm, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  }
  async function wrapForDevice(dekX, deviceKey, vaultId) {
    const iv = rand(12);
    const ct = await subtle.wrapKey('raw', dekX, deviceKey, { name: 'AES-GCM', iv, additionalData: deviceAAD(vaultId) });
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function openWithDeviceKey(file, wrapped, deviceKey) {
    validateFile(file);
    let dek;
    try {
      dek = await subtle.unwrapKey('raw', unb64(wrapped.ct), deviceKey, { name: 'AES-GCM', iv: unb64(wrapped.iv), additionalData: deviceAAD(file.vaultId) },
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } catch (e) {
      const err = new Error('The device unlock key no longer matches this vault');
      err.code = 'BAD_DEVICE_KEY';
      throw err;
    }
    return decryptPayload(file, dek);
  }

  /** Re-key the vault under a new master password (new salt; DEK re-wrapped). */
  async function changePassword(file, oldPassword, newPassword) {
    validateFile(file);
    const oldKek = await deriveKEK(oldPassword, file.kdf);
    const dekX = await unwrapDEK(file, oldKek, true);
    const kdf = Object.assign({}, KDF_DEFAULT, { salt: b64(rand(16)) });
    const header = { format: FORMAT, version: VERSION, vaultId: file.vaultId, kdf };
    const newKek = await deriveKEK(newPassword, kdf);
    const key = await wrapDEK(dekX, newKek, header);
    const tmp = Object.assign({}, header, { key });
    const dek = await unwrapDEK(tmp, newKek, false);
    return { dek, header, key };
  }

  /* ---------------- password generation ---------------- */
  const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
  };
  const AMBIGUOUS = new Set('Il1O0o|`\'"');

  function uniqChars(s) { return Array.from(new Set(Array.from(s))).join(''); }

  function generatePassword(o) {
    const length = Math.max(4, Math.min(128, o.length | 0));
    const classes = [];
    for (const name of ['lower', 'upper', 'digits', 'symbols']) {
      if (!o[name]) continue;
      let chars = name === 'symbols' && o.symbolSet ? uniqChars(o.symbolSet.replace(/\s/g, '')) : SETS[name];
      if (o.avoidAmbiguous) chars = Array.from(chars).filter(c => !AMBIGUOUS.has(c)).join('');
      if (chars) classes.push(chars);
    }
    if (!classes.length) throw new Error('Select at least one character type');
    const pool = uniqChars(classes.join(''));
    const poolArr = Array.from(pool);
    const mustHaveAll = length >= classes.length;
    for (let attempt = 0; attempt < 10000; attempt++) {
      let out = '';
      for (let i = 0; i < length; i++) out += poolArr[randInt(poolArr.length)];
      // Whole-password rejection keeps the result uniform over all valid passwords.
      if (!mustHaveAll || classes.every(cs => Array.from(out).some(c => cs.includes(c)))) {
        return { value: out, bits: length * Math.log2(poolArr.length) };
      }
    }
    throw new Error('Could not satisfy character requirements');
  }

  function generatePassphrase(o) {
    const words = global.EFF_WORDS;
    if (!words || words.length !== 7776) throw new Error('Wordlist not loaded');
    const n = Math.max(3, Math.min(20, o.words | 0));
    const parts = [];
    for (let i = 0; i < n; i++) {
      let w = words[randInt(words.length)];
      if (o.capitalize) w = w.charAt(0).toUpperCase() + w.slice(1);
      parts.push(w);
    }
    let bits = n * Math.log2(words.length);
    if (o.number) {
      const idx = randInt(n);
      parts[idx] = parts[idx] + String(randInt(10));
      bits += Math.log2(10) + Math.log2(n);
    }
    const sep = o.separator == null ? '-' : String(o.separator);
    return { value: parts.join(sep), bits };
  }

  function generatePin(o) {
    const n = Math.max(4, Math.min(32, o.length | 0));
    let s = '';
    for (let i = 0; i < n; i++) s += String(randInt(10));
    return { value: s, bits: n * Math.log2(10) };
  }

  /* ---------------- strength estimation ---------------- */
  // A short list of the most common passwords/base words (heavily penalised).
  const COMMON = new Set(('password passw0rd 123456 12345678 123456789 1234567890 qwerty qwertyuiop abc123 letmein ' +
    'welcome monkey dragon football baseball iloveyou admin login master sunshine princess shadow ' +
    'superman batman trustno1 starwars whatever freedom computer michael jennifer hunter ranger ' +
    'secret summer winter spring autumn changeme default root toor test guest p@ssw0rd p@ssword ' +
    '111111 000000 123123 654321 666666 121212 1q2w3e4r zaq12wsx asdfgh asdfghjkl iloveu').split(' '));
  let effSet = null;

  function estimateBits(pw) {
    if (!pw) return 0;
    const chars = Array.from(pw);
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += /[^\x20-\x7e]/.test(pw) ? 100 : 33;
    // Effective length: repeats and simple sequences count for little.
    let eff = chars.length ? 1 : 0;
    for (let i = 1; i < chars.length; i++) {
      const a = chars[i - 1].codePointAt(0), b = chars[i].codePointAt(0);
      eff += (a === b || b === a + 1 || b === a - 1) ? 0.25 : 1;
    }
    const lower = pw.toLowerCase();
    // Embedded common words count as roughly one "symbol" each.
    for (const w of COMMON) {
      if (w.length >= 5) { let i = lower.indexOf(w); while (i >= 0) { eff -= w.length - 1; i = lower.indexOf(w, i + w.length); } }
    }
    eff = Math.max(eff, 1);
    let bits = eff * Math.log2(Math.max(pool, 2));
    // Repetition of a shorter unit ("abc123abc123") is worth little more than the unit itself.
    for (let u = 1; u <= chars.length / 2; u++) {
      const unit = chars.slice(0, u).join('');
      if (chars.length % u === 0 && pw === unit.repeat(chars.length / u)) { bits = Math.min(bits, estimateBits(unit) + 2); break; }
    }
    const stripped = lower.replace(/[^a-z]/g, '');
    if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(lower.replace(/[0-9!@#$%^&*.]+$/, ''))) bits = Math.min(bits, 12);
    // Token model: dictionary-looking words are worth ~14 bits each, not ~5 bits per letter.
    const toks = pw.match(/[A-Z]?[a-z]+|[A-Z]+|[0-9]+|[^A-Za-z0-9]+/g) || [];
    let tokBits = 0;
    const seenSep = new Set();
    for (const t of toks) {
      if (/^[^A-Za-z0-9]$/.test(t)) { if (seenSep.has(t)) continue; seenSep.add(t); }
      if (/^[A-Z]?[a-z]{2,}$/.test(t) && /[aeiouy]/i.test(t)) tokBits += Math.min(14 + (/[A-Z]/.test(t) ? 1 : 0), t.length * Math.log2(26));
      else if (/^[0-9]+$/.test(t)) tokBits += t.length * Math.log2(10);
      else if (/^[^A-Za-z0-9]+$/.test(t)) tokBits += new Set(t).size === 1 ? Math.log2(33) : t.length * Math.log2(33);
      else tokBits += t.length * Math.log2(Math.max(pool, 2));
    }
    if (toks.length) bits = Math.min(bits, tokBits);
    // Passphrase detection: if it is all EFF words, estimate per-word, not per-char.
    if (global.EFF_WORDS) {
      if (!effSet) effSet = new Set(global.EFF_WORDS);
      const parts = lower.split(/[^a-z]+/).filter(Boolean);
      if (parts.length >= 2 && parts.every(p => effSet.has(p))) {
        const wordBits = parts.length * Math.log2(7776) + (/[0-9]/.test(pw) ? 3.3 : 0);
        bits = Math.min(bits, wordBits);
      }
    }
    return Math.max(0, Math.round(bits));
  }

  function strengthLabel(bits) {
    if (bits < 40) return { label: 'Very weak', level: 0 };
    if (bits < 60) return { label: 'Weak', level: 1 };
    if (bits < 80) return { label: 'Good', level: 2 };
    if (bits < 100) return { label: 'Strong', level: 3 };
    return { label: 'Excellent', level: 4 };
  }

  /* ---------------- TOTP (RFC 6238) ---------------- */
  function base32Decode(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = s.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
    if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('Invalid base32 secret');
    let bits = 0, value = 0;
    const out = [];
    for (const c of clean) {
      value = (value << 5) | A.indexOf(c); bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  function parseTotp(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    const cfg = { secret: '', algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' };
    if (/^otpauth:\/\//i.test(s)) {
      const u = new URL(s);
      if (u.host.toLowerCase() !== 'totp') throw new Error('Only TOTP (time-based) codes are supported');
      const q = u.searchParams;
      cfg.secret = (q.get('secret') || '').replace(/\s/g, '');
      const alg = (q.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
      cfg.algorithm = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[alg];
      if (!cfg.algorithm) throw new Error('Unsupported TOTP algorithm');
      cfg.digits = parseInt(q.get('digits') || '6', 10);
      cfg.period = parseInt(q.get('period') || '30', 10);
      cfg.issuer = q.get('issuer') || '';
      cfg.account = decodeURIComponent(u.pathname.replace(/^\//, ''));
    } else {
      cfg.secret = s.replace(/\s/g, '');
    }
    if (![6, 7, 8].includes(cfg.digits)) throw new Error('Unsupported TOTP digits');
    if (!(cfg.period >= 10 && cfg.period <= 300)) throw new Error('Unsupported TOTP period');
    base32Decode(cfg.secret); // validate
    return cfg;
  }

  async function totpRaw(keyBytes, algorithm, digits, counter) {
    const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: algorithm }, false, ['sign']);
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
    const mac = new Uint8Array(await subtle.sign('HMAC', key, msg));
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % Math.pow(10, digits)).padStart(digits, '0');
  }

  async function totp(input, nowMs) {
    const cfg = typeof input === 'string' ? parseTotp(input) : input;
    const now = nowMs == null ? Date.now() : nowMs;
    const counter = Math.floor(now / 1000 / cfg.period);
    const code = await totpRaw(base32Decode(cfg.secret), cfg.algorithm, cfg.digits, counter);
    const remaining = cfg.period - Math.floor(now / 1000) % cfg.period;
    return { code, remaining, period: cfg.period };
  }

  global.VaultCrypto = Object.freeze({
    FORMAT, VERSION, KDF_DEFAULT, b64, unb64, rand, randInt, uuid,
    createVault, seal, open, changePassword, validateFile,
    unlockDekForExport, deviceKeyFromPrf, wrapForDevice, openWithDeviceKey,
    generatePassword, generatePassphrase, generatePin, SETS,
    estimateBits, strengthLabel, parseTotp, totp, totpRaw, base32Decode,
  });
})(typeof window !== 'undefined' ? window : globalThis);
