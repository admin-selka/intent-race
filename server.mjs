// One local server for every Jev tool. Each tool is a folder: its files are served
// at /<tool>/, and functions exported from <tool>/api.mjs answer /<tool>/api/<name>.
// Listens on localhost only. The key stays in .env on this machine.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 5180);
const ROOT = new URL('.', import.meta.url).pathname;
const TOOLS = ['intent-race', 'intent-classifier'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

if (!process.env.AI_GATEWAY_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error('No API key found. Put OPENROUTER_API_KEY (or AI_GATEWAY_API_KEY) in .env, then run: npm start');
  process.exit(1);
}

const apis = {};
async function api(tool) {
  apis[tool] ??= import(`./${tool}/api.mjs`).catch(() => null);
  return apis[tool];
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const [, tool, ...rest] = url.pathname.split('/');

    if (!tool) {
      res.writeHead(302, { Location: `/${TOOLS[0]}/` }).end();
      return;
    }
    if (!TOOLS.includes(tool)) {
      res.writeHead(404).end('not found');
      return;
    }
    if (!rest.length) {
      res.writeHead(302, { Location: `/${tool}/` }).end();
      return;
    }

    if (rest[0] === 'api') {
      const mod = await api(tool);
      const fn = mod?.[rest[1]];
      if (typeof fn !== 'function') {
        res.writeHead(404).end('no such api');
        return;
      }
      const out = await fn(req, res, url);
      if (out !== undefined && !res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      }
      return;
    }

    // static files, only the listed types, never dotfiles or server code
    const rel = normalize(rest.join('/') || 'index.html');
    const type = TYPES[extname(rel)];
    if (!type || rel.startsWith('..') || rel.split('/').some((p) => p.startsWith('.'))) {
      res.writeHead(404).end('not found');
      return;
    }
    const file = join(ROOT, tool, rel);
    if (!(await stat(file).catch(() => null))?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(await readFile(file));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('server error');
    else res.end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`jev-tools running at http://localhost:${PORT}/`));
