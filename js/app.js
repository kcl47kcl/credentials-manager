/* Credentials Manager — application UI. All DOM is built with textContent / createElement (no innerHTML of data). */
(function () {
  'use strict';
  const V = window.VaultCrypto, S = window.VaultStore;
  const APP_VERSION = '1.2.0';
  const MASTER_MIN_LEN = 15;      // NIST SP 800-63B-4 minimum for a single-factor password
  const MASTER_MIN_BITS = 60;
  const HISTORY_MAX = 10;
  const root = document.getElementById('app');

  /* =================================================================== helpers */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (['value', 'checked', 'disabled', 'selected', 'multiple'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  /** replaceChildren that skips null/false (replaceChildren would stringify them). */
  function put(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false).map(k => (k instanceof Node ? k : document.createTextNode(String(k))))); }
  const ICONS = {
    copy: 'M8 8h11v13H8zM5 3h11v3H7v12H5z', eye: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z',
    eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.3 3.8M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1',
    lock: 'M6 10V7a6 6 0 0112 0v3h1v11H5V10zm2 0h8V7a4 4 0 00-8 0z', plus: 'M11 4h2v16h-2zM4 11h16v2H4z',
    dice: 'M4 4h16v16H4zm4 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm8 7a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-4-3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
    menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z', back: 'M15 4l-8 8 8 8 1.4-1.4L9.8 12l6.6-6.6z',
    star: 'M12 2l3 7h7l-5.6 4.4L18.5 21 12 16.8 5.5 21l2.1-7.6L2 9h7z', ext: 'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z',
    key: 'M7 14a3 3 0 110-6 3 3 0 010 6zm5.6-4H22v4h-2v3h-3v-3h-4.4A5 5 0 1112.6 10z', user: 'M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z',
  };
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name]);
    if (name === 'eyeoff') { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); }
    svg.append(p);
    return svg;
  }
  function btn(label, onClick, cls, ic, title) {
    return h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: onClick, title: title || null, 'aria-label': title || null }, ic ? icon(ic) : null, label ? h('span', { text: label }) : null);
  }
  function now() { return Date.now(); }
  function fmtDate(ms) { return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function relTime(ms) {
    if (!ms) return 'never';
    const d = (now() - ms) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + ' min ago';
    if (d < 86400) return Math.floor(d / 3600) + ' h ago';
    return Math.floor(d / 86400) + ' days ago';
  }
  function hue(str) { let x = 0; for (const c of str || '?') x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 360; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 100000) : (v == null ? '' : String(v).slice(0, max || 100000)); }
  function safeUrl(u) {
    let s = str(u).trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try { const url = new URL(s); return /^https?:$/.test(url.protocol) ? url.href : null; } catch (e) { return null; }
  }
  function hostOf(u) { const s = safeUrl(u); try { return s ? new URL(s).hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; } }
  function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

  /* =================================================================== state */
  const DEFAULT_SETTINGS = {
    autoLockMin: 5, backgroundLockMin: 1, clipboardSec: 30,
    gen: { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, symbolSet: '', words: 6, separator: '-', capitalize: true, number: true, pinLength: 6 },
  };
  const state = {
    hasVault: false, session: null, payload: null,
    meta: { lastBackupAt: 0, changesSinceBackup: 0 },
    view: 'all', selectedId: null, editing: null, search: '', revealed: false,
    lastActivity: now(), hiddenAt: 0, failCount: 0, retryAt: 0,
  };
  const ui = {};
  let saveChain = Promise.resolve();
  let totpTimer = null;

  function settings() { return state.payload.settings; }
  function liveEntries() { return state.payload.entries.filter(e => !e.deleted && !e.trashedAt); }
  function liveGroups() { return state.payload.groups.filter(g => !g.deleted).sort((a, b) => a.name.localeCompare(b.name)); }
  function groupName(id) { const g = state.payload.groups.find(x => x.id === id && !x.deleted); return g ? g.name : ''; }
  function entryById(id) { return state.payload.entries.find(e => e.id === id && !e.deleted); }

  function newPayload() {
    const t = now();
    return {
      schema: 1, createdAt: t,
      groups: [{ id: V.uuid(), name: 'Personal', updatedAt: t }, { id: V.uuid(), name: 'Work', updatedAt: t }],
      entries: [], settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    };
  }
  function sanitizeEntry(e) {
    if (e.deleted) return { id: e.id, deleted: true, updatedAt: +e.updatedAt || 0 };
    const out = {
      id: e.id, title: str(e.title, 200), username: str(e.username, 500), password: str(e.password, 1000), notes: str(e.notes, 20000), totp: str(e.totp, 2000),
      urls: Array.isArray(e.urls) ? e.urls.map(u => str(u, 2000)).filter(Boolean).slice(0, 20) : [], groupId: str(e.groupId, 64), favorite: !!e.favorite,
      createdAt: +e.createdAt || 0, updatedAt: +e.updatedAt || 0, passwordUpdatedAt: +e.passwordUpdatedAt || 0,
      passwordSource: ['generated', 'manual', 'imported'].includes(e.passwordSource) ? e.passwordSource : 'manual',
      history: Array.isArray(e.history) ? e.history.filter(x => x && typeof x.password === 'string').map(x => ({ password: str(x.password, 1000), changedAt: +x.changedAt || 0 })).slice(-HISTORY_MAX) : [],
    };
    if (e.trashedAt) out.trashedAt = +e.trashedAt || 1;
    return out;
  }
  function normalizePayload(p) {
    p = p && typeof p === 'object' ? p : {};
    p.schema = 1;
    p.groups = (Array.isArray(p.groups) ? p.groups : []).filter(g => g && typeof g.id === 'string').map(g => g.deleted ? { id: g.id, deleted: true, updatedAt: +g.updatedAt || 0 }
      : { id: g.id, name: str(g.name, 60) || 'Group', updatedAt: +g.updatedAt || 0 });
    p.entries = (Array.isArray(p.entries) ? p.entries : []).filter(e => e && typeof e.id === 'string').map(sanitizeEntry);
    const s = p.settings && typeof p.settings === 'object' ? p.settings : {};
    p.settings = Object.assign({}, DEFAULT_SETTINGS, s, { gen: Object.assign({}, DEFAULT_SETTINGS.gen, s.gen || {}) });
    return p;
  }

  /** Re-encrypt and persist. Serialised so concurrent saves can't interleave. */
  function save(countChange) {
    const session = state.session, payload = state.payload;
    if (!session) return Promise.resolve();
    if (countChange !== false) state.meta.changesSinceBackup++;
    const meta = Object.assign({}, state.meta);
    saveChain = saveChain.then(async () => {
      const file = await V.seal(session, payload);
      await S.set('vault', file);
      await S.set('meta', meta);
    }).catch(e => toast('Save failed: ' + e.message, 'err'));
    return saveChain;
  }

  /* =================================================================== toasts & modals */
  function toast(msg, kind) {
    let host = document.getElementById('toasts');
    if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
    const t = h('div', { class: 'toast ' + (kind || ''), text: msg.charAt(0).toUpperCase() + msg.slice(1) });
    host.append(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3300);
  }

  function modal({ title, body, actions, wide, ref }) {
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      let done = false;
      const close = v => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); back.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
      const actionsEl = h('div', { class: 'modal-actions' });
      const dlg = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', { text: title }), h('div', { class: 'modal-body' }, body || null), actionsEl);
      const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(null); } }, dlg);
      for (const a of actions || [{ label: 'OK', value: true, kind: 'primary' }]) {
        actionsEl.append(btn(a.label, async () => {
          if (a.handler) { const r = await a.handler(); if (r === undefined) return; close(r); } else close(a.value);
        }, a.kind || ''));
      }
      if (ref) ref(close);
      document.addEventListener('keydown', onKey, true);
      document.body.append(back);
      const f = dlg.querySelector('input, textarea, select') || dlg.querySelector('.modal-actions .primary, .modal-actions .danger');
      if (f) setTimeout(() => f.focus(), 30);
      // Enter submits the primary action from single-line inputs
      dlg.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = actionsEl.querySelector('.primary, .danger'); if (p) { e.preventDefault(); p.click(); } }
      });
    });
  }
  function confirmBox(title, message, okLabel, danger) {
    return modal({ title, body: h('p', { text: message }), actions: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, kind: danger ? 'danger' : 'primary' }] });
  }
  function promptBox(title, label, opts) {
    opts = opts || {};
    const input = h('input', { type: opts.type || 'text', value: opts.value || '', placeholder: opts.placeholder || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'err' });
    return modal({
      title, body: [h('label', { class: 'field' }, h('span', { text: label }), input), opts.note ? h('p', { class: 'muted small', text: opts.note }) : null, err],
      actions: [{ label: 'Cancel', value: null }, {
        label: opts.ok || 'OK', kind: opts.danger ? 'danger' : 'primary', handler: async () => {
          if (!input.value && !opts.allowEmpty) { err.textContent = 'Required'; return undefined; }
          if (opts.validate) { const m = await opts.validate(input.value); if (m) { err.textContent = m; return undefined; } }
          return input.value;
        },
      }],
    });
  }

  /* =================================================================== clipboard */
  const clip = { until: 0, timer: null };
  async function copyText(text, label) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = h('textarea', { class: 'offscreen', value: text, readonly: true });
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.value = ''; ta.remove();
    }
    if (!ok) { toast('Copy failed — your browser blocked clipboard access', 'err'); return; }
    const sec = state.payload ? settings().clipboardSec : 30;
    if (sec > 0) {
      clip.until = now() + sec * 1000;
      clearTimeout(clip.timer);
      clip.timer = setTimeout(tryClearClipboard, sec * 1000 + 50);
      toast(`${label} copied · clears in ${sec}s`);
    } else toast(`${label} copied`);
  }
  async function tryClearClipboard(force) {
    if (!clip.until) return;
    if (!force && now() < clip.until) return;
    if (!document.hasFocus()) return; // retried on next interaction / visibility change
    try { await navigator.clipboard.writeText(''); clip.until = 0; } catch (e) { /* retry on next user gesture */ }
  }

  /* =================================================================== auto-lock */
  function markActivity() { state.lastActivity = now(); tryClearClipboard(false); }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, markActivity, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.hiddenAt = now();
    else { checkLock(); tryClearClipboard(false); state.hiddenAt = 0; }
  });
  window.addEventListener('pagehide', () => { if (state.session) lock(true); });
  setInterval(checkLock, 5000);
  function checkLock() {
    if (!state.session) return;
    const s = settings();
    if (s.autoLockMin > 0 && now() - state.lastActivity > s.autoLockMin * 60000) return lock(false, 'Locked after inactivity');
    if (state.hiddenAt && now() - state.hiddenAt >= s.backgroundLockMin * 60000) return lock(false, 'Locked while in background');
  }
  function lock(silent, reason) {
    tryClearClipboard(true);
    clearInterval(totpTimer); totpTimer = null;
    state.session = null; state.payload = null; state.editing = null; state.selectedId = null; state.revealed = false; state.search = '';
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    if (!silent) { render(); if (reason) toast(reason); }
  }

  /* =================================================================== boot */
  async function boot() {
    try {
      const file = await S.get('vault');
      state.hasVault = !!file;
      state.meta = Object.assign({ lastBackupAt: 0, changesSinceBackup: 0 }, (await S.get('meta')) || {});
    } catch (e) {
      put(root, h('div', { class: 'center-card' }, h('h1', { text: 'Storage unavailable' }), h('p', { text: e.message + '. Private browsing mode blocks storage; open the app in a normal window.' })));
      return;
    }
    render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  function render() {
    clearInterval(totpTimer); totpTimer = null;
    if (!state.hasVault) return renderWelcome();
    if (!state.session) return renderLock();
    renderMain();
  }

  /* =================================================================== welcome / setup / lock */
  function brand() { return h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('key')), h('div', {}, h('div', { class: 'brand-name', text: 'Credentials Manager' }), h('div', { class: 'brand-sub', text: 'Private, offline credential vault' }))); }

  function renderWelcome() {
    const fileIn = h('input', { type: 'file', class: 'offscreen', onchange: () => fileIn.files[0] && restoreFromFile(fileIn.files[0]) });
    put(root, h('div', { class: 'center-card' }, brand(),
      h('p', { text: 'No vault on this device yet.' }),
      h('div', { class: 'stack' },
        btn('Create a new vault', renderSetup, 'primary big'),
        btn('Restore from backup file (iCloud Drive)', () => fileIn.click(), 'big'),
      ), fileIn,
      h('p', { class: 'muted small', text: 'Use "Restore" on your second device to load the same vault you created on the first.' }),
    ));
  }

  function strengthMeter() {
    const bar = h('div', { class: 'bar' });
    const label = h('span', { class: 'meter-label' });
    const el = h('div', { class: 'meter' }, h('div', { class: 'track' }, bar), label);
    el.update = pw => {
      const bits = V.estimateBits(pw); const s = V.strengthLabel(bits);
      bar.style.width = Math.min(100, bits / 1.28) + '%';
      el.dataset.level = pw ? s.level : '';
      label.textContent = pw ? `${s.label} · ~${bits} bits` : '';
      return bits;
    };
    return el;
  }

  function renderSetup() {
    const pw = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Master password or passphrase' });
    const pw2 = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Type it again' });
    const ack = h('input', { type: 'checkbox' });
    const meter = strengthMeter();
    const err = h('div', { class: 'err' });
    const suggestion = h('div', { class: 'suggest' });
    pw.addEventListener('input', () => meter.update(pw.value));
    const showToggle = h('input', { type: 'checkbox', onchange: () => { pw.type = pw2.type = showToggle.checked ? 'text' : 'password'; } });
    const suggest = () => {
      const p = V.generatePassphrase({ words: 6, separator: '-', capitalize: true, number: true });
      put(suggestion, h('code', { class: 'pw-big', text: p.value }), h('span', { class: 'muted small', text: ` ~${Math.round(p.bits)} bits` }),
        btn('Use this', () => { pw.value = pw2.value = p.value; pw.type = pw2.type = 'text'; showToggle.checked = true; meter.update(p.value); }, 'small'));
    };
    const create = async () => {
      err.textContent = '';
      if (pw.value.length < MASTER_MIN_LEN) return (err.textContent = `Use at least ${MASTER_MIN_LEN} characters (a 6-word passphrase is ideal).`);
      if (V.estimateBits(pw.value) < MASTER_MIN_BITS) return (err.textContent = 'Too guessable. Try the suggested passphrase or a longer phrase.');
      if (pw.value !== pw2.value) return (err.textContent = 'The two entries do not match.');
      if (!ack.checked) return (err.textContent = 'Please confirm you understand the master password cannot be recovered.');
      createBtn.disabled = true; createBtn.textContent = 'Deriving key…';
      try {
        state.session = await V.createVault(pw.value);
        pw.value = pw2.value = '';
        state.payload = newPayload();
        state.meta = { lastBackupAt: 0, changesSinceBackup: 1, lastPasswordUnlockAt: now() };
        await S.set('vault', await V.seal(state.session, state.payload));
        await S.set('meta', state.meta);
        await S.persist();
        state.hasVault = true; state.lastActivity = now();
        render();
        const go = await modal({
          title: 'Save your first backup',
          body: [h('p', { text: 'Your vault is stored inside this browser. Save an encrypted backup to iCloud Drive now — it is your source of truth and how your other device gets the vault.' }),
            h('p', { class: 'muted small', text: 'The file is encrypted with your master password. Without the master password it is useless to anyone, including you.' })],
          actions: [{ label: 'Later', value: false }, { label: 'Save backup', value: true, kind: 'primary' }],
        });
        if (go) saveBackup();
      } catch (e) { err.textContent = e.message; createBtn.disabled = false; createBtn.textContent = 'Create vault'; }
    };
    const createBtn = btn('Create vault', create, 'primary big');
    put(root, h('div', { class: 'center-card' }, brand(),
      h('h1', { text: 'Choose a master password' }),
      h('p', { class: 'muted', text: 'This is the one secret you memorise. A random multi-word passphrase is both strong and easy to type on a phone.' }),
      btn('Suggest a passphrase', suggest, 'small', 'dice'), suggestion,
      h('label', { class: 'field' }, h('span', { text: 'Master password' }), pw), meter,
      h('label', { class: 'field' }, h('span', { text: 'Confirm' }), pw2),
      h('label', { class: 'check' }, showToggle, h('span', { text: 'Show password' })),
      h('label', { class: 'check' }, ack, h('span', { text: 'I understand: if I forget the master password, nobody can recover this vault.' })),
      err, h('div', { class: 'row' }, btn('Back', renderWelcome), createBtn),
    ));
    pw.focus();
  }

  /* =================================================================== Face ID / Touch ID (WebAuthn PRF) */
  const BIO_DAYS_DEFAULT = 14;
  function b64url(b64) { return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  const Bio = {
    label() {
      const ua = navigator.userAgent;
      if (/iPhone/.test(ua)) return 'Face ID';
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'Face ID / Touch ID';
      if (/Macintosh/.test(ua)) return 'Touch ID';
      return 'biometrics';
    },
    deviceName() {
      const ua = navigator.userAgent;
      if (/iPhone/.test(ua)) return 'iPhone';
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
      if (/Macintosh/.test(ua)) return 'Mac';
      return 'device';
    },
    /** null when usable, otherwise a human-readable reason. */
    async unsupportedReason() {
      if (!window.isSecureContext || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return 'Open the app from its HTTPS address (not a local file) to use passkeys.';
      if (!window.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) return 'This browser does not support passkeys.';
      try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return 'Face ID / Touch ID (or a device passcode) is not set up on this device.'; }
      catch (e) { return 'The device authenticator is not available.'; }
      try {
        if (PublicKeyCredential.getClientCapabilities) {
          const caps = await PublicKeyCredential.getClientCapabilities();
          if (caps && caps['extension:prf'] === false) return 'This browser lacks the passkey PRF extension (needs Safari 18+ on iOS 18 / macOS 15 or later).';
        }
      } catch (e) { /* capability query is optional */ }
      return null;
    },
    async record() {
      const [rec, file] = await Promise.all([S.get('bio'), S.get('vault')]);
      return rec && file && rec.v === 1 && rec.vaultId === file.vaultId ? rec : null;
    },
    passwordDue(rec) {
      const days = rec.maxDays || BIO_DAYS_DEFAULT;
      return !state.meta.lastPasswordUnlockAt || now() - state.meta.lastPasswordUnlockAt > days * 86400000;
    },
    async forget() {
      let rec = null;
      try { rec = await S.get('bio'); } catch (e) { /* ignore */ }
      if (!rec) return false;
      await S.del('bio');
      try { // Ask the passkey provider to drop the now-useless passkey (Signal API, Safari 26+/Chrome); best-effort.
        if (PublicKeyCredential.signalUnknownCredential) PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId: b64url(rec.credId) }).catch(() => {});
      } catch (e) { /* ignore */ }
      return true;
    },
    /** One WebAuthn assertion with PRF; returns the 32-byte PRF output. Must be called from a user gesture. */
    async prf(credIdB64, saltB64) {
      const cred = await navigator.credentials.get({ publicKey: {
        challenge: V.rand(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
        // 'internal' only: the cross-device QR flow does not deliver PRF results in Safari.
        allowCredentials: [{ type: 'public-key', id: V.unb64(credIdB64), transports: ['internal'] }],
        extensions: { prf: { eval: { first: V.unb64(saltB64) } } },
      } });
      const r = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults().prf : null;
      const first = r && r.results && r.results.first;
      if (!first) { const e = new Error('Your passkey provider did not return an unlock key (PRF). Use the master password.'); e.code = 'NO_PRF'; throw e; }
      return new Uint8Array(first);
    },
  };
  function bioErrorText(e) {
    if (e && e.name === 'NotAllowedError') return 'Cancelled or not recognised.';
    if (e && e.name === 'InvalidStateError') return 'A Credentials Manager passkey already exists for this device. Remove it in the Passwords app, then try again.';
    if (e && e.code === 'BAD_DEVICE_KEY') return 'The Face ID / Touch ID key no longer matches (was the passkey deleted?). Unlock with the master password and set it up again.';
    return (e && e.message) || String(e);
  }

  function enterVault(session, payload, viaPassword) {
    state.session = session; state.payload = normalizePayload(payload);
    state.failCount = 0; state.lastActivity = now(); state.hiddenAt = 0; state.view = 'all';
    if (viaPassword) { state.meta.lastPasswordUnlockAt = now(); S.set('meta', Object.assign({}, state.meta)).catch(() => {}); }
    render();
  }

  async function renderLock() {
    const rec = await Bio.record().catch(() => null);
    if (state.session || !state.hasVault) return; // state changed while awaiting
    const label = Bio.label();
    const pw = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Master password', 'aria-label': 'Master password' });
    const err = h('div', { class: 'err' });
    const bioDue = rec && Bio.passwordDue(rec);
    const bioAvailable = rec && !bioDue;
    const unlockBtn = btn('Unlock', () => doUnlock(), bioAvailable ? 'big' : 'primary big', 'lock');
    async function doUnlock() {
      if (!pw.value) { pw.focus(); return; }
      const wait = state.retryAt - now();
      if (wait > 0) return (err.textContent = `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`);
      unlockBtn.disabled = true; err.textContent = '';
      try {
        const file = await S.get('vault');
        const { session, payload } = await V.open(file, pw.value);
        pw.value = '';
        enterVault(session, payload, true);
      } catch (e) {
        state.failCount++;
        if (state.failCount >= 3) state.retryAt = now() + Math.min(300000, 5000 * Math.pow(2, state.failCount - 3));
        err.textContent = e.message; unlockBtn.disabled = false; pw.select();
      }
    }
    let bioBtn = null;
    async function doBioUnlock() {
      bioBtn.disabled = true; err.textContent = '';
      try {
        const file = await S.get('vault');
        const prf = await Bio.prf(rec.credId, rec.prfSalt);
        const dk = await V.deviceKeyFromPrf(prf, file.vaultId);
        prf.fill(0);
        const { session, payload } = await V.openWithDeviceKey(file, rec.wrapped, dk);
        state.bioFails = 0;
        enterVault(session, payload, false);
      } catch (e) {
        state.bioFails = (state.bioFails || 0) + 1;
        err.textContent = bioErrorText(e) + (e && e.name === 'NotAllowedError' ? ` Try ${label} again or use your master password.` : '')
          + (state.bioFails >= 2 ? ' If the “Credentials Manager” passkey was deleted, unlock with your password and choose Set up again in Settings.' : '');
        bioBtn.disabled = false;
      }
    }
    if (bioAvailable) bioBtn = btn(`Unlock with ${label}`, doBioUnlock, 'primary big', 'user');
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
    const fileIn = h('input', { type: 'file', class: 'offscreen', onchange: () => fileIn.files[0] && restoreFromFile(fileIn.files[0], true) });
    put(root, h('div', { class: 'center-card' }, brand(),
      h('h1', { text: 'Locked' }),
      bioBtn, bioBtn ? h('div', { class: 'or muted small', text: 'or use your master password' }) : null,
      bioDue ? h('p', { class: 'callout', text: `Enter your master password — ${label} unlock asks for it every ${rec.maxDays || BIO_DAYS_DEFAULT} days so you don’t forget it.` }) : null,
      pw, err, unlockBtn,
      h('details', { class: 'muted small' }, h('summary', { text: 'Other options' }),
        h('p', { text: 'Replace this device’s vault with a backup file (use only if this device’s copy is lost or wrong — to combine two copies, unlock and use Backup & Sync → Merge).' }),
        btn('Replace with backup file…', () => fileIn.click(), 'small danger-outline'), fileIn),
    ));
    if (!bioBtn) setTimeout(() => pw.focus(), 30);
  }

  async function enableBio() {
    const label = Bio.label();
    const reason = await Bio.unsupportedReason();
    if (reason) return toast(reason, 'err');
    let dekX = null;
    const pwd = await promptBox(`Turn on ${label} unlock`, 'Confirm your master password', {
      type: 'password', ok: 'Continue',
      validate: async v => { try { dekX = await V.unlockDekForExport(await S.get('vault'), v); return null; } catch (e) { return e.message; } },
    });
    if (pwd == null || !dekX) return;
    const vaultId = state.session.header.vaultId;
    const salt = V.rand(32);
    let credId = null;
    const finish = async prf => {
      const dk = await V.deviceKeyFromPrf(prf, vaultId);
      prf.fill(0);
      const wrapped = await V.wrapForDevice(dekX, dk, vaultId);
      dekX = null;
      await V.openWithDeviceKey(await S.get('vault'), wrapped, dk); // verify round trip before saving
      const old = await S.get('bio');
      if (old && old.credId && old.credId !== credId) {
        try { if (PublicKeyCredential.signalUnknownCredential) PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId: b64url(old.credId) }).catch(() => {}); } catch (e) { /* ignore */ }
      }
      await S.set('bio', { v: 1, vaultId, credId, prfSalt: V.b64(salt), wrapped, maxDays: (old && old.maxDays) || BIO_DAYS_DEFAULT, createdAt: now(), device: Bio.deviceName() });
      return true;
    };
    const errEl = h('div', { class: 'err' });
    // Step 1 (fresh tap): create a device passkey.
    const created = await modal({
      title: `Set up ${label}`,
      body: [h('p', { text: `Your ${Bio.deviceName()} will offer to save a passkey for “Credentials Manager”. Approve it with ${label}.` }),
        h('p', { class: 'muted small', text: 'The passkey never leaves your Apple devices. It unlocks the vault only on this device; backup files still need your master password.' }), errEl],
      actions: [{ label: 'Cancel', value: false }, {
        label: 'Continue', kind: 'primary', handler: async () => {
          errEl.textContent = '';
          try {
            const cred = await navigator.credentials.create({ publicKey: {
              rp: { name: 'Credentials Manager', id: location.hostname },
              user: { id: V.rand(16), name: `Credentials Manager (${Bio.deviceName()})`, displayName: `Credentials Manager – ${Bio.deviceName()} unlock` },
              challenge: V.rand(32), timeout: 60000, attestation: 'none',
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
              authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
              extensions: { prf: { eval: { first: salt } } },
            } });
            const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
            credId = V.b64(new Uint8Array(cred.rawId));
            if (!ext.prf || ext.prf.enabled === false) {
              try { if (PublicKeyCredential.signalUnknownCredential) PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId: b64url(credId) }).catch(() => {}); } catch (e) { /* ignore */ }
              errEl.textContent = 'This passkey provider does not support the PRF extension needed for unlocking. If a third-party password manager intercepted the prompt, choose iCloud Keychain instead.';
              return undefined;
            }
            return true;
          } catch (e) { errEl.textContent = bioErrorText(e); return undefined; }
        },
      }],
    });
    if (!created) { dekX = null; return; }
    // Step 2: dedicated assertion to obtain PRF bytes (try immediately; ask for a tap if the browser needs a new gesture).
    let done = false;
    try { done = await finish(await Bio.prf(credId, V.b64(salt))); } catch (e) { if (e && e.code === 'NO_PRF') { dekX = null; return toast(e.message, 'err'); } }
    if (!done) {
      const err2 = h('div', { class: 'err' });
      done = await modal({
        title: `Confirm ${label}`, body: [h('p', { text: `One more ${label} confirmation finishes setup.` }), err2],
        actions: [{ label: 'Cancel', value: false }, {
          label: `Confirm with ${label}`, kind: 'primary', handler: async () => {
            try { return await finish(await Bio.prf(credId, V.b64(salt))); } catch (e) { err2.textContent = bioErrorText(e); return undefined; }
          },
        }],
      });
    }
    dekX = null;
    if (done) { toast(`${label} unlock is on for this ${Bio.deviceName()}`); renderMain(); }
  }

  async function disableBio() {
    const label = Bio.label();
    if (!(await confirmBox(`Turn off ${label} unlock?`, `You will unlock with your master password on this ${Bio.deviceName()}. You can delete the “Credentials Manager” passkey in the Passwords app.`, 'Turn off', true))) return;
    await Bio.forget();
    toast(`${label} unlock turned off`);
    renderMain();
  }

  async function readVaultFile(file) {
    if (file.size > 50 * 1024 * 1024) throw new Error('File too large');
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not a Credentials Manager backup'); }
    V.validateFile(obj);
    return obj;
  }

  async function restoreFromFile(f, replacing) {
    try {
      const fileObj = await readVaultFile(f);
      if (replacing && !(await confirmBox('Replace this device’s vault?', 'Entries that exist only on this device and not in the backup will be lost. Consider unlocking and using Merge instead.', 'Replace', true))) return;
      let opened = null;
      const pwd = await promptBox('Unlock backup', 'Master password for this backup', {
        type: 'password', ok: 'Restore', validate: async v => { try { opened = await V.open(fileObj, v); return null; } catch (e) { return e.message; } },
      });
      if (pwd == null || !opened) return;
      const { session, payload } = opened;
      await S.set('vault', fileObj);
      await Bio.forget(); // a different vault/DEK may have been restored
      state.meta = { lastBackupAt: now(), changesSinceBackup: 0, lastPasswordUnlockAt: now() };
      await S.set('meta', state.meta);
      await S.persist();
      state.hasVault = true; state.session = session; state.payload = normalizePayload(payload);
      state.lastActivity = now(); state.view = 'all';
      render();
      toast(`Vault restored · ${liveEntries().length} logins`);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* =================================================================== main layout */
  const PAGES = ['security', 'trash', 'generator', 'settings'];

  function renderMain() {
    ui.nav = h('nav', { class: 'nav', 'aria-label': 'Groups' });
    ui.list = h('div', { class: 'list', role: 'list' });
    ui.detail = h('section', { class: 'detail', 'aria-live': 'polite' });
    ui.banner = h('div', { class: 'banner-slot' });
    ui.search = h('input', { type: 'search', class: 'search', placeholder: 'Search', value: state.search, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search',
      oninput: () => { state.search = ui.search.value; if (PAGES.includes(state.view)) { state.view = 'all'; renderMain(); ui.search.focus(); return; } renderList(); } });
    ui.listPane = h('main', { class: 'list-pane' },
      h('div', { class: 'topbar' },
        btn('', () => ui.shell.classList.toggle('nav-open'), 'icon only-mobile', 'menu', 'Menu'),
        ui.search,
        btn('', () => startEdit(null), 'icon primary', 'plus', 'New login'),
        btn('', () => lock(false, 'Locked'), 'icon', 'lock', 'Lock now')),
      ui.banner, ui.list);
    ui.page = h('main', { class: 'page-pane' });
    ui.shell = h('div', { class: 'shell' }, ui.nav, ui.listPane, ui.detail, ui.page,
      h('div', { class: 'scrim', onclick: () => ui.shell.classList.remove('nav-open') }));
    put(root, ui.shell);
    renderNav();
    if (PAGES.includes(state.view)) { ui.shell.classList.add('page-mode'); renderPage(); }
    else { renderBanner(); renderList(); renderDetail(); }
  }

  function setView(v) {
    state.view = v; state.selectedId = null; state.editing = null; state.revealed = false;
    if (!PAGES.includes(v)) { state.search = ''; }
    renderMain();
  }

  function renderNav() {
    const entries = liveEntries();
    const count = fn => entries.filter(fn).length;
    const item = (view, label, n, ic) => h('button', { type: 'button', class: 'nav-item' + (state.view === view ? ' active' : ''), onclick: () => setView(view) },
      ic ? icon(ic) : h('span', { class: 'dot' }), h('span', { class: 'nav-label', text: label }), n != null ? h('span', { class: 'count', text: String(n) }) : null);
    const trashN = state.payload.entries.filter(e => !e.deleted && e.trashedAt).length;
    const groupItems = liveGroups().map(g => {
      const it = item('group:' + g.id, g.name, count(e => e.groupId === g.id));
      it.querySelector('.dot').style.setProperty('--h', hue(g.name));
      return it;
    });
    put(ui.nav, 
      brand(),
      h('div', { class: 'nav-sec' }, item('all', 'All logins', entries.length, 'key'), item('fav', 'Favorites', count(e => e.favorite), 'star')),
      h('div', { class: 'nav-head' }, h('span', { text: 'Groups' }), btn('', addGroup, 'icon tiny', 'plus', 'New group')),
      h('div', { class: 'nav-sec' }, groupItems.length ? groupItems : h('p', { class: 'muted small pad', text: 'No groups' })),
      h('div', { class: 'nav-head' }, h('span', { text: 'Tools' })),
      h('div', { class: 'nav-sec' },
        item('generator', 'Password generator', null, 'dice'),
        item('security', 'Security check', securityStats().issues || null, 'user'),
        item('trash', 'Trash', trashN || null, 'back'),
        item('settings', 'Backup, sync & settings', null, 'lock')),
      h('div', { class: 'nav-foot muted small', text: 'v' + APP_VERSION + ' · offline · no network access' }),
    );
  }

  function renderBanner() {
    const m = state.meta;
    const stale = m.changesSinceBackup > 0 && (!m.lastBackupAt || now() - m.lastBackupAt > 86400000 || m.changesSinceBackup >= 10);
    put(ui.banner, stale ? h('div', { class: 'banner' },
      h('span', { text: m.lastBackupAt ? `${m.changesSinceBackup} change(s) since your last backup (${relTime(m.lastBackupAt)}).` : 'This vault has never been backed up.' }),
      btn('Save backup', saveBackup, 'small primary')) : '');
  }

  function filteredEntries() {
    const v = state.view;
    let list = liveEntries();
    if (v === 'fav') list = list.filter(e => e.favorite);
    else if (v.startsWith('group:')) list = list.filter(e => e.groupId === v.slice(6));
    const q = state.search.trim().toLowerCase();
    if (q) {
      const terms = q.split(/\s+/);
      list = list.filter(e => {
        const hay = [e.title, e.username, (e.urls || []).join(' '), groupName(e.groupId)].join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    return list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }

  function avatar(e) { const a = h('div', { class: 'avatar', text: (e.title || '?').trim().charAt(0).toUpperCase() || '?' }); a.style.setProperty('--h', hue(e.title)); return a; }

  function renderList() {
    const list = filteredEntries();
    const v = state.view;
    const title = v === 'all' ? 'All logins' : v === 'fav' ? 'Favorites' : groupName(v.slice(6)) || 'Group';
    const rows = list.map(e => h('div', { class: 'row-item' + (e.id === state.selectedId ? ' active' : ''), role: 'listitem' },
      h('button', { type: 'button', class: 'row-main', onclick: () => selectEntry(e.id) },
        avatar(e),
        h('div', { class: 'row-text' },
          h('div', { class: 'row-title' }, h('span', { text: e.title || '(untitled)' }), e.favorite ? h('span', { class: 'star', text: '★' }) : null),
          h('div', { class: 'row-sub', text: e.username || hostOf((e.urls || [])[0]) || '' })),
        h('div', { class: 'badges' }, e.totp ? h('span', { class: 'badge', text: '2FA' }) : null,
          e.password && e.passwordSource !== 'generated' ? h('span', { class: 'badge warn', title: 'Not yet replaced with a generated password', text: 'legacy' }) : null)),
      h('div', { class: 'row-quick' },
        e.username ? btn('', () => copyText(e.username, 'Username'), 'icon tiny', 'user', 'Copy username') : null,
        e.password ? btn('', () => copyText(e.password, 'Password'), 'icon tiny', 'copy', 'Copy password') : null)));
    put(ui.list, 
      h('div', { class: 'list-head' }, h('span', { text: state.search ? `Results in ${title}` : title }), h('span', { class: 'muted', text: String(list.length) })),
      ...(rows.length ? rows : [h('div', { class: 'empty' },
        h('p', { text: state.search ? 'No matches.' : 'Nothing here yet.' }),
        !state.search ? btn('Add a login', () => startEdit(null), 'primary') : null,
        !state.search && !liveEntries().length ? btn('Import from Apple Passwords / Chrome CSV', () => setView('settings'), '') : null)]),
    );
  }

  function selectEntry(id) {
    state.selectedId = id; state.editing = null; state.revealed = false;
    renderList(); renderDetail();
  }

  /* =================================================================== detail */
  function closeDetail() { state.selectedId = null; state.editing = null; ui.shell.classList.remove('detail-open'); renderList(); renderDetail(); }

  function fieldRow(label, valueNode, actions) {
    return h('div', { class: 'frow' }, h('div', { class: 'flabel', text: label }), h('div', { class: 'fval' }, valueNode), h('div', { class: 'factions' }, actions));
  }
  function colorizedPassword(pw) {
    return h('code', { class: 'pw-big' }, Array.from(pw).map(c => h('span', { class: /[0-9]/.test(c) ? 'cd' : /[A-Za-z]/.test(c) ? 'cl' : 'cs', text: c })));
  }

  function renderDetail() {
    clearInterval(totpTimer); totpTimer = null;
    if (state.editing) { ui.shell.classList.add('detail-open'); return renderEditor(); }
    const e = state.selectedId && entryById(state.selectedId);
    if (!e) { ui.shell.classList.remove('detail-open'); put(ui.detail, h('div', { class: 'empty big-empty' }, icon('key'), h('p', { text: 'Select a login, or press + to add one.' }))); return; }
    ui.shell.classList.add('detail-open');
    const urls = (e.urls || []).filter(Boolean);
    const pwNode = h('div', { class: 'pwbox' }, e.password ? (state.revealed ? colorizedPassword(e.password) : h('span', { class: 'mask', text: '••••••••••••' })) : h('span', { class: 'muted', text: '—' }));
    const totpCode = h('code', { class: 'totp' }), totpRing = h('span', { class: 'totp-left' });
    let totpCfg = null;
    if (e.totp) { try { totpCfg = V.parseTotp(e.totp); } catch (err) { totpCfg = null; } }
    const tickTotp = async () => {
      if (!totpCfg) return;
      const r = await V.totp(totpCfg);
      totpCode.textContent = r.code.length === 6 ? r.code.slice(0, 3) + ' ' + r.code.slice(3) : r.code;
      totpRing.textContent = r.remaining + 's';
      totpCode.dataset.code = r.code;
    };
    const legacy = e.password && e.passwordSource !== 'generated';
    const reused = e.password ? liveEntries().filter(x => x.id !== e.id && x.password === e.password).length : 0;
    put(ui.detail, 
      h('div', { class: 'detail-top' },
        btn('', closeDetail, 'icon only-mobile', 'back', 'Back'),
        avatar(e),
        h('div', { class: 'detail-title' }, h('h2', { text: e.title || '(untitled)' }), groupName(e.groupId) ? h('span', { class: 'chip', text: groupName(e.groupId) }) : null),
        btn('', () => { e.favorite = !e.favorite; e.updatedAt = now(); save(); renderNav(); renderList(); renderDetail(); }, 'icon' + (e.favorite ? ' on' : ''), 'star', e.favorite ? 'Unfavorite' : 'Favorite'),
        btn('Edit', () => startEdit(e), 'primary')),
      legacy ? h('div', { class: 'callout warn' }, h('span', { text: e.passwordSource === 'imported' ? 'Imported password — replace it with a generated one on the site, then update it here.' : 'This password was typed in, not generated. Consider rotating it.' }),
        btn('Rotate now', () => startEdit(e, true), 'small')) : null,
      reused ? h('div', { class: 'callout bad', text: `This password is reused in ${reused} other login(s).` }) : null,
      h('div', { class: 'fields' },
        fieldRow('Username', e.username ? h('span', { class: 'mono sel', text: e.username }) : h('span', { class: 'muted', text: '—' }), e.username ? btn('', () => copyText(e.username, 'Username'), 'icon', 'copy', 'Copy username') : null),
        fieldRow('Password', pwNode, e.password ? [
          btn('', () => { state.revealed = !state.revealed; renderDetail(); }, 'icon', state.revealed ? 'eyeoff' : 'eye', state.revealed ? 'Hide' : 'Reveal'),
          btn('', () => copyText(e.password, 'Password'), 'icon', 'copy', 'Copy password')] : null),
        e.password ? fieldRow('', h('span', { class: 'muted small', text: `${e.passwordSource === 'generated' ? 'Generated' : V.strengthLabel(V.estimateBits(e.password)).label} · changed ${relTime(e.passwordUpdatedAt)}` }), null) : null,
        totpCfg ? fieldRow('One-time code', h('div', { class: 'totp-wrap' }, totpCode, totpRing), btn('', () => copyText(totpCode.dataset.code || '', 'Code'), 'icon', 'copy', 'Copy code')) : null,
        e.totp && !totpCfg ? fieldRow('One-time code', h('span', { class: 'err', text: 'Invalid 2FA secret — edit to fix' }), null) : null,
        urls.length ? fieldRow('Website', h('div', { class: 'urls' }, urls.map(u => {
          const su = safeUrl(u);
          return su ? h('a', { href: su, target: '_blank', rel: 'noopener noreferrer', class: 'url' }, h('span', { text: hostOf(u) || u }), icon('ext')) : h('span', { text: u });
        })), btn('', () => copyText(urls[0], 'URL'), 'icon', 'copy', 'Copy URL')) : null,
        e.notes ? fieldRow('Notes', h('div', { class: 'notes', text: e.notes }), btn('', () => copyText(e.notes, 'Notes'), 'icon', 'copy', 'Copy notes')) : null,
      ),
      (e.history || []).length ? h('details', { class: 'history' }, h('summary', { text: `Password history (${e.history.length})` }),
        e.history.slice().reverse().map(hh => h('div', { class: 'hist-row' },
          h('span', { class: 'muted small', text: fmtDate(hh.changedAt) }),
          h('code', { class: 'mono hist-pw', text: state.revealed ? hh.password : '••••••••' }),
          btn('', () => copyText(hh.password, 'Old password'), 'icon tiny', 'copy', 'Copy old password')))) : null,
      h('div', { class: 'meta muted small' }, h('div', { text: 'Created ' + fmtDate(e.createdAt) }), h('div', { text: 'Modified ' + fmtDate(e.updatedAt) })),
      h('div', { class: 'detail-foot' }, btn('Move to Trash', async () => {
        if (!(await confirmBox('Move to Trash?', `"${e.title}" will be moved to Trash. You can restore it later.`, 'Move to Trash', true))) return;
        e.trashedAt = now(); e.updatedAt = now(); save(); closeDetail(); renderNav();
      }, 'danger-outline small')),
    );
    if (totpCfg) { tickTotp(); totpTimer = setInterval(tickTotp, 1000); }
  }

  /* =================================================================== editor */
  function startEdit(e, rotate) {
    const defGroup = state.view.startsWith('group:') ? state.view.slice(6) : (liveGroups()[0] || {}).id || '';
    state.editing = e ? {
      id: e.id, isNew: false, title: e.title, groupId: e.groupId || '', username: e.username || '', password: e.password || '',
      urls: (e.urls || []).join('\n'), totp: e.totp || '', notes: e.notes || '', favorite: !!e.favorite, generated: null, rotate: !!rotate,
    } : { id: V.uuid(), isNew: true, title: '', groupId: defGroup, username: '', password: '', urls: '', totp: '', notes: '', favorite: false, generated: null };
    if (PAGES.includes(state.view)) { state.view = 'all'; renderMain(); }
    renderDetail();
    if (rotate) setTimeout(() => openGeneratorFor(), 50);
  }

  let editorPwInput = null, editorMeter = null;
  function openGeneratorFor() {
    const d = state.editing;
    genModal(v => { d.password = v; d.generated = v; if (editorPwInput) { editorPwInput.value = v; editorPwInput.type = 'text'; editorMeter.update(v); } });
  }

  function renderEditor() {
    const d = state.editing;
    const bind = (k, el) => { el.addEventListener('input', () => { d[k] = el.type === 'checkbox' ? el.checked : el.value; }); return el; };
    const groupSel = bind('groupId', h('select', {}, h('option', { value: '', text: 'No group' }), liveGroups().map(g => h('option', { value: g.id, text: g.name, selected: g.id === d.groupId }))));
    groupSel.addEventListener('change', () => { d.groupId = groupSel.value; });
    const title = bind('title', h('input', { type: 'text', value: d.title, placeholder: 'e.g. Computacenter SSO, Bank of America', autocomplete: 'off' }));
    const user = bind('username', h('input', { type: 'text', value: d.username, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }));
    editorPwInput = bind('password', h('input', { type: 'password', value: d.password, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'mono' }));
    editorMeter = strengthMeter(); editorMeter.update(d.password);
    editorPwInput.addEventListener('input', () => editorMeter.update(editorPwInput.value));
    const urls = bind('urls', h('textarea', { rows: 2, placeholder: 'https://example.com  (one per line)', autocapitalize: 'off', spellcheck: 'false' }, d.urls));
    urls.value = d.urls;
    const totp = bind('totp', h('input', { type: 'text', value: d.totp, placeholder: 'Base32 secret or otpauth:// link (optional)', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'mono' }));
    const notes = bind('notes', h('textarea', { rows: 4, placeholder: 'Security questions, account numbers, recovery codes…' }));
    notes.value = d.notes;
    const fav = bind('favorite', h('input', { type: 'checkbox', checked: d.favorite }));
    const err = h('div', { class: 'err' });
    const cancel = () => { const wasNew = d.isNew; state.editing = null; if (wasNew) closeDetail(); else renderDetail(); };
    const submit = async () => {
      err.textContent = '';
      if (!d.title.trim()) { err.textContent = 'Title is required.'; title.focus(); return; }
      let totpVal = d.totp.trim();
      if (totpVal) { try { V.parseTotp(totpVal); } catch (e) { err.textContent = '2FA secret: ' + e.message; totp.focus(); return; } }
      const t = now();
      let e = entryById(d.id);
      if (!e) { e = { id: d.id, createdAt: t, history: [], passwordSource: null, passwordUpdatedAt: 0 }; state.payload.entries.push(e); }
      if (e.password !== d.password) {
        if (e.password) { e.history = (e.history || []).concat([{ password: e.password, changedAt: e.passwordUpdatedAt || e.updatedAt || t }]).slice(-HISTORY_MAX); }
        e.passwordSource = d.password && d.password === d.generated ? 'generated' : 'manual';
        e.passwordUpdatedAt = t;
      }
      Object.assign(e, {
        title: d.title.trim(), groupId: d.groupId, username: d.username.trim(), password: d.password,
        urls: d.urls.split(/\n+/).map(s => s.trim()).filter(Boolean), totp: totpVal, notes: d.notes, favorite: !!d.favorite, updatedAt: t,
      });
      state.editing = null; state.selectedId = e.id; state.revealed = false;
      await save();
      renderNav(); renderBanner(); renderList(); renderDetail();
      toast('Saved');
    };
    put(ui.detail, h('form', { class: 'editor', onsubmit: ev => { ev.preventDefault(); submit(); } },
      h('div', { class: 'detail-top' }, btn('', cancel, 'icon only-mobile', 'back', 'Cancel'), h('h2', { text: d.isNew ? 'New login' : 'Edit login' })),
      d.rotate ? h('div', { class: 'callout', text: 'Rotation: 1) generate a new password here, 2) Save, 3) copy it and change the password on the site. The old one stays in history.' }) : null,
      h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
      h('label', { class: 'field' }, h('span', { text: 'Group' }), groupSel),
      h('label', { class: 'field' }, h('span', { text: 'Username / email' }), user),
      h('div', { class: 'field' }, h('span', { text: 'Password' }),
        h('div', { class: 'input-row' }, editorPwInput,
          btn('', () => { editorPwInput.type = editorPwInput.type === 'password' ? 'text' : 'password'; }, 'icon', 'eye', 'Show/hide'),
          btn('Generate', openGeneratorFor, 'primary', 'dice'))),
      editorMeter,
      h('label', { class: 'field' }, h('span', { text: 'Website(s)' }), urls),
      h('label', { class: 'field' }, h('span', { text: 'Two-factor (TOTP) secret' }), totp),
      h('p', { class: 'muted small', text: 'Storing 2FA secrets here is convenient, but it puts both factors in one place. For your most critical accounts, keep 2FA in a separate authenticator app.' }),
      h('label', { class: 'field' }, h('span', { text: 'Notes' }), notes),
      h('label', { class: 'check' }, fav, h('span', { text: 'Favorite' })),
      err,
      h('div', { class: 'row end' }, btn('Cancel', cancel), h('button', { type: 'submit', class: 'btn primary', text: 'Save' })),
    ));
    (d.isNew ? title : editorPwInput).focus();
  }

  /* =================================================================== generator */
  function generatorWidget(onUse) {
    const g = settings().gen;
    const out = h('div', { class: 'gen-out' });
    const info = h('div', { class: 'muted small' });
    let current = '';
    const regen = () => {
      try {
        const r = g.mode === 'passphrase' ? V.generatePassphrase(g) : g.mode === 'pin' ? V.generatePin({ length: g.pinLength }) : V.generatePassword(g);
        current = r.value;
        put(out, colorizedPassword(r.value));
        const s = V.strengthLabel(r.bits);
        info.textContent = `${s.label} · ${Math.round(r.bits)} bits of entropy · ${r.value.length} characters`;
      } catch (e) { current = ''; put(out, h('span', { class: 'err', text: e.message })); info.textContent = ''; }
    };
    const persistGen = () => { save(false); };
    const opts = h('div', { class: 'gen-opts' });
    const num = (key, min, max, label) => {
      const r = h('input', { type: 'range', min, max, value: g[key] });
      const n = h('input', { type: 'number', min, max, value: g[key], class: 'num' });
      const set = v => { v = Math.max(min, Math.min(max, parseInt(v, 10) || min)); g[key] = v; r.value = v; n.value = v; regen(); persistGen(); };
      r.addEventListener('input', () => set(r.value)); n.addEventListener('change', () => set(n.value));
      return h('div', { class: 'field' }, h('span', { text: label }), h('div', { class: 'input-row' }, r, n));
    };
    const chk = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!g[key], onchange: ev => { g[key] = ev.target.checked; regen(); persistGen(); } }), h('span', { text: label }));
    const drawOpts = () => {
      if (g.mode === 'passphrase') {
        const sep = h('input', { type: 'text', value: g.separator, maxlength: 3, class: 'num', oninput: ev => { g.separator = ev.target.value; regen(); persistGen(); } });
        put(opts, num('words', 4, 12, 'Words'), h('label', { class: 'field' }, h('span', { text: 'Separator' }), sep), chk('capitalize', 'Capitalize words'), chk('number', 'Add a digit'));
      } else if (g.mode === 'pin') {
        put(opts, num('pinLength', 4, 12, 'Digits'));
      } else {
        const sym = h('input', { type: 'text', value: g.symbolSet, placeholder: V.SETS.symbols, class: 'mono', oninput: ev => { g.symbolSet = ev.target.value; regen(); persistGen(); } });
        put(opts, num('length', 8, 64, 'Length'),
          h('div', { class: 'checks' }, chk('upper', 'A–Z'), chk('lower', 'a–z'), chk('digits', '0–9'), chk('symbols', '!@#…'), chk('avoidAmbiguous', 'Avoid look-alikes (l 1 I O 0)')),
          g.symbols ? h('label', { class: 'field' }, h('span', { text: 'Allowed symbols (for picky sites; blank = default)' }), sym) : null);
      }
    };
    const tabs = h('div', { class: 'seg' }, [['password', 'Random'], ['passphrase', 'Passphrase'], ['pin', 'PIN']].map(([m, l]) =>
      h('button', { type: 'button', class: g.mode === m ? 'on' : '', onclick: ev => { g.mode = m; tabs.querySelectorAll('button').forEach(b => b.classList.remove('on')); ev.currentTarget.classList.add('on'); drawOpts(); regen(); persistGen(); } }, l)));
    drawOpts(); regen();
    return h('div', { class: 'gen' }, tabs, out, info,
      h('div', { class: 'row' }, btn('Regenerate', regen, '', 'dice'), btn('Copy', () => current && copyText(current, 'Password'), '', 'copy'), onUse ? btn('Use password', () => current && onUse(current), 'primary') : null),
      opts,
      h('p', { class: 'muted small', text: 'Generated with the browser’s cryptographic RNG (crypto.getRandomValues) using unbiased rejection sampling. NIST SP 800-63B-4 favours length over composition rules; 20+ random characters or 6+ words is plenty.' }));
  }
  function genModal(onUse) {
    let close = () => {};
    const w = generatorWidget(v => { onUse(v); close(true); });
    return modal({ title: 'Generate password', body: w, actions: [{ label: 'Close', value: null }], wide: true, ref: c => { close = c; } });
  }

  /* =================================================================== pages */
  function pageHeader(title, sub) {
    return h('div', { class: 'page-head' }, btn('', () => ui.shell.classList.toggle('nav-open'), 'icon only-mobile', 'menu', 'Menu'),
      h('div', {}, h('h1', { text: title }), sub ? h('p', { class: 'muted', text: sub }) : null),
      btn('', () => lock(false, 'Locked'), 'icon', 'lock', 'Lock now'));
  }
  function renderPage() {
    put(ui.page, );
    if (state.view === 'generator') ui.page.append(pageHeader('Password generator'), h('div', { class: 'card' }, generatorWidget(null)));
    else if (state.view === 'security') renderSecurity();
    else if (state.view === 'trash') renderTrash();
    else if (state.view === 'settings') renderSettings();
  }

  function securityStats() {
    const es = liveEntries().filter(e => e.password);
    const byPw = new Map();
    for (const e of es) { if (!byPw.has(e.password)) byPw.set(e.password, []); byPw.get(e.password).push(e); }
    const reused = es.filter(e => byPw.get(e.password).length > 1);
    const weak = es.filter(e => e.passwordSource !== 'generated' && V.estimateBits(e.password) < 60);
    const legacy = es.filter(e => e.passwordSource !== 'generated');
    const ids = new Set([...reused, ...weak].map(e => e.id));
    return { total: es.length, reused, weak, legacy, issues: ids.size };
  }

  function entryLinkList(list, note) {
    if (!list.length) return h('p', { class: 'ok small', text: '✓ ' + note });
    return h('div', { class: 'mini-list' }, list.sort((a, b) => a.title.localeCompare(b.title)).map(e => h('button', { type: 'button', class: 'mini-row', onclick: () => { state.view = 'all'; state.search = ''; state.selectedId = e.id; renderMain(); } },
      avatar(e), h('span', { text: e.title }), h('span', { class: 'muted small', text: e.username || '' }))));
  }

  function renderSecurity() {
    const s = securityStats();
    const done = s.total - s.legacy.length;
    const pct = s.total ? Math.round(done / s.total * 100) : 100;
    const bar = h('div', { class: 'bar' }); bar.style.width = pct + '%';
    ui.page.append(pageHeader('Security check', 'Everything is analysed locally — nothing leaves this device.'),
      h('div', { class: 'card' }, h('h3', { text: 'Migration progress' }),
        h('p', { text: `${done} of ${s.total} logins use a password generated by this vault (${pct}%).` }),
        h('div', { class: 'meter', 'data-level': '4' }, h('div', { class: 'track' }, bar)),
        h('p', { class: 'muted small', text: 'Goal: every login uses a unique, generated password. Open a "legacy" login and press Rotate now.' })),
      h('div', { class: 'card' }, h('h3', { text: `Reused passwords (${s.reused.length})` }), entryLinkList(s.reused, 'No password is used twice.')),
      h('div', { class: 'card' }, h('h3', { text: `Weak passwords (${s.weak.length})` }), entryLinkList(s.weak, 'No weak passwords.')),
      h('div', { class: 'card' }, h('h3', { text: `Legacy — not yet rotated (${s.legacy.length})` }), entryLinkList(s.legacy, 'All passwords were generated here.')),
    );
  }

  function renderTrash() {
    const items = state.payload.entries.filter(e => !e.deleted && e.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
    const purge = e => { const t = now(); Object.keys(e).forEach(k => { if (k !== 'id') delete e[k]; }); Object.assign(e, { deleted: true, updatedAt: t }); };
    ui.page.append(pageHeader('Trash', 'Deleted logins stay here until you remove them permanently.'),
      h('div', { class: 'card' }, items.length ? [
        ...items.map(e => h('div', { class: 'hist-row' }, avatar(e), h('span', { class: 'grow', text: e.title }), h('span', { class: 'muted small', text: fmtDate(e.trashedAt) }),
          btn('Restore', () => { delete e.trashedAt; e.updatedAt = now(); save(); renderMain(); toast('Restored'); }, 'small'),
          btn('Delete forever', async () => { if (await confirmBox('Delete permanently?', `"${e.title}" and its password history will be erased.`, 'Delete', true)) { purge(e); save(); renderMain(); } }, 'small danger-outline'))),
        h('div', { class: 'row end' }, btn('Empty Trash', async () => { if (await confirmBox('Empty Trash?', `${items.length} login(s) will be permanently erased.`, 'Empty Trash', true)) { items.forEach(purge); save(); renderMain(); } }, 'danger'))]
        : h('p', { class: 'muted', text: 'Trash is empty.' })));
  }

  /* =================================================================== backup / sync */
  async function saveBackup() {
    try {
      await saveChain;
      const file = await S.get('vault');
      const name = `Credentials-Manager-${stamp()}.vault.json`;
      const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
      const f = new File([blob], name, { type: 'application/json' });
      const touch = window.matchMedia('(pointer: coarse)').matches;
      let ok = false;
      if (touch && navigator.canShare && navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f] }); ok = true; } catch (e) { if (e.name === 'AbortError') return toast('Backup cancelled'); }
      }
      if (!ok) {
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: name, class: 'offscreen' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      state.meta.lastBackupAt = now(); state.meta.changesSinceBackup = 0;
      await S.set('meta', Object.assign({}, state.meta));
      if (state.session) { if (PAGES.includes(state.view)) renderPage(); else renderBanner(); }
      toast(touch ? 'Backup ready — choose "Save to Files" → iCloud Drive' : 'Backup saved — move it to your iCloud Drive vault folder');
    } catch (e) { toast('Backup failed: ' + e.message, 'err'); }
  }

  function mergeHistory(a, b) {
    const seen = new Set(), out = [];
    for (const x of [].concat(a || [], b || []).sort((p, q) => (p.changedAt || 0) - (q.changedAt || 0))) {
      if (!x || typeof x.password !== 'string' || seen.has(x.password)) continue;
      seen.add(x.password); out.push({ password: x.password, changedAt: x.changedAt || 0 });
    }
    return out.slice(-HISTORY_MAX);
  }
  /** Last-writer-wins per item (by updatedAt); tombstones propagate deletions; password histories are unioned. */
  function mergePayload(local, remote) {
    let added = 0, updated = 0;
    const mergeList = (L, R, isEntry) => {
      const map = new Map(L.map(x => [x.id, x]));
      for (const r of R || []) {
        if (!r || typeof r.id !== 'string') continue;
        const l = map.get(r.id);
        if (!l) { map.set(r.id, r); if (!r.deleted) added++; continue; }
        const remoteWins = (r.updatedAt || 0) > (l.updatedAt || 0);
        const win = remoteWins ? r : l, lose = remoteWins ? l : r;
        if (isEntry && !win.deleted) {
          const extra = lose.password && lose.password !== win.password ? [{ password: lose.password, changedAt: lose.passwordUpdatedAt || lose.updatedAt }] : [];
          win.history = mergeHistory(mergeHistory(win.history, lose.history), extra).filter(x => x.password !== win.password);
        }
        if (remoteWins) { map.set(r.id, win); updated++; }
      }
      return Array.from(map.values());
    };
    local.entries = mergeList(local.entries, remote.entries, true);
    local.groups = mergeList(local.groups, remote.groups, false);
    return { added, updated };
  }

  async function mergeFromFile(f) {
    try {
      const fileObj = await readVaultFile(f);
      const same = fileObj.vaultId === state.session.header.vaultId;
      let opened = null;
      const pwd = await promptBox('Merge backup', 'Master password for this backup file', {
        type: 'password', ok: 'Merge',
        note: same ? 'This backup is from the same vault.' : 'Note: this backup is from a different vault. Its logins will be added to this one.',
        validate: async v => { try { opened = await V.open(fileObj, v); return null; } catch (e) { return e.message; } },
      });
      if (pwd == null || !opened) return;
      const r = mergePayload(state.payload, normalizePayload(opened.payload));
      await save();
      renderMain();
      toast(`Merged · ${r.added} new, ${r.updated} updated item(s)`);
      if (r.added || r.updated) {
        const go = await confirmBox('Save merged backup?', 'Save a fresh backup so your other device can pick up the combined vault.', 'Save backup');
        if (go) saveBackup();
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  /* =================================================================== CSV import / export */
  function parseCSV(text) {
    const rows = []; let row = [], field = '', i = 0, q = false;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  }
  const COLS = {
    title: ['title', 'name', 'account', 'item name'],
    url: ['url', 'login_uri', 'website', 'web site', 'login url', 'origin_url'],
    username: ['username', 'login_username', 'login', 'user', 'email', 'user name', 'username_value'],
    password: ['password', 'login_password', 'pass', 'password_value'],
    notes: ['notes', 'note', 'extra', 'comments'],
    totp: ['otpauth', 'otp', 'totp', 'login_totp', 'otpauth url', 'one-time password'],
    group: ['folder', 'group', 'grouping', 'category', 'collections', 'vault'],
  };
  function csvToEntries(rows) {
    if (rows.length < 2) throw new Error('The CSV has no data rows');
    const head = rows[0].map(x => x.trim().toLowerCase());
    const idx = {};
    for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex(x => names.includes(x));
    if (idx.password < 0) throw new Error('Could not find a "password" column. Columns found: ' + rows[0].join(', '));
    return rows.slice(1).map(r => {
      const get = k => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      const url = get('url');
      return { title: get('title') || hostOf(url) || get('username') || 'Imported login', url, username: get('username'), password: r[idx.password] || '', notes: get('notes'), totp: get('totp'), group: get('group') };
    }).filter(e => e.password || e.username);
  }
  async function importCSV(f) {
    try {
      const items = csvToEntries(parseCSV(await f.text()));
      const hasGroups = items.some(x => x.group);
      const sel = h('select', {}, hasGroups ? h('option', { value: '__csv', text: 'Use the folder column from the file' }) : null,
        liveGroups().map(g => h('option', { value: g.id, text: g.name })), h('option', { value: '', text: 'No group' }));
      const go = await modal({
        title: `Import ${items.length} login(s)`,
        body: [h('p', { text: `Found ${items.length} logins in ${f.name}.` }), h('label', { class: 'field' }, h('span', { text: 'Put them in group' }), sel),
          h('p', { class: 'muted small', text: 'Exact duplicates (same site, username and password) are skipped. Imported passwords are flagged "legacy" so you can rotate them. Afterwards, delete the CSV file — it is unencrypted.' })],
        actions: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, kind: 'primary' }],
      });
      if (!go) return;
      const t = now();
      const groupIdFor = name => {
        if (!name) return '';
        let g = state.payload.groups.find(x => !x.deleted && x.name.toLowerCase() === name.toLowerCase());
        if (!g) { g = { id: V.uuid(), name: name.slice(0, 60), updatedAt: t }; state.payload.groups.push(g); }
        return g.id;
      };
      const existing = new Set(liveEntries().map(e => [hostOf((e.urls || [])[0]), e.username, e.password].join('\u0000')));
      let n = 0, skipped = 0;
      for (const it of items) {
        const key = [hostOf(it.url), it.username, it.password].join('\u0000');
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        let totp = '', notes = it.notes;
        if (it.totp) { try { V.parseTotp(it.totp); totp = it.totp; } catch (e) { notes = (notes ? notes + '\n' : '') + 'OTP (unparsed): ' + it.totp; } }
        state.payload.entries.push({
          id: V.uuid(), title: str(it.title, 200), username: str(it.username, 500), password: str(it.password, 1000), urls: it.url ? [str(it.url, 2000)] : [],
          notes: str(notes, 20000), totp, favorite: false, groupId: sel.value === '__csv' ? groupIdFor(it.group) : sel.value,
          createdAt: t, updatedAt: t, passwordUpdatedAt: t, passwordSource: 'imported', history: [],
        });
        n++;
      }
      await save();
      setView('all');
      toast(`Imported ${n} login(s)` + (skipped ? `, skipped ${skipped} duplicate(s)` : ''));
    } catch (e) { toast('Import failed: ' + e.message, 'err'); }
  }
  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  async function exportCSV() {
    const pwd = await promptBox('Export unencrypted CSV', 'Re-enter your master password', {
      type: 'password', ok: 'Export', danger: true,
      note: 'The CSV contains every password in plain text. Only use it to move to another password manager, and delete it right after.',
      validate: async v => { try { await V.open(await S.get('vault'), v); return null; } catch (e) { return e.message; } },
    });
    if (pwd == null) return;
    const lines = [['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth', 'Group'].join(',')];
    for (const e of liveEntries()) lines.push([e.title, (e.urls || [])[0] || '', e.username, e.password, e.notes, e.totp, groupName(e.groupId)].map(csvCell).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    const a = h('a', { href: url, download: `Credentials-Manager-export-${stamp()}.csv`, class: 'offscreen' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('CSV exported — delete it when done', 'err');
  }

  /* =================================================================== groups */
  async function addGroup() {
    const name = await promptBox('New group', 'Group name', { placeholder: 'e.g. Work, Banking, Family', validate: v => liveGroups().some(g => g.name.toLowerCase() === v.trim().toLowerCase()) ? 'A group with that name exists' : null });
    if (!name) return;
    const g = { id: V.uuid(), name: name.trim().slice(0, 60), updatedAt: now() };
    state.payload.groups.push(g);
    await save();
    setView('group:' + g.id);
  }
  async function renameGroup(g) {
    const name = await promptBox('Rename group', 'Group name', { value: g.name });
    if (!name) return;
    g.name = name.trim().slice(0, 60); g.updatedAt = now(); await save(); renderMain();
  }
  async function deleteGroup(g) {
    const members = liveEntries().filter(e => e.groupId === g.id);
    const sel = h('select', {}, h('option', { value: '', text: 'No group' }), liveGroups().filter(x => x.id !== g.id).map(x => h('option', { value: x.id, text: x.name })));
    const go = await modal({
      title: `Delete group "${g.name}"?`,
      body: members.length ? [h('p', { text: `${members.length} login(s) are in this group. Move them to:` }), sel] : h('p', { text: 'The group is empty.' }),
      actions: [{ label: 'Cancel', value: false }, { label: 'Delete group', value: true, kind: 'danger' }],
    });
    if (!go) return;
    const t = now();
    members.forEach(e => { e.groupId = sel.value; e.updatedAt = t; });
    g.deleted = true; g.updatedAt = t;
    await save(); renderMain();
  }

  /* =================================================================== settings */
  function renderSettings() {
    const s = settings(), m = state.meta;
    const vaultIn = h('input', { type: 'file', class: 'offscreen', onchange: () => { const f = vaultIn.files[0]; vaultIn.value = ''; if (f) mergeFromFile(f); } });
    const csvIn = h('input', { type: 'file', class: 'offscreen', accept: '.csv,text/csv,text/comma-separated-values', onchange: () => { const f = csvIn.files[0]; csvIn.value = ''; if (f) importCSV(f); } });
    const selectSetting = (key, options, label) => h('label', { class: 'field inline' }, h('span', { text: label }),
      h('select', { onchange: ev => { s[key] = Number(ev.target.value); save(false); toast('Setting saved'); } }, options.map(([v, l]) => h('option', { value: v, text: l, selected: s[key] === v }))));
    ui.page.append(pageHeader('Backup, sync & settings'),
      h('div', { class: 'card' }, h('h3', { text: 'Backup & sync (source of truth)' }),
        h('p', { text: `Last backup: ${m.lastBackupAt ? fmtDate(m.lastBackupAt) + ' (' + relTime(m.lastBackupAt) + ')' : 'never'} · changes since: ${m.changesSinceBackup}` }),
        h('div', { class: 'row wrap' }, btn('Save encrypted backup', saveBackup, 'primary'), btn('Merge from backup file…', () => vaultIn.click(), '')), vaultIn,
        h('ol', { class: 'small muted steps' },
          h('li', { text: 'Keep backups in one iCloud Drive folder, e.g. iCloud Drive › Credentials Manager. They are encrypted; your master password is the only key.' }),
          h('li', { text: 'To sync: on the device where you made changes, Save backup. On the other device, Merge from that file, then Save backup again.' }),
          h('li', { text: 'Merging is safe in any order: newer edits win per login, deletions carry over, and old passwords go to history.' }),
          h('li', { text: 'Recovery: on any new device open the app → Restore from backup file → master password. That’s all you need.' }))),
      h('div', { class: 'card' }, h('h3', { text: 'Import / export' }),
        h('p', { class: 'small', text: 'Import a CSV exported from Apple Passwords (File › Export All Passwords), Chrome, Edge, Firefox, Bitwarden, 1Password or LastPass.' }),
        h('div', { class: 'row wrap' }, btn('Import CSV…', () => csvIn.click(), ''), btn('Export unencrypted CSV…', exportCSV, 'danger-outline')), csvIn),
      h('div', { class: 'card' }, h('h3', { text: 'Groups' }),
        liveGroups().map(g => h('div', { class: 'hist-row' }, h('span', { class: 'grow', text: g.name }), h('span', { class: 'muted small', text: liveEntries().filter(e => e.groupId === g.id).length + ' logins' }),
          btn('Rename', () => renameGroup(g), 'small'), btn('Delete', () => deleteGroup(g), 'small danger-outline'))),
        btn('New group', addGroup, 'small', 'plus')),
      ui.bioCard = h('div', { class: 'card' }, h('h3', { text: Bio.label().replace(/^biometrics$/, 'Biometric') + ' unlock' }), h('p', { class: 'muted small', text: 'Checking…' })),
      h('div', { class: 'card' }, h('h3', { text: 'Security' }),
        selectSetting('autoLockMin', [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes']], 'Lock after inactivity'),
        selectSetting('backgroundLockMin', [[0, 'Immediately'], [1, '1 minute'], [2, '2 minutes'], [5, '5 minutes']], 'Lock when app is in background for'),
        selectSetting('clipboardSec', [[15, '15 seconds'], [30, '30 seconds'], [60, '60 seconds'], [120, '2 minutes'], [0, 'Never']], 'Clear clipboard after'),
        h('div', { class: 'row wrap' }, btn('Change master password…', changeMaster, ''))),
      h('div', { class: 'card' }, h('h3', { text: 'About this vault' }),
        h('ul', { class: 'small muted plain' },
          h('li', { text: `Key derivation: Argon2id, ${state.session.header.kdf.m / 1024} MiB memory, ${state.session.header.kdf.t} passes, parallelism ${state.session.header.kdf.p}, 128-bit random salt` }),
          h('li', { text: 'Encryption: AES-256-GCM with a random data key wrapped by your master key; vault header authenticated' }),
          h('li', { text: 'Network: the app’s Content-Security-Policy forbids all network connections' }),
          h('li', { text: 'Vault ID: ' + state.session.header.vaultId }),
          h('li', { text: `Stored: ${liveEntries().length} logins, ${liveGroups().length} groups` }))),
      h('div', { class: 'card danger-zone' }, h('h3', { text: 'Danger zone' }),
        h('p', { class: 'small', text: 'Remove the vault from this browser. Your backup files are not affected.' }),
        btn('Erase vault from this device…', eraseDevice, 'danger')),
    );
    fillBioCard(ui.bioCard);
  }

  async function fillBioCard(card) {
    const label = Bio.label();
    const [reason, rec] = await Promise.all([Bio.unsupportedReason(), Bio.record().catch(() => null)]);
    if (!card.isConnected || !state.session) return;
    const head = card.firstChild;
    if (rec) {
      const days = h('select', { onchange: async ev => { const r = await S.get('bio'); if (r) { r.maxDays = Number(ev.target.value); await S.set('bio', r); toast('Setting saved'); } } },
        [[7, '7 days'], [14, '14 days'], [30, '30 days']].map(([v, l]) => h('option', { value: v, text: l, selected: (rec.maxDays || BIO_DAYS_DEFAULT) === v })));
      put(card, head,
        h('p', { class: 'ok small', text: `✓ On for this ${rec.device || Bio.deviceName()} since ${fmtDate(rec.createdAt)}` }),
        h('label', { class: 'field inline' }, h('span', { text: 'Require master password every' }), days),
        h('p', { class: 'muted small', text: `Last master-password unlock: ${relTime(state.meta.lastPasswordUnlockAt)}. Changing the master password turns ${label} unlock off.` }),
        h('div', { class: 'row wrap' }, btn('Set up again', enableBio, 'small'), btn(`Turn off ${label}`, disableBio, 'small danger-outline')));
    } else if (reason) {
      put(card, head, h('p', { class: 'muted small', text: 'Not available here: ' + reason }));
    } else {
      put(card, head,
        h('p', { class: 'small', text: `Unlock with ${label} instead of typing your master password. Set it up separately on each device.` }),
        h('p', { class: 'muted small', text: `Uses a device passkey (WebAuthn PRF). If ${label} fails, your device passcode can approve it, so keep a strong device passcode.` }),
        btn(`Turn on ${label}`, enableBio, 'primary', 'user'));
    }
  }

  async function changeMaster() {
    const cur = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Current master password' });
    const n1 = h('input', { type: 'password', autocomplete: 'off', placeholder: 'New master password' });
    const n2 = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Confirm new password' });
    const meter = strengthMeter(); n1.addEventListener('input', () => meter.update(n1.value));
    const err = h('div', { class: 'err' });
    const ok = await modal({
      title: 'Change master password',
      body: [cur, n1, meter, n2, err, h('p', { class: 'muted small', text: 'Old backup files keep the OLD password. If you are changing it because it may be compromised, delete old backups after saving a new one.' })],
      actions: [{ label: 'Cancel', value: null }, {
        label: 'Change', kind: 'primary', handler: async () => {
          err.textContent = '';
          if (n1.value.length < MASTER_MIN_LEN || V.estimateBits(n1.value) < MASTER_MIN_BITS) { err.textContent = `New password must be at least ${MASTER_MIN_LEN} characters and hard to guess.`; return undefined; }
          if (n1.value !== n2.value) { err.textContent = 'New passwords do not match.'; return undefined; }
          try {
            await saveChain;
            state.session = await V.changePassword(await S.get('vault'), cur.value, n1.value);
            cur.value = n1.value = n2.value = '';
            await save();
            return true;
          } catch (e) { err.textContent = e.message; return undefined; }
        },
      }],
    });
    if (ok) {
      if (await Bio.forget()) toast(`Master password changed · ${Bio.label()} unlock was turned off — set it up again in Settings`);
      else toast('Master password changed');
      if (await confirmBox('Save a new backup?', 'Save a backup now so iCloud Drive has the vault under the new password.', 'Save backup')) saveBackup();
      renderMain();
    }
  }

  async function eraseDevice() {
    const v = await promptBox('Erase this device’s vault', 'Type ERASE to confirm', { ok: 'Erase', danger: true, validate: x => x === 'ERASE' ? null : 'Type ERASE in capitals' });
    if (v !== 'ERASE') return;
    await saveChain;
    await Bio.forget();
    await S.del('vault'); await S.del('meta');
    state.hasVault = false; state.meta = { lastBackupAt: 0, changesSinceBackup: 0 };
    lock(true); render(); toast('Vault erased from this device');
  }

  /* =================================================================== keyboard */
  document.addEventListener('keydown', e => {
    if (!state.session || document.querySelector('.modal-back')) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); if (PAGES.includes(state.view)) setView('all'); ui.search.focus(); }
    else if (e.key === 'Escape') {
      if (ui.shell.classList.contains('nav-open')) ui.shell.classList.remove('nav-open');
      else if (state.editing) { const d = state.editing; state.editing = null; d.isNew ? closeDetail() : renderDetail(); }
      else if (state.selectedId) closeDetail();
    }
  });

  // Exposed only for automated tests of pure functions (no secrets reachable through it).
  window.__credmgrTest = Object.freeze({ parseCSV, csvToEntries, mergePayload, safeUrl });

  boot();
})();
