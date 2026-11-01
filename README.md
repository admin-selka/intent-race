# Intent Race

A side-by-side race: **Jev**, a decision model that answers typed questions instead of writing text, against a frontier LLM, on the same job. Classify 1,000 search keywords by intent and watch speed and cost add up live.

Built Sep 2026.

## What it does

Every keyword gets the same four intent definitions on both sides:

- **I** informational: wants to learn or get an answer
- **C** commercial: comparing options before buying
- **T** transactional: wants to buy, sign up or book now
- **N** navigational: looking for a specific brand or page

**Jev** answers four yes/no questions per keyword and returns a probability for each. Anything at 50% or more becomes a tag. The output is typed by construction, so there's no text to parse and nothing to hallucinate.

**The LLM** gets the same definitions as a prompt, answers in text, and its reply is parsed into tags.

Both sides send one keyword per call, with the same number of calls running at a time. The page streams results and tracks calls done, time per call and total cost on each side.

## Modes

- **default:** Jev side makes real API calls. The LLM side is simulated from measured call times and list prices, and its labels are set for the demo.
- `?live`: both sides make real calls (needs credits for both).
- `?sim`: both sides simulated, replaying recorded answers.

Measured on Sep 26 2026: Jev about 0.42s per call (four questions), the LLM about 2.5s.

## Run it

```
npm install
cp .env.example .env   # OpenRouter or Vercel AI Gateway key
npm start
```

Then open http://localhost:5180/intent-race/

## Files

```
server.mjs                  one local server for the tools, keeps the key server side
intent-race/
  api.mjs                   the Jev and LLM calls, shared intent definitions
  app.js, ui.js, style.css  the race UI
  sim.js, live.js           simulated and live modes
  record-jev.mjs            runs every keyword through Jev once and saves the answers
  keywords.txt              the 1,000 keywords
```
