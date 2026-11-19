# EpiAlert (web prototype)

Alerts nearby verified medical volunteers when someone needs help. It is **not** an ambulance service and does not replace 112 / 108. Blur, verification and notification delivery are best-effort.

Prototype scope: runs locally, in memory, no Firebase, no SMS (the login code is shown on screen), no real push notifications.

## Run it (needs only Node 20 or newer)

```
cd functions
npm install
npm test            # all tests
npm start           # builds and serves on http://localhost:3000
```

Open http://localhost:3000. Use a second private window as a second person.

- Demo admin phone: `+919999999999` (review queue, seed fake responders, fast-forward the demo clock).
- Any other phone number is a normal user.
- Demo registry (council must be `KMC`): `12345` Anita Desai is verified; `23456` Rohit Sharma, `34567` (inactive) and `45678` (blacklisted) are rejected; `56789` Kavya Shetty is ambiguous; any other number goes to manual review.

Quick demo: window 1 admin, click **Seed 8 demo responders here**. Window 2 normal user, **Send alert**. Back in the admin window use **+70 s**, **+3 min** and **+25 h** to show escalation, the "Call 108" notice and expiry.

## Reproduce the paper's numbers

```
cd functions
npm run experiments      # writes CSV, JSON and SVG files into ../paper/results
```

The simulation results (experiments 1 and 2) are deterministic for the fixed seeds. The geohash timing (experiment 3) and the latency run depend on the machine, so re-run them on your own laptop and quote that machine, not the one in the committed files.

## Layout

| Path | What |
|---|---|
| `web/` | Browser app (no framework, strict CSP, no inline script or style) |
| `functions/src/engine.ts` | Alerting engine: verification, eligibility, ranking, dedupe, escalation, expiry, audit |
| `functions/src/server.ts` | HTTP server, demo OTP login, live alerts over server-sent events |
| `functions/src/sim.ts`, `experiments.ts` | Simulations and measurements for the paper |
| `functions/test/` | Unit and HTTP tests |
| `docs/` | Spec, architecture, decisions, threat model, privacy, test report, progress |
| `paper/` | Citation ledger and generated results |

## Honest limits

- The browser UI has never been opened in a real browser. Only the HTTP API and pure functions are covered by tests, plus a scripted fake-DOM run. Layout, contrast, small-screen behaviour and the camera flow are unverified; the UI needs a recent Chrome or Safari.
- The paper in paper/ is an unfinished draft: it has not been compiled, 9 TODO markers remain, and only 3 of 36 candidate citations are verified.
- Browser face detection (`FaceDetector`) is not available in every browser. When it is missing the app sends no photo, but the alert still goes out.
- Latency numbers are loopback, one machine, no push service. They are not mobile-network latency.
- Simulation parameters (acceptance rate, travel speed, density) are assumptions, labelled as such in the paper.
