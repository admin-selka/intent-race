(async function () {
  const $ = (id) => document.getElementById(id);

  // default: Jev makes real calls, Opus is simulated from measured speeds.
  // ?sim = both simulated. ?live = both sides make real calls.
  const params = new URLSearchParams(location.search);
  const MODE = params.has('live') ? 'live' : params.has('sim') ? 'sim' : 'mixed';
  const CONCURRENCY = 24;

  // how each LLM shows up in its panel. Unknown models get a plain gray panel.
  const MODELS = {
    'anthropic/claude-opus-5': { name: 'Claude Opus 5', provider: 'Anthropic · claude-opus-5', logo: LOGOS.claude, brand: 'claude' },
    'anthropic/claude-haiku-4.5': { name: 'Claude Haiku 4.5', provider: 'Anthropic · via Vercel AI Gateway', logo: LOGOS.claude, brand: 'claude' },
  };

  let llmModel = 'anthropic/claude-opus-5';
  let concurrency = CONCURRENCY;
  let jevProvider = 'TypeSafe AI · typesafe-ai/jev';
  let keywords = [];

  try {
    const all = (await (await fetch('keywords.txt')).text()).split('\n').map((s) => s.trim()).filter(Boolean);
    if (MODE !== 'sim') {
      const cfg = await Live.config();
      if (cfg.jevRoute === 'openrouter') jevProvider = 'TypeSafe AI · typesafe/jev-1.13 via OpenRouter';
      if (MODE === 'live') {
        llmModel = cfg.llmModel;
        concurrency = cfg.concurrency;
      }
    }
    // the simulated side needs a label for each keyword. keep only labeled ones so both sides race the same list.
    const answers = MODE === 'live' ? null : await Sim.load();
    keywords = answers ? all.filter((k) => answers[k]) : all;
  } catch {
    $('gapKw').textContent = '!';
    document.querySelector('.gap-sub').textContent = 'start the server: npm start in jev-tools';
    return;
  }

  const OPUS_SIM = `Claude Opus 5 side is simulated: call times drawn around ~2.5s per call (2.41s P50 to first token, OpenRouter, Sept 26 2026, plus a few words), costs at list price ($5 in / $25 out per 1M tokens), and its intent labels were set for this demo, not produced by Opus 5 calls.`;
  $('modePill').textContent = {
    mixed: 'Jev: live API calls · Opus: simulated from measured speeds',
    live: 'live API calls',
    sim: 'simulated · based on measured speeds',
  }[MODE];
  $('footNote').textContent = {
    mixed: `Same keywords on both sides, one keyword per call, ${concurrency} calls at a time on each side. Jev side is live: every keyword is a real Jev call, with its real answer, real call time and the cost the API reports. Jev answers 4 yes/no questions (I, C, T, N) with a probability for each, and anything at 50% or more becomes a tag. ${OPUS_SIM}`,
    live: `Same keywords on both sides. One keyword per call, ${concurrency} calls at a time on each side. Every call is real. Jev answers 4 yes/no questions (I, C, T, N) with a probability for each, and anything at 50% or more becomes a tag. The LLM answers in text, which gets parsed into tags. Cost is what each API reports.`,
    sim: `Simulated race. Intent labels were set for this demo, not produced by Jev. Call times are simulated around measured speeds: Jev ~0.42s per call (our own 4-question calls, Sept 26 2026), Claude Opus 5 ~2.5s (2.41s P50 to first token, OpenRouter, Sept 26 2026, plus a few words). ${concurrency} calls at a time on each side. Costs at list price: Jev $0.042 per 1M input tokens, output free. Opus 5 $5 in / $25 out per 1M.`,
  }[MODE];

  const model = MODELS[llmModel] ?? { name: llmModel.split('/')[1], provider: `${llmModel.split('/')[0]} · via Vercel AI Gateway`, logo: null, brand: 'generic' };
  // same scale on both gauges, a bit above Jev's expected pace
  const jevBest = concurrency / (Sim.SPEED.jev.median / 1000);
  const gaugeMax = Math.max(10, Math.ceil((jevBest * 1.3) / 10) * 10);

  const jev = new Side($('sideJev'), {
    kind: 'jev',
    name: 'Jev',
    provider: jevProvider,
    logo: LOGOS.jev,
    gaugeMax,
    streamCap: '4 yes/no questions per keyword, one call',
    nowCap: 'typed probabilities',
  });
  const sideLlm = $('sideLlm');
  if (model.brand === 'generic') sideLlm.classList.add('generic');
  const llm = new Side(sideLlm, {
    kind: 'llm',
    name: model.name,
    provider: model.provider,
    logo: model.logo,
    gaugeMax,
    streamCap: 'one prompt per keyword, text back',
    nowCap: 'text answer · no probabilities',
  });

  const raceBtn = $('raceBtn');
  let n = Math.min(1000, keywords.length);
  let runs = [];

  function reset() {
    runs.forEach((r) => r.stop());
    runs = [];
    jev.reset(n);
    llm.reset(n);
    $('metaCount').textContent = n.toLocaleString('en-US');
    raceBtn.disabled = false;
  }

  function race() {
    if (jev.running || llm.running) return;
    reset();
    raceBtn.disabled = true;
    const t0 = performance.now();
    jev.start(t0);
    llm.start(t0);
    const kws = keywords.slice(0, n);
    const jevRun = MODE === 'sim'
      ? Sim.run({ side: 'jev', keywords: kws, concurrency, onResult: (r) => jev.push(r) })
      : Live.run({ side: 'jev', n, concurrency, onResult: (r) => jev.push(r) });
    const llmRun = MODE === 'live'
      ? Live.run({ side: 'llm', n, concurrency, onResult: (r) => llm.push(r) })
      : Sim.run({ side: 'llm', keywords: kws, concurrency, onResult: (r) => llm.push(r) });
    runs = [jevRun, llmRun];
  }

  function updateGap(now) {
    const lead = jev.done - llm.done;
    $('gapKw').textContent = (lead > 0 ? '+' : '') + lead.toLocaleString('en-US');
    const ja = jev.avgRate(now);
    const la = llm.avgRate(now);
    $('gapX').textContent = ja && la ? (ja / la).toFixed(1) + '×' : '–';
    const jc = jev.done ? jev.cost / jev.done : 0;
    const lc = llm.done ? llm.cost / llm.done : 0;
    $('gapCost').textContent = jc && lc ? Math.round(lc / jc) + '×' : '–';

    // once Jev is done, show how long the LLM still needs at its current pace
    if (jev.finished && llm.running && la) {
      const left = (llm.total - llm.done) / la;
      const m = Math.floor(left / 60);
      const s = String(Math.round(left % 60)).padStart(2, '0');
      llm.setStatus(`Classifying · ${m}:${s} left`);
    }
    if (jev.finished && llm.finished) raceBtn.disabled = false;
  }

  function loop() {
    const now = performance.now();
    jev.frame(now);
    llm.frame(now);
    updateGap(now);
    requestAnimationFrame(loop);
  }

  document.querySelectorAll('#countSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#countSeg button').forEach((x) => x.classList.toggle('on', x === b));
      n = Math.min(+b.dataset.n, keywords.length);
      b.blur();
      reset();
    }),
  );
  raceBtn.addEventListener('click', () => {
    raceBtn.blur();
    race();
  });
  $('resetBtn').addEventListener('click', reset);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); race(); }
    if (e.key === 'r') reset();
  });

  reset();
  loop();
})();
