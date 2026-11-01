// Real calls for the Intent Race. Both sides get the same keywords, one keyword per
// call, the same number of calls at a time, and the same four intent definitions.

import { readFileSync } from 'node:fs';
import { experimental_evaluate as evaluate, generateText } from 'ai';

const JEV_MODEL = 'typesafe-ai/jev';
// OpenRouter's route to Jev. Used whenever OPENROUTER_API_KEY is in .env (more reliable than Vercel's right now).
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_JEV = 'typesafe/jev-1.13';
// Haiku needs paid Vercel credits. Until then the free Ling model runs. Set LLM_MODEL in .env to switch.
const LLM_MODEL = process.env.LLM_MODEL ?? 'inclusionai/ling-3.0-flash-fin-free';
const CONCURRENCY = Number(process.env.RACE_CONCURRENCY ?? 8);
const MAX_KEYWORDS = 1000;

export const KEYWORDS = readFileSync(new URL('./keywords.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

// one set of definitions, shared by both sides so the comparison is fair
const INTENTS = {
  I: { name: 'informational', means: 'the searcher wants to learn something or get an answer (how to, what is, why, guides, tips, ideas)' },
  C: { name: 'commercial', means: 'the searcher is comparing or researching options before buying (best, vs, review, alternatives, worth it)' },
  T: { name: 'transactional', means: 'the searcher wants to act now: buy, sign up, book, download, get a price or coupon, or find a place near them' },
  N: { name: 'navigational', means: 'the searcher wants to reach a specific brand, website, app or page (a brand name, login, app, dashboard)' },
};
const KEYS = Object.keys(INTENTS);

const JEV_QUESTIONS = Object.fromEntries(
  KEYS.map((k) => [
    k,
    {
      type: 'boolean',
      instructions: `Does this search keyword have ${INTENTS[k].name} intent? A keyword can have more than one intent.`,
      criteria: { true: INTENTS[k].means, false: `the searcher is not doing this` },
    },
  ]),
);

// OpenRouter calls a yes/no question "noul"; the Vercel SDK calls it "boolean"
const OPENROUTER_QUESTIONS = Object.fromEntries(Object.entries(JEV_QUESTIONS).map(([k, q]) => [k, { ...q, type: 'noul' }]));

const LLM_PROMPT = (kw) =>
  'Classify the search intent of this search keyword. A keyword can have more than one intent.\n\n' +
  KEYS.map((k) => `- ${INTENTS[k].name}: ${INTENTS[k].means}`).join('\n') +
  '\n\nReply with only the matching intent names, comma separated.\n\n' +
  `Keyword: "${kw}"`;

// retry busy / rate-limited answers fast, instead of the SDK's long default backoff
async function withRetry(fn, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const busy = err?.isRetryable || /rate|demand|unavailable|429|503/i.test(String(err?.message));
      if (signal.aborted || !busy || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

const gatewayCost = (meta) => Number(meta?.gateway?.marketCost ?? meta?.gateway?.cost ?? 0) || 0;

function tagsFrom(probs) {
  const tags = KEYS.filter((k) => probs[k] >= 0.5);
  return tags.length ? tags : [KEYS.reduce((a, k) => (probs[k] > probs[a] ? k : a))];
}

async function classifyJevOpenRouter(keyword, abortSignal) {
  const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENROUTER_JEV, state: { search_keyword: keyword }, questions: OPENROUTER_QUESTIONS }),
    signal: abortSignal,
  });
  if (!res.ok) {
    const err = new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
    err.isRetryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const j = await res.json();
  const probs = Object.fromEntries(KEYS.map((k) => [k, j.answers[k].noul]));
  return { probs, tags: tagsFrom(probs), cost: Number(j.usage?.cost ?? 0) };
}

export async function classifyJev(keyword, abortSignal) {
  if (OPENROUTER_KEY) return classifyJevOpenRouter(keyword, abortSignal);
  const r = await evaluate({ model: JEV_MODEL, state: `Search keyword: "${keyword}"`, questions: JEV_QUESTIONS, abortSignal, maxRetries: 0 });
  const probs = Object.fromEntries(KEYS.map((k) => [k, r.answers[k].probability]));
  return { probs, tags: tagsFrom(probs), cost: gatewayCost(r.providerMetadata) };
}

async function classifyLlm(keyword, abortSignal) {
  const r = await generateText({ model: LLM_MODEL, prompt: LLM_PROMPT(keyword), abortSignal, maxRetries: 0 });
  const text = r.text.trim();
  const lower = text.toLowerCase();
  const tags = KEYS.filter((k) => lower.includes(INTENTS[k].name));
  return { probs: null, tags, text, cost: gatewayCost(r.providerMetadata) };
}

export function config() {
  return { jevModel: OPENROUTER_KEY ? OPENROUTER_JEV : JEV_MODEL, jevRoute: OPENROUTER_KEY ? 'openrouter' : 'vercel', llmModel: LLM_MODEL, concurrency: CONCURRENCY, keywords: Math.min(KEYWORDS.length, MAX_KEYWORDS) };
}

// GET run?side=jev|llm&n=1000 -> server-sent events, one per finished keyword
export async function run(req, res, url) {
  const side = url.searchParams.get('side');
  const classify = side === 'jev' ? classifyJev : side === 'llm' ? classifyLlm : null;
  if (!classify) {
    res.writeHead(400).end('side must be jev or llm');
    return;
  }
  const n = Math.min(Math.max(Number(url.searchParams.get('n')) || 100, 1), MAX_KEYWORDS, KEYWORDS.length);
  const concurrency = Math.min(Math.max(Number(url.searchParams.get('c')) || CONCURRENCY, 1), 64);
  const keywords = KEYWORDS.slice(0, n);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const abort = new AbortController();
  req.on('close', () => abort.abort());
  const send = (event, data) => {
    if (!abort.signal.aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let next = 0;
  async function worker() {
    while (!abort.signal.aborted && next < keywords.length) {
      const i = next++;
      const keyword = keywords[i];
      const t = performance.now();
      try {
        const out = await withRetry(() => classify(keyword, abort.signal), abort.signal);
        send('result', { i, keyword, ms: performance.now() - t, ...out });
      } catch (err) {
        if (abort.signal.aborted) return;
        const cause = err?.cause ? ` (${err.cause.code ?? ''} ${err.cause.message ?? ''})` : '';
        send('result', { i, keyword, ms: performance.now() - t, probs: null, tags: [], text: '', cost: 0, error: (String(err?.message ?? err) + cause).slice(0, 240) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keywords.length) }, worker));
  send('end', {});
  res.end();
}
