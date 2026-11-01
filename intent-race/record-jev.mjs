// Runs every keyword through real Jev once and saves the answers to jev-answers.json.
// The simulated race replays these real answers. Safe to re-run: it skips saved keywords.
// run: node --env-file=../.env record-jev.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { KEYWORDS, classifyJev } from './api.mjs';

const FILE = new URL('./jev-answers.json', import.meta.url);
const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const todo = KEYWORDS.filter((k) => !saved[k]);
const CONCURRENCY = 4;
console.log(`${Object.keys(saved).length} saved, ${todo.length} to go`);

let next = 0;
let ok = 0;
let failed = 0;
const never = new AbortController().signal;

async function worker() {
  while (next < todo.length) {
    const kw = todo[next++];
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const t = performance.now();
        const r = await classifyJev(kw, never);
        saved[kw] = { probs: r.probs, tags: r.tags, ms: Math.round(performance.now() - t), cost: r.cost };
        ok++;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        if (attempt === 11) failed++;
      }
    }
    if ((ok + failed) % 50 === 0) {
      writeFileSync(FILE, JSON.stringify(saved));
      console.log(`${ok + failed}/${todo.length} (${failed} failed)`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(FILE, JSON.stringify(saved));
console.log(`done: ${ok} saved, ${failed} failed`);
