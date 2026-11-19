# EpiAlert: progress (resume file)

Update after every loop. If context is reset, start here, then read `varshith.md`.

## Current milestone
Phase 0 (preflight). Docs frozen, no application code yet. Next: M1.

## Last green commit
None for EpiAlert. `epa/` is not tracked by its own git (parent repo `/Users/mourya/Rubrik` shows `?? ./`). Decision pending with the user: `git init` inside `epa/`. Parent repo is not to be changed.

## Toolchain (checked 2026-11-20)
| Tool | State |
|---|---|
| node 22.23.1, npm 10.9.8, python3 3.14.5, git 2.53.0, tectonic | present |
| java, Android SDK / adb, firebase CLI, LibreOffice | **missing** (install needs user permission) |

## Latest stable versions (npm view, 2026-11-20)
typescript 7.0.2, firebase-functions 7.4.0, firebase-admin 14.5.1, firebase-tools 15.37.0, geofire-common 6.0.0, @firebase/rules-unit-testing 6.0.0, vitest 5.1.1.
Android: AGP 9.5.0 listed on developer.android.com (October 2026); not confirmed as stable. Kotlin, Compose BOM, CameraX, Firebase Android BoM: **not yet verified**.
Note: firebase-functions declares engines node >=18; spec says Node 20 for functions runtime. Check the currently supported Cloud Functions runtimes before pinning (open item, see DECISIONS D-5).

## User decisions (2026-11-20)
- **Emulator-only prototype.** No Firebase project, no billing, no deploy. Maps key is a placeholder. Device-only behaviour is reported untested.

## Status update (2026-11-20, later)
- Direction changed: **web prototype first**, bigger scope aimed at a publishable paper. Android and Firebase are deferred.
- This laptop cannot be granted permissions. **Everything that needs permission is to be done on the user's other laptop**: run the server, open it in Chrome, run `npm run experiments`, compile the paper (tectonic downloads packages on first use), build slides. See README.md.
- Done here: engine, server, tests (120 passing, `npm test` in `functions/`), experiments 1-3 and a loopback latency run (results in `paper/results/`, produced on this laptop; re-run on the other).
- In flight when the user switched laptops: a UI redesign agent (writes `web/`), a citation-ledger agent (writes `paper/references.md`, `references.bib`, `related_work_notes.md`). Their results are unverified until checked.
- Written: `paper/epialert.tex` (uses only the 3 verified citations; every other citation need is a red `\todo{}`). NOT compiled yet.
- Citation agent finished: 3 of 36 sources verified (ringh2015mobile, hasselqvist2015early, firebase_ttl). The other 33 are candidates seen only in search snippets. On the other laptop: open each DOI or official page, check the claim, then mark verified and add to `references.bib`.
- Unresolved facts to check from official sources: DPDP Rules notification date (13 vs 14 Nov 2025), MVA s.134A exact wording and scope (motor-vehicle accidents only), whether NMC has any public API, geohash reference, Android location foreground service docs.
- Not yet written: slides, viva Q&A, a sensitivity analysis for experiment 1 (deadline, travel speed, acceptance probability), a real-browser test pass, `\todo` items in the paper (authors, related work, repo URL).
- UI redesign agent was still running at last check; `web/app.js` may be old while `index.html` and `style.css` are new. Do not trust the UI until it finishes and you open it in Chrome.

## Status update 3 (2026-11-20)
- **Slides:** `ppt/EpiAlert.pptx` (16 slides, speaker notes on all), built by `python3 ppt/build_deck.py` with the standard library only. Numbers are read from `paper/results/`. Package structure checked (all XML parses, all relationships resolve). **Not opened in PowerPoint or rendered**, so layout is unchecked; LibreOffice was not available. Contains no screenshots (the UI has not been run in a browser). Slide 1 needs team, guide and institution added.
- **Viva:** `docs/VIVA_QA.md`, 34 questions, numbers checked against `paper/results/`.
- **Sensitivity analysis:** done (`exp4_sensitivity.csv`). Finding: the 7.3-point on-time gap between escalation and a fixed 3 km ring holds only at the defaults (20 km/h, 10 min); it falls under 1 point at 30 km/h or a 15-minute deadline. Paper updated, including Table `tab:e4`.
- **Timings re-run:** geohash speedup at 50k responders varied 7.6x to 11.2x over three runs; paper now reports the range. Latency final run p50 1.94 ms, p95 2.71 ms, max 3.59 ms.
- **UI redesign finished (2026-11-20).** web/app.js (1,636 lines), style.css and index.html are the new version and were pushed. Checked: syntax, no forbidden patterns, every API route used exists, runtime-built CSS classes all defined, 120 tests pass, plus a fake-DOM smoke run by the agent that wrote it. **Still never opened in a real browser**: layout, contrast, 360 px width, camera and photo flow, and the :has(), color-mix() and inert features are unverified.
- (Superseded) UI redesign agent still running. `web/style.css` (926 lines) and `index.html` are new, `web/app.js` is still the OLD version (last written 00:41), so the UI is probably inconsistent until the agent writes the script.
- **Unsupported claim removed** from slide 3 (no verified literature on novelty).
- Still open: compile the paper, verify 33 citations, authors/institution, related work, UI browser test.

## Done
- `functions/` scaffolded (TS, vitest 5.1.1, typescript 7.0.2). Pure logic done test-first: `geo.ts`, `nameMatch.ts`, `stateMachine.ts`. 41 tests green, tsc clean. See TEST_REPORT Run 1.
- Read `HANDOFF.md` and `varshith.md`.
- Created `docs/` and wrote SPEC, ARCHITECTURE, DATA_MODEL, DECISIONS, THREAT_MODEL, PRIVACY.
- Researched registry, DPDP, Firestore TTL (sources in DECISIONS and `paper/references.md`).

## Next
1. Verify Kotlin / Compose BOM / CameraX / Firebase Android BoM versions from official release pages.
2. Send the batched blocker message (below).
3. M1: skeleton, emulators, phone-OTP auth, claims. Failing test first. Functions side (TS, emulator) can start without Java only for unit tests; rules tests and emulators need Java.

## Open blockers (ask the user once, batched)
1. Firebase project + `google-services.json` + billing plan.
2. Google Maps API key, or OK to use a placeholder for emulator demos.
3. Physical Android device, or OK to mark device-only behaviour untested.
4. Permission to install: Java (JDK), Android SDK + emulator, firebase CLI, LibreOffice.
5. Team names, guide, institution.
6. Whether `epa/` gets its own `git init`.
