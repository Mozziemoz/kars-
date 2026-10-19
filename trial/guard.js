/* KARS trial lock. The build puts this in front of the app's own script and runs the app only while the trial is open.
   The start time is kept in four places (localStorage, a cookie, its own IndexedDB and, when the local server is running,
   a file on the PC). The earliest one wins, so clearing one of them does not restart the trial.
   A clock set back by more than a minute from the latest time seen ends the trial too. */
const TRIAL_MS = __TRIAL_MINUTES__ * 60e3;
const TRIAL_KEY = 'kars_t';
const TRIAL_CONTACT = __TRIAL_CONTACT__;

const trialIdb = (mode, val) => new Promise(ok => {
  try {
    const q = indexedDB.open('kars_t', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('t');
    q.onerror = () => ok(null);
    q.onsuccess = () => {
      try {
        const tx = q.result.transaction('t', mode), st = tx.objectStore('t');
        if (mode === 'readonly') { const g = st.get('t'); g.onsuccess = () => ok(g.result || null); g.onerror = () => ok(null); }
        else { st.put(val, 't'); tx.oncomplete = () => ok(true); tx.onerror = () => ok(null); }
      } catch (e) { ok(null); }
    };
  } catch (e) { ok(null); }
});
const trialParse = v => { try { const o = typeof v === 'string' ? JSON.parse(atob(v)) : v; return o && o.s > 0 && o.l > 0 ? o : null; } catch (e) { return null; } };
const trialCookie = () => { const m = document.cookie.match(/(?:^|; )kars_t=([^;]*)/); return m ? decodeURIComponent(m[1]) : null; };

async function trialState() {
  const now = Date.now();
  let server = null;
  try {
    if (/^https?:$/.test(location.protocol)) {
      const r = await fetch('/api/trial', { cache: 'no-store' });
      if (r.ok) server = await r.json();
    }
  } catch (e) {}
  let ls = null; try { ls = localStorage.getItem(TRIAL_KEY); } catch (e) {}
  const seen = [trialParse(ls), trialParse(trialCookie()), trialParse(await trialIdb('readonly'))].filter(Boolean);
  if (server && server.start > 0) seen.push({ s: server.start, l: server.last || server.start });
  const start = Math.min(now, ...seen.map(o => o.s));
  const last = Math.max(now, ...seen.map(o => o.l));
  const rewound = now < last - 60e3;
  const rec = { s: start, l: Math.max(now, last) }, enc = btoa(JSON.stringify(rec));
  try { localStorage.setItem(TRIAL_KEY, enc); } catch (e) {}
  try { document.cookie = `kars_t=${encodeURIComponent(enc)}; max-age=315360000; path=/; SameSite=Strict`; } catch (e) {}
  await trialIdb('readwrite', rec);
  const left = rewound || (server && server.ended) ? 0 : start + TRIAL_MS - now;
  return { left: Math.max(0, left) };
}

function trialLock() {
  if (document.getElementById('kars-trial-end')) return;
  for (const el of document.body.children) el.inert = true;
  const d = document.createElement('div');
  d.id = 'kars-trial-end';
  d.setAttribute('role', 'alertdialog');
  d.setAttribute('aria-modal', 'true');
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(11,14,18,.94);color:#F4F7FA;font:15px/1.5 system-ui,sans-serif;text-align:center';
  d.innerHTML = '<div style="max-width:440px"><div style="font:700 28px/1.2 system-ui,sans-serif;letter-spacing:.04em;margin-bottom:12px">Your KARS trial has ended</div>'
    + `<p style="margin:0 0 10px;color:#C9D1DA">The ${__TRIAL_MINUTES__}-minute trial is over. Your work is still saved in this browser and will be there when you get the full version.</p>`
    + '<p style="margin:0;color:#C9D1DA" id="kars-trial-contact"></p></div>';
  d.querySelector('#kars-trial-contact').textContent = TRIAL_CONTACT;
  document.body.appendChild(d);
  const stop = e => { if (!d.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
  ['keydown', 'keyup', 'pointerdown', 'click', 'paste', 'drop', 'dragover', 'wheel'].forEach(t => addEventListener(t, stop, true));
}

function trialBadge(endAt) {
  const b = document.createElement('div');
  b.id = 'kars-trial-badge';
  b.style.cssText = 'position:fixed;right:14px;top:60px;z-index:2147483646;padding:5px 10px;border-radius:6px;background:#C8102E;color:#fff;font:600 12px/1 system-ui,sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  document.body.appendChild(b);
  const tick = () => {
    const ms = endAt - Date.now();
    if (ms <= 0) { b.remove(); trialLock(); return false; }
    const m = Math.ceil(ms / 60e3);
    b.textContent = `Trial: ${m} min left`;
    return true;
  };
  tick();
  const iv = setInterval(() => { if (!tick()) clearInterval(iv); }, 5e3);
  /* recheck the stored times now and then, so a second tab or a changed clock is caught as well */
  setInterval(async () => { const st = await trialState(); if (st.left <= 0) trialLock(); }, 60e3);
}
