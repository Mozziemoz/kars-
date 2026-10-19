// Builds the KARS trial: a copy of KARS that locks itself after a set time, with its code minified so it is hard to read or edit.
// Run from the repository root:  bun trial/build.mjs
// Options (environment variables): TRIAL_MINUTES (default 30), TRIAL_CONTACT (the line shown when the trial ends).
// Output: dist/kars-trial/ and dist/kars-trial.zip, ready to send.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'dist', 'kars-trial');
const MINUTES = Math.max(1, +process.env.TRIAL_MINUTES || 30);
const CONTACT = process.env.TRIAL_CONTACT || 'Contact the KARS owner to get the full version.';
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'kars-trial-'));

const read = f => fs.readFile(path.join(ROOT, f), 'utf8');
/* replace exactly one occurrence, so a change to the app that moves an anchor stops the build instead of making a broken trial */
const swap = (src, from, to, what) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`build-trial: expected 1 match for ${what}, found ${n}`);
  return src.replace(from, () => to);
};

async function minify(code, target, format) {
  const entry = path.join(TMP, `entry-${target}.js`);
  await fs.writeFile(entry, code);
  const r = await Bun.build({ entrypoints: [entry], target, format, minify: true });
  if (!r.success) throw new Error('build-trial: minify failed\n' + r.logs.join('\n'));
  return (await r.outputs[0].text()).trim();
}

/* ---- page ---- */
let html = await read('kars.html');
const OPEN = '<script>\nconst $=id=>', CLOSE = '\n</script>\n<script>/* presentation only';
const a = html.indexOf(OPEN), b = html.indexOf(CLOSE);
if (a < 0 || b < a) throw new Error('build-trial: could not find the main script in kars.html');
const app = html.slice(a + '<script>\n'.length, b);
const guard = (await read('trial/guard.js'))
  .replaceAll('__TRIAL_MINUTES__', String(MINUTES))
  .replace('__TRIAL_CONTACT__', JSON.stringify(CONTACT));
const page = `${guard}
(async () => {
  const st = await trialState();
  if (st.left <= 0) { trialLock(); return; }
  trialBadge(Date.now() + st.left);
${app}
})();`;
const js = await minify(page, 'browser', 'iife');
html = html.slice(0, a) + '<script>' + js.replace(/<\/script/gi, '<\\/script') + html.slice(b + 1);
html = html.replace(/\/\*[\s\S]*?\*\//g, m => (m.includes('</') ? m : ''));  // drop CSS comments
html = html.replace(/<!--[\s\S]*?-->/g, '');
html = swap(html, '<title>KARS</title>', '<title>KARS (trial)</title>', 'page title');

/* ---- server: same server, plus the trial clock and a lock on the translation routes once it ends ---- */
let srv = await read('kars-server.mjs');
srv = swap(srv, "const WIN = process.platform === 'win32';", `const WIN = process.platform === 'win32';
const TRIAL_MS = ${MINUTES} * 60e3;
const TRIAL_FILES = [path.join(os.homedir(), '.kars-trial'), path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), '.kars-t')];
async function trialInfo() {
  const now = Date.now(), recs = [];
  for (const f of TRIAL_FILES) { try { const o = JSON.parse(Buffer.from(await fs.readFile(f, 'utf8'), 'base64').toString()); if (o.s > 0) recs.push(o); } catch {} }
  const s = Math.min(now, ...recs.map(o => o.s)), l = Math.max(now, ...recs.map(o => o.l || o.s));
  const enc = Buffer.from(JSON.stringify({ s, l })).toString('base64');
  for (const f of TRIAL_FILES) { try { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, enc); } catch {} }
  return { start: s, last: l, ended: now < l - 60e3 || now - s >= TRIAL_MS };
}`, 'server platform line');
srv = swap(srv, "      if (url.pathname === '/api/health')", `      if (url.pathname === '/api/trial') return json(res, await trialInfo());
      if (url.pathname !== '/api/health' && (await trialInfo()).ended) return send(res, 403, 'The KARS trial has ended');
      if (url.pathname === '/api/health')`, 'health route');
srv = swap(srv, "}).listen(PORT, '127.0.0.1', () => {", "}).listen(PORT, '127.0.0.1', () => {\n  trialInfo().catch(() => {});", 'listen call');
srv = swap(srv, 'console.log(`KARS is running at', 'console.log(`KARS trial is running at', 'start message');
const server = await minify(srv, 'node', 'esm');

/* ---- package ---- */
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'kars.html'), html);
await fs.writeFile(path.join(OUT, 'kars-server.mjs'), server + '\n');
for (const f of ['start-kars.bat', 'install-and-start-kars.bat', 'start-kars.sh']) await fs.copyFile(path.join(ROOT, f), path.join(OUT, f));
await fs.chmod(path.join(OUT, 'start-kars.sh'), 0o755);
const readme = (await read('READ-ME-FIRST.txt'))
  .replace('KARS - manga and manhwa translation editor\n', `KARS - manga and manhwa translation editor (TRIAL)\n`)
  .replace(/\n=+\n/, m => `${m}\nThis is a trial version. It works for ${MINUTES} minutes from the first time you open it, then it locks.\nYour work stays saved in your browser. ${CONTACT}\n`);
await fs.writeFile(path.join(OUT, 'READ-ME-FIRST.txt'), readme);
const zip = path.join(ROOT, 'dist', 'kars-trial.zip');
await fs.rm(zip, { force: true });
execFileSync('zip', ['-qr', zip, 'kars-trial'], { cwd: path.dirname(OUT) });
await fs.rm(TMP, { recursive: true, force: true });
console.log(`Built the ${MINUTES}-minute trial: ${path.relative(ROOT, OUT)}/ and ${path.relative(ROOT, zip)}`);
