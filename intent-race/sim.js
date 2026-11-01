// Simulated race. Intent labels come from answers.json (hand-labeled for this demo, not Jev output).
// Call times are drawn around measured speeds and costs use list prices. Sources are in the page footer.
// When Jev is healthy, record-jev.mjs can record real Jev answers to replace the labels.

const Sim = (() => {
  const SPEED = {
    jev: { median: 420, sigma: 0.3 }, // our measured 4-question Jev calls, Sept 26 2026
    llm: { median: 2500, sigma: 0.28 }, // Claude Opus 5: 2.41s P50 to first token (OpenRouter, Sept 26 2026) + a few words
  };
  const PRICE = { jevIn: 0.042e-6, opusIn: 5e-6, opusOut: 25e-6 }; // list prices per token
  const PROMPT_TOKENS = 130; // the LLM prompt with the 4 intent definitions, before the keyword
  const JEV_BASE_TOKENS = 560; // the 4 Jev questions count as input
  const NAMES = { I: 'informational', C: 'commercial', T: 'transactional', N: 'navigational' };
  const KEYS = ['I', 'C', 'T', 'N'];

  let answers = {};

  async function load() {
    const res = await fetch('answers.json');
    answers = res.ok ? await res.json() : {};
    return answers;
  }

  // real API latency is skewed: most calls near the median, a few slow ones
  function latency({ median, sigma }) {
    const u = 1 - Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    return Math.min(Math.max(median * Math.exp(sigma * z), median * 0.4), median * 4);
  }

  const tokens = (s) => Math.ceil(s.length / 4);

  function jev(kw) {
    const a = answers[kw];
    return { probs: a.probs, tags: a.tags, cost: a.cost || (JEV_BASE_TOKENS + tokens(kw)) * PRICE.jevIn };
  }

  // Opus mostly lands where Jev does. Borderline keywords can go either way, like two real models.
  function opus(kw) {
    const probs = answers[kw].probs;
    let tags = KEYS.filter((k) => probs[k] + (Math.random() - 0.5) * 0.3 >= 0.5);
    if (!tags.length) tags = [KEYS.reduce((x, k) => (probs[k] > probs[x] ? k : x), 'I')];
    const text = tags.map((k) => NAMES[k]).join(', ');
    const cost = (PROMPT_TOKENS + tokens(kw)) * PRICE.opusIn + (tokens(text) + 1) * PRICE.opusOut;
    return { probs: null, tags, text, cost };
  }

  // same shape as Live.run: `concurrency` calls in flight at once, results as they land
  function run({ side, keywords, concurrency, onResult }) {
    const speed = SPEED[side];
    const make = side === 'jev' ? jev : opus;
    let next = 0;
    let stopped = false;
    const timers = new Set();
    function launch() {
      if (stopped || next >= keywords.length) return;
      const i = next++;
      const ms = latency(speed);
      const t = setTimeout(() => {
        timers.delete(t);
        if (stopped) return;
        onResult({ i, keyword: keywords[i], ms, ...make(keywords[i]) });
        launch();
      }, ms);
      timers.add(t);
    }
    for (let k = 0; k < concurrency; k++) launch();
    return {
      stop() {
        stopped = true;
        timers.forEach(clearTimeout);
      },
    };
  }

  return { load, run, SPEED };
})();
