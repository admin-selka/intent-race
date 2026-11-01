// Renders one side of the race. Data sources (mock now, real API later) only call
// reset / start / push. Everything visual happens in frame(), once per animation frame.

const INTENTS = [
  { k: 'I', name: 'Informational' },
  { k: 'C', name: 'Commercial' },
  { k: 'T', name: 'Transactional' },
  { k: 'N', name: 'Navigational' },
];

// official icons. TypeSafe's comes from its own site. claude.ai blocks other sites
// from loading its icon, so Claude's comes through Google's favicon service.
const LOGOS = {
  jev: 'https://framerusercontent.com/images/kcuF2BEp5XaVfkmFB634IPRKQH0.png',
  claude: 'https://www.google.com/s2/favicons?domain=claude.ai&sz=128',
};

const fmt = {
  int: (n) => n.toLocaleString('en-US'),
  money: (n) => '$' + n.toFixed(4),
  secs: (ms) => (ms / 1000).toFixed(1),
  ms: (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms'),
};

const GAUGE = { cx: 70, cy: 70, r: 56 };
const RADAR = { c: 75, r: 52 };
const STREAM_EVERY = 90;
const NOW_EVERY = 60;
const BUCKETS_EVERY = 120;

class Side {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    el.innerHTML = this.template();
    this.r = {};
    el.querySelectorAll('[data-r]').forEach((n) => (this.r[n.dataset.r] = n));
    this.buildGauge();
    this.buildRadar();
    this.buildProbs();
    this.buildBuckets();
    this.onFinish = null;
  }

  template() {
    const c = this.cfg;
    return `
      <div class="side-head">
        <div class="id">
          ${c.logo ? `<div class="logo img"><img src="${c.logo}" alt="${c.name} logo"></div>` : `<div class="logo letter">${c.name[0]}</div>`}
          <div>
            <div class="name">${c.name}</div>
            <div class="prov">${c.provider}</div>
            <div class="status"><i></i><span data-r="status">Ready</span></div>
          </div>
        </div>
        <div class="gauge">
          <svg data-r="gauge" viewBox="0 0 140 84"></svg>
          <div class="g-read"><b data-r="rate">0</b> kw/s</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><div class="l">Done</div><div class="v"><span data-r="done">0</span><small data-r="total">/1000</small></div></div>
        <div class="stat"><div class="l">Tags</div><div class="v" data-r="tags">0</div></div>
        <div class="stat"><div class="l">Kw / sec</div><div class="v" data-r="avg">0</div></div>
        <div class="stat"><div class="l">P50 call</div><div class="v"><span data-r="p50">–</span><small data-r="p50unit"></small></div></div>
        <div class="stat"><div class="l">Elapsed</div><div class="v"><span data-r="elapsed">0.0</span><small>s</small></div></div>
        <div class="stat cost"><div class="l">Cost</div><div class="v" data-r="cost">$0.0000</div></div>
      </div>
      <div class="field-wrap">
        <div class="field" data-r="field"></div>
        <div class="stamp" data-r="stamp"><b data-r="stampBig"></b><span data-r="stampSub"></span></div>
      </div>
      <div class="sec"><span class="k">A</span>The stream<span class="cap">${c.streamCap}</span></div>
      <div class="stream" data-r="stream"></div>
      <div class="sec"><span class="k">B</span>Now classifying<span class="cap">${c.nowCap}</span></div>
      <div class="now">
        <div>
          <div class="now-kw" data-r="nowKw">–</div>
          <div class="probs" data-r="probs"></div>
          ${c.kind === 'llm' ? '<div class="raw" data-r="raw">waiting for text…</div>' : ''}
        </div>
        <div class="radar"><svg data-r="radar" viewBox="0 0 150 150"></svg></div>
      </div>
      <div class="sec"><span class="k">C</span>The buckets<span class="cap">a keyword can land in more than one</span></div>
      <div class="buckets" data-r="buckets"></div>`;
  }

  buildGauge() {
    const { cx, cy, r } = GAUGE;
    const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    let ticks = '';
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1 - i / 10);
      const r1 = r - 10;
      const r2 = r - (i % 5 === 0 ? 17 : 13);
      ticks += `<line class="g-tick" x1="${cx + r1 * Math.cos(a)}" y1="${cy - r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy - r2 * Math.sin(a)}"/>`;
    }
    this.r.gauge.innerHTML = `
      <path class="g-track" d="${arc}"/>
      <path class="g-val" d="${arc}" pathLength="100" stroke-dasharray="0 100"/>
      ${ticks}
      <line class="g-needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 16}" transform="rotate(-90 ${cx} ${cy})"/>
      <circle class="g-cap" cx="${cx}" cy="${cy}" r="4"/>
      <text class="g-lbl" x="${cx - r}" y="${cy + 13}" text-anchor="middle">0</text>
      <text class="g-lbl" x="${cx + r}" y="${cy + 13}" text-anchor="middle">${this.cfg.gaugeMax}</text>`;
    this.gVal = this.r.gauge.querySelector('.g-val');
    this.gNeedle = this.r.gauge.querySelector('.g-needle');
  }

  // I top, C right, T bottom, N left
  radarPoint(j, v) {
    const a = -Math.PI / 2 + (j * Math.PI) / 2;
    return [RADAR.c + RADAR.r * v * Math.cos(a), RADAR.c + RADAR.r * v * Math.sin(a)];
  }

  buildRadar() {
    const ring = (v) => INTENTS.map((_, j) => this.radarPoint(j, v).join(',')).join(' ');
    let svg = '';
    for (const v of [0.25, 0.75, 1]) svg += `<polygon class="r-ring" points="${ring(v)}"/>`;
    svg += `<polygon class="r-thr" points="${ring(0.5)}"/>`;
    INTENTS.forEach((x, j) => {
      const [ax, ay] = this.radarPoint(j, 1);
      const [lx, ly] = this.radarPoint(j, 1.22);
      svg += `<line class="r-axis" x1="${RADAR.c}" y1="${RADAR.c}" x2="${ax}" y2="${ay}"/>`;
      svg += `<text class="r-lbl" x="${lx}" y="${ly + 3.5}" text-anchor="middle">${x.k}</text>`;
    });
    svg += `<polygon class="r-shape" points="${ring(0.02)}"/>`;
    INTENTS.forEach(() => (svg += `<circle class="r-dot" r="4" cx="${RADAR.c}" cy="${RADAR.c}"/>`));
    this.r.radar.innerHTML = svg;
    this.rShape = this.r.radar.querySelector('.r-shape');
    this.rDots = [...this.r.radar.querySelectorAll('.r-dot')];
  }

  buildProbs() {
    this.r.probs.innerHTML = INTENTS.map(
      (x) => `<div class="prob off"><span class="chip">${x.k}</span><span>${x.name}</span><div class="bar"><i></i></div><span class="pct">–</span></div>`,
    ).join('');
    this.probRows = [...this.r.probs.children].map((row) => ({
      row,
      chip: row.querySelector('.chip'),
      bar: row.querySelector('.bar i'),
      pct: row.querySelector('.pct'),
    }));
  }

  buildBuckets() {
    this.r.buckets.innerHTML = INTENTS.map(
      (x) => `<div class="bucket">
        <div class="b-head"><span class="chip on">${x.k}</span><span class="b-name">${x.name}</span><span class="b-count">0</span></div>
        <div class="b-share"><i></i></div>
        <div class="stack"></div>
      </div>`,
    ).join('');
    this.bEls = [...this.r.buckets.children].map((b) => ({
      count: b.querySelector('.b-count'),
      share: b.querySelector('.b-share i'),
      stack: b.querySelector('.stack'),
      lastKey: null,
    }));
  }

  reset(total) {
    this.total = total;
    this.done = 0;
    this.tags = 0;
    this.errors = 0;
    this.cost = 0;
    this.msList = [];
    this.times = [];
    this.winStart = 0;
    this.t0 = 0;
    this.tEnd = 0;
    this.running = false;
    this.finished = false;
    this.latest = null;
    this.shownStream = null;
    this.shownNow = null;
    this.lastStream = 0;
    this.lastNow = 0;
    this.lastBuckets = 0;
    this.lastP50 = 0;
    this.p50 = 0;
    this.gv = 0;
    this.rt = [0.02, 0.02, 0.02, 0.02];
    this.rv = [0.02, 0.02, 0.02, 0.02];
    this.bcount = { I: 0, C: 0, T: 0, N: 0 };
    this.bitems = { I: [], C: [], T: [], N: [] };

    this.el.classList.remove('running', 'done');
    this.setStatus('Ready');

    const rows = total >= 500 ? 10 : 5;
    const cols = Math.ceil(total / rows);
    this.r.field.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    this.r.field.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.r.field.innerHTML = '<i class="tile"></i>'.repeat(total);
    this.tiles = this.r.field.children;

    this.r.total.textContent = '/' + fmt.int(total);
    this.r.stream.innerHTML = '';
    this.r.nowKw.textContent = '–';
    this.probRows.forEach((p) => {
      p.row.classList.add('off');
      p.chip.classList.remove('on');
      p.bar.style.width = '0';
      p.pct.textContent = '–';
    });
    if (this.r.raw) this.r.raw.textContent = 'waiting for text…';
    this.r.stamp.classList.remove('show');
    this.bEls.forEach((b) => {
      b.count.textContent = '0';
      b.share.style.width = '0';
      b.stack.innerHTML = '';
      b.lastKey = null;
    });
    this.frame(performance.now());
  }

  start(t0) {
    this.t0 = t0;
    this.running = true;
    this.el.classList.add('running');
    this.setStatus('Classifying');
  }

  setStatus(text) {
    this.r.status.textContent = text;
  }

  // r = { i, keyword, ms, cost, tags: ['C','T'], probs: {I,C,T,N} | null, text? }
  push(r) {
    if (!this.running || r.i >= this.total) return;
    const now = performance.now();
    this.done++;
    this.times.push(now);
    this.msList.push(r.ms);
    this.cost += r.cost;
    this.tags += r.tags.length;
    this.tiles[r.i]?.classList.add(r.error ? 'err' : 'on');
    if (r.error) {
      this.errors++;
      this.setStatus(`Classifying · ${this.errors} failed`);
      console.warn(this.cfg.name, r.keyword, r.error);
    }
    for (const k of r.tags) {
      this.bcount[k]++;
      const list = this.bitems[k];
      list.unshift(r);
      if (list.length > 4) list.pop();
    }
    if (!r.error) this.latest = r;
    if (this.done >= this.total) this.finish(now);
  }

  finish(now) {
    this.running = false;
    this.finished = true;
    this.tEnd = now;
    this.el.classList.remove('running');
    this.el.classList.add('done');
    this.setStatus(this.errors ? `Done · ${this.errors} failed` : 'Done');
    this.updateP50();
    this.r.stampBig.textContent = `${fmt.int(this.total)} in ${fmt.secs(this.elapsed(now))}s`;
    this.r.stampSub.textContent = `${fmt.money(this.cost)} · p50 ${fmt.ms(this.p50)}`;
    this.r.stamp.classList.add('show');
    this.onFinish?.(this);
  }

  elapsed(now) {
    if (!this.t0) return 0;
    return (this.tEnd || now) - this.t0;
  }

  avgRate(now) {
    const e = this.elapsed(now);
    return e > 0 ? this.done / (e / 1000) : 0;
  }

  updateP50() {
    if (!this.msList.length) return;
    const s = [...this.msList].sort((a, b) => a - b);
    this.p50 = s[Math.floor(s.length / 2)];
  }

  frame(now) {
    const e = this.elapsed(now);
    const avg = this.avgRate(now);

    // speed: rolling 1s window while running, average once finished
    let rate = avg;
    if (this.running && e > 1000) {
      const cut = now - 1000;
      while (this.winStart < this.times.length && this.times[this.winStart] < cut) this.winStart++;
      rate = this.times.length - this.winStart;
    }
    this.gv += (rate - this.gv) * 0.12;
    const f = Math.min(this.gv / this.cfg.gaugeMax, 1);
    this.gVal.setAttribute('stroke-dasharray', `${f * 100} 100`);
    this.gNeedle.setAttribute('transform', `rotate(${-90 + 180 * f} ${GAUGE.cx} ${GAUGE.cy})`);
    this.r.rate.textContent = Math.round(this.gv);

    this.r.done.textContent = fmt.int(this.done);
    this.r.tags.textContent = fmt.int(this.tags);
    this.r.avg.textContent = avg < 10 ? avg.toFixed(1) : Math.round(avg);
    this.r.elapsed.textContent = fmt.secs(e);
    this.r.cost.textContent = fmt.money(this.cost);
    if (now - this.lastP50 > 250) {
      this.lastP50 = now;
      this.updateP50();
      if (this.p50) {
        const big = this.p50 >= 1000;
        this.r.p50.textContent = big ? (this.p50 / 1000).toFixed(1) : Math.round(this.p50);
        this.r.p50unit.textContent = big ? 's' : 'ms';
      } else {
        this.r.p50.textContent = '–';
        this.r.p50unit.textContent = '';
      }
    }

    const r = this.latest;
    if (r && r !== this.shownStream && now - this.lastStream > STREAM_EVERY) {
      this.lastStream = now;
      this.shownStream = r;
      this.addCard(r);
    }
    if (r && r !== this.shownNow && now - this.lastNow > NOW_EVERY) {
      this.lastNow = now;
      this.shownNow = r;
      this.showNow(r);
    }
    if (now - this.lastBuckets > BUCKETS_EVERY) {
      this.lastBuckets = now;
      this.renderBuckets();
    }

    // radar eases toward the latest answer
    let pts = '';
    this.rv = this.rv.map((v, j) => v + (this.rt[j] - v) * 0.3);
    this.rv.forEach((v, j) => {
      const [x, y] = this.radarPoint(j, v);
      pts += `${x},${y} `;
      this.rDots[j].setAttribute('cx', x);
      this.rDots[j].setAttribute('cy', y);
    });
    this.rShape.setAttribute('points', pts);
  }

  chipsHtml(tags) {
    return INTENTS.map((x) => `<span class="chip${tags.includes(x.k) ? ' on' : ''}">${x.k}</span>`).join('');
  }

  addCard(r) {
    const c = document.createElement('div');
    c.className = 'card enter';
    c.innerHTML = `<div class="kw"></div><div class="row"><div class="chips">${this.chipsHtml(r.tags)}</div><span class="ms">${fmt.ms(r.ms)}</span></div>`;
    c.firstChild.textContent = r.keyword;
    this.r.stream.prepend(c);
    while (this.r.stream.children.length > 6) this.r.stream.lastChild.remove();
  }

  showNow(r) {
    this.r.nowKw.textContent = r.keyword;
    INTENTS.forEach((x, j) => {
      const p = this.probRows[j];
      const on = r.tags.includes(x.k);
      p.row.classList.toggle('off', !on);
      p.chip.classList.toggle('on', on);
      if (r.probs) {
        const v = r.probs[x.k];
        p.bar.style.width = v * 100 + '%';
        p.pct.textContent = Math.round(v * 100) + '%';
        this.rt[j] = Math.max(v, 0.02);
      } else {
        p.bar.style.width = on ? '100%' : '0';
        p.pct.textContent = on ? 'yes' : 'no';
        this.rt[j] = on ? 1 : 0.02;
      }
    });
    if (this.r.raw) this.r.raw.textContent = `→ "${r.text}"`;
  }

  renderBuckets() {
    INTENTS.forEach((x, j) => {
      const b = this.bEls[j];
      b.count.textContent = fmt.int(this.bcount[x.k]);
      b.share.style.width = (this.done ? (this.bcount[x.k] / this.done) * 100 : 0) + '%';
      const items = this.bitems[x.k];
      const key = items[0]?.i ?? null;
      if (key === b.lastKey) return;
      b.lastKey = key;
      b.stack.innerHTML = '';
      items.forEach((r, d) => {
        const s = document.createElement('div');
        s.className = 'scard' + (d === 0 ? ' drop' : '');
        s.style.transform = `translate(${d * 5}px, ${d * 7}px)`;
        s.style.zIndex = 10 - d;
        s.style.opacity = 1 - d * 0.22;
        s.innerHTML = '<div class="t"></div><div class="p"></div>';
        s.firstChild.textContent = r.keyword;
        s.lastChild.textContent = r.probs ? `${Math.round(r.probs[x.k] * 100)}% ${x.k}` : `text: "${x.name.toLowerCase()}"`;
        b.stack.appendChild(s);
      });
    });
  }
}
