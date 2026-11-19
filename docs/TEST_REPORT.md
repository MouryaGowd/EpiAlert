# EpiAlert: TEST REPORT

Only real command output. Anything not listed here was not run.

## Run 1: functions pure-logic units (2026-11-20)

Environment: macOS, node 22.23.1, vitest 5.1.1, typescript 7.0.2. No emulators (Java missing).

**Red run** (tests written first, modules absent):
```
cd functions && npx vitest run
 Test Files  3 failed (3)
      Tests  no tests
Error: Cannot find module '../src/stateMachine.js' ...
```

**Green run** (after implementing `geo.ts`, `nameMatch.ts`, `stateMachine.ts`):
```
cd functions && npx vitest run
 Test Files  3 passed (3)
      Tests  41 passed (41)
```
```
cd functions && npx tsc -p tsconfig.json --noEmit
tsc exit: 0
```

Covers: haversine + 1.9 / 2.1 / 3.1 km radius cases from spec 3.3, name matching (case, honorifics, initials, mismatches, empty), every legal state transition and every event from each terminal state.

## Run 2: web prototype backend (2026-11-20)

```
cd functions && npx vitest run
 Test Files  8 passed (8)
      Tests  103 passed (103)
cd functions && npx tsc -p tsconfig.json     -> exit 0 (build to lib/)
node --check web/app.js, web/blur.js          -> syntax ok
```
Suites: geo, nameMatch, stateMachine, engine (verification, eligibility, ranking and cap, dedupe, rate limit, flagging, escalation, expiry, audit anonymity), photo (alert-first), otp (lockout, expiry, single use), blur (pixel destruction), server (real HTTP: auth, admin 403s, end-to-end flow, no poster identity leaked, time skip, path traversal, CSP).

**Not run:** the server was never started by me and the browser UI (`web/app.js`) has never been opened in a browser. Camera and face-blur code paths, canvas maps and live push in the UI are untested. The browser `FaceDetector` API is not available in all browsers; the UI fails closed (no photo) when it is missing.

## Run 3: simulations, measurements, tests (2026-11-20, Apple M1 Pro, node 22.23.1)

```
cd functions && npx vitest run            -> 9 files, 120 tests passed
cd functions && npx tsc -p tsconfig.json --noEmit   -> exit 0
cd functions && npx tsc -p tsconfig.build.json      -> exit 0
cd functions && node lib/src/experiments.js ../paper/results   -> done in ~15 s
```
Outputs in `paper/results/`: `exp1_strategies.csv/json`, `exp2_privacy.csv/json`, `exp3_index.csv/json`, `latency.csv/json`, `summary.json`, and SVG charts.

Bug found and fixed on the way: the first arrival-time metric was conditional on being reached (survivorship bias, made fixed 2 km look faster than broadcast). Added `withinDeadlinePct` (unconditional) with a test; the old metric stays in the CSV labelled reached-only. A second issue: vitest also ran compiled test copies in `lib/`; fixed with `vitest.config.ts` and `tsconfig.build.json`.

Headline numbers (all simulation with assumed parameters except exp3 and latency): see `paper/results/*.csv` and `paper/epialert.tex`. Exp3 timings vary between runs (50k responders: 10.0x in one run, 11.2x in another). Latency is loopback, one machine, in-memory, one responder: p50 1.96 ms, p95 2.55 ms, max 4.38 ms over 60 trials.

**Not run:** paper not compiled (tectonic needs a package download); sensitivity analysis for speed, deadline and acceptance probability not done; no browser test of the UI; no run of the UI redesign.

## Not run / not tested
- Rules tests, emulator integration, Android tests, latency, blur evaluation: not started.
- No Firebase emulator available yet (Java and firebase CLI not installed).
- Name-match limitation: strict equal token count, so a registry name with an extra middle name and a submitted name without one will not match (it goes to `needs_review`, which is the safe direction). Not yet tested against real-world name variety.
