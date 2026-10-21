// KARS local server: runs KARS on this PC and uses Claude Code, signed in with your Claude account, as the translator.
// No API key is needed. Requirements:
//   1. Node.js 18 or newer            https://nodejs.org
//   2. Claude Code, installed and signed in once:
//        npm install -g @anthropic-ai/claude-code
//        claude            (then sign in with your Claude account and exit)
// Start:  node kars-server.mjs      (or double-click start-kars.bat on Windows, start-kars.sh on macOS/Linux)
// Then open http://localhost:8787 (it opens by itself). Keep kars.html in the same folder as this file.
// Options (environment variables): KARS_PORT (default 8787), KARS_MODEL (default sonnet), KARS_NO_OPEN=1 to skip opening the browser.
//
// Safety: the server listens only on this PC (127.0.0.1) and refuses requests from other websites,
// so a page you visit elsewhere cannot use your Claude account through it.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.KARS_PORT || 8787;
const MODEL = process.env.KARS_MODEL || 'sonnet';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const WIN = process.platform === 'win32';

/* at most two Claude Code runs at once; the rest wait their turn */
let running = 0;
const waiting = [];
const take = () => new Promise(ok => { if (running < 2) { running++; ok(); } else waiting.push(ok); });
const give = () => { const next = waiting.shift(); if (next) next(); else running--; };

/* Run Claude Code headless in a folder that holds only the bubble image. The prompt goes in on stdin.
   The API key variables are removed so Claude Code uses your Claude sign-in, not a key. */
function runClaude(prompt, cwd) {
  return new Promise((ok, no) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const p = spawn('claude', ['-p', '--output-format', 'json', '--model', MODEL, '--allowedTools', 'Read'], { cwd, env, shell: WIN });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); no(new Error('Claude took longer than 3 minutes')); }, 180000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); no(new Error(e.code === 'ENOENT' ? 'Claude Code is not installed. Run: npm install -g @anthropic-ai/claude-code' : e.message)); });
    p.on('close', () => {
      clearTimeout(timer);
      let j;
      try { j = JSON.parse(out); } catch { return no(new Error((err || out || 'Claude Code gave no answer').trim().slice(0, 400) + (/log ?in|auth/i.test(err + out) ? ' (run "claude" once and sign in)' : ''))); }
      if (j.is_error) return no(new Error(String(j.result || j.subtype || 'Claude Code reported an error').slice(0, 400)));
      ok(String(j.result || ''));
    });
    p.stdin.end(prompt);
  });
}

async function translate(body) {
  /* body.images: [{name, label, data}] (base64 PNGs), or the older single body.image */
  const imgs = Array.isArray(body && body.images) ? body.images : body && typeof body.image === 'string' ? [{ name: 'image1.png', label: 'the speech bubble or text box to translate', data: body.image }] : [];
  if (typeof body.text !== 'string') throw new Error('bad request');  // no images is fine: "Translate my edit" sends only text
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kars-'));
  try {
    const list = [];
    for (let k = 0; k < Math.min(imgs.length, 4); k++) {
      const name = `image${k + 1}.png`;
      await fs.writeFile(path.join(dir, name), Buffer.from(String(imgs[k].data), 'base64'));
      list.push(`${name}: ${String(imgs[k].label || '').slice(0, 200)}`);
    }
    const prompt = `${body.system || ''}

${list.length ? `Use the Read tool to open these image files in the current folder:\n${list.join('\n')}\n` : ''}
${body.text}

Reply with only one JSON object and no other text. It must match this JSON Schema:
${JSON.stringify(body.schema || {})}`;
    await take();
    let result;
    try { result = await runClaude(prompt, dir); } finally { give(); }
    const m = result.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude did not return a translation. Try again.');
    return JSON.parse(m[0]);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const send = (res, code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
const json = (res, obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let size = 0; const parts = [];
  req.on('data', c => { size += c.length; if (size > 120e6) { no(new Error('too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
  req.on('error', no);
});

http.createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host)) return send(res, 403, 'Forbidden');  // blocks DNS-rebinding tricks
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const site = req.headers['sec-fetch-site'], origin = req.headers.origin;
      if ((site && site !== 'same-origin' && site !== 'none') || (origin && !HOSTS.has(origin.replace(/^https?:\/\//, '')))) return send(res, 403, 'Requests from other websites are not allowed');
      if (url.pathname === '/api/health') return json(res, { ok: true, model: MODEL });
      if (url.pathname === '/api/translate' && req.method === 'POST') return json(res, await translate(JSON.parse(await readBody(req))));
      if (url.pathname === '/api/deepl' && req.method === 'POST') {  // DeepL refuses requests from web pages, so the server relays them
        const b = JSON.parse(await readBody(req));
        const host = String(b.key || '').endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
        const r = await fetch(host + '/v2/translate', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'DeepL-Auth-Key ' + b.key },
          body: JSON.stringify({ text: [String(b.text || '')], source_lang: b.source, target_lang: b.target }) });
        const o = await r.json().catch(() => ({ message: 'DeepL answered ' + r.status }));
        return json(res, o, r.status);
      }
      if (url.pathname === '/api/omni' && req.method === 'POST') {  // relays to the OmniRoute gateway the translator set (an OpenAI-style /chat/completions)
        const b = JSON.parse(await readBody(req)), base = new URL(String(b.base || 'http://localhost:20128/v1'));
        if (!/^https?:$/.test(base.protocol)) return json(res, { error: 'The OmniRoute address must start with http:// or https://' }, 400);
        const headers = { 'content-type': 'application/json' };
        if (b.key) headers.authorization = 'Bearer ' + b.key;
        let r;
        try { r = await fetch(base.href.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ ...b.body, stream: false }), signal: AbortSignal.timeout(180000) }); }
        catch (e) { return json(res, { error: `Could not reach OmniRoute at ${base.origin}. Is it running? (${e.cause?.code || e.message})` }, 502); }
        const txt = await r.text();
        let o;
        try { o = JSON.parse(txt); }
        catch {  // some gateways stream even when asked not to: put the pieces back together
          let content = '';
          for (const line of txt.split('\n')) {
            const m = line.match(/^data:\s*(.+)$/); if (!m || m[1].trim() === '[DONE]') continue;
            try { const c = JSON.parse(m[1]).choices?.[0]; content += c?.delta?.content ?? c?.message?.content ?? ''; } catch {}
          }
          o = content ? { choices: [{ message: { role: 'assistant', content } }] } : { error: `OmniRoute answered ${r.status}: ${txt.slice(0, 200) || '(nothing)'}` };
        }
        return json(res, o, r.ok ? 200 : r.status);
      }
      if (url.pathname === '/api/iopaint' && req.method === 'POST') {  // relays Tahrir's cleaning to IOPaint on this PC, which may not accept requests from web pages
        const b = JSON.parse(await readBody(req)), base = new URL(String(b.base || 'http://127.0.0.1:8080'));
        if (!/^https?:$/.test(base.protocol)) return json(res, { error: 'The IOPaint address must start with http:// or https://' }, 400);
        let r;
        const up = b.op === 'upscale', body = up ? { name: 'RealESRGAN', image: b.image, clicks: [], scale: Number(b.scale) || 2 } : { image: b.image, mask: b.mask };
        try { r = await fetch(base.href.replace(/\/+$/, '') + (up ? '/api/v1/run_plugin_gen_image' : '/api/v1/inpaint'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) }); }
        catch (e) { return json(res, { error: `Could not reach IOPaint at ${base.origin}. Is it running? (${e.cause?.code || e.message})` }, 502); }
        const buf = Buffer.from(await r.arrayBuffer());
        if (!r.ok) return json(res, { error: `IOPaint answered ${r.status}: ${buf.toString('utf8').slice(0, 200)}` }, r.status);
        res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/png' });
        return res.end(buf);
      }
      return send(res, 404, 'Not found');
    }
    if (url.pathname === '/' || url.pathname === '/kars.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await fs.readFile(path.join(DIR, 'kars.html')));
    }
    send(res, 404, 'Not found');
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, 500); else res.end();
  }
}).listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.log(`KARS is running at ${link}  (model: ${MODEL}). Keep this window open; close it to stop KARS.`);
  const check = spawn('claude', ['--version'], { shell: WIN });
  check.on('error', () => console.log('Warning: Claude Code was not found. Install it with: npm install -g @anthropic-ai/claude-code, then run "claude" once to sign in.'));
  if (!process.env.KARS_NO_OPEN) {
    // KARS opens in its own app window (no tabs or address bar), through Edge on Windows or Chrome on a Mac; KARS_BROWSER=default uses a normal browser tab
    const app = process.env.KARS_BROWSER !== 'default';
    const plain = () => { const [c, a] = WIN ? ['cmd', ['/c', 'start', '', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]]; spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); };
    if (!app) plain();
    else {
      const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', 'msedge', `--app=${link}`]] : process.platform === 'darwin' ? ['open', ['-na', 'Google Chrome', '--args', `--app=${link}`]] : ['google-chrome', [`--app=${link}`]];
      const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
      p.on('error', plain); p.on('exit', code => { if (code) plain(); }); p.unref();
    }
  }
});
