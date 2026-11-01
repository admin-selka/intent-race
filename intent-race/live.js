// Live data source: streams real results from the local server, one per keyword.

const Live = {
  async config() {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('server not reachable');
    return res.json();
  },

  run({ side, n, concurrency, onResult, onEnd }) {
    const es = new EventSource(`api/run?side=${side}&n=${n}` + (concurrency ? `&c=${concurrency}` : ''));
    const done = () => {
      es.close(); // also stops the browser from reconnecting and re-running the race
      onEnd?.();
    };
    es.addEventListener('result', (e) => onResult(JSON.parse(e.data)));
    es.addEventListener('end', done);
    es.onerror = done;
    return { stop: () => es.close() };
  },
};
