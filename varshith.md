# EpiAlert: master build prompt (v2)

> Paste or point an autonomous coding agent at this file. It is a complete contract: what to build, how to build it, how to prove it works, and what you must never fake. Read the whole file before touching anything.

---

## 0. Contract with the agent

**You deliver three artifacts for one college major project:**

| # | Artifact | Location |
|---|---|---|
| A | A working, tested Android app plus Firebase backend | `app/`, `functions/`, `admin/`, rules files |
| B | A presentation | `ppt/EpiAlert.pptx` (+ speaker notes, + exported PDF) |
| C | An IEEE conference paper | `paper/epialert.tex` + compiled `paper/epialert.pdf` |

**Operating mode:** autonomous. Work in build-test-fix loops (section 9) until the Definition of Done (section 13) is fully green. Do not stop to ask questions for anything you can decide yourself; log each decision in `docs/DECISIONS.md`. Ask the user **only** for the blockers in section 12.

**Three rules above all others:**
1. **Evidence over claims.** "Done" means a command you ran produced output that proves it. Paste the real output (trimmed) into `docs/TEST_REPORT.md`.
2. **Never fake anything.** No invented numbers, citations, screenshots, user studies, or passing tests. If something was not measured, the report says "not measured".
3. **Never weaken a test to make it pass.** Fix the code, or change the test only with a written reason in `docs/DECISIONS.md`.

---

## 1. Project

**Name: EpiAlert.** Fixed, already submitted to the college. Package id `com.epialert.responder`.
It is unrelated to the CDC flu repo `github.com/Varshith-Reddy-M/EpiAlert`. Do not clone, reuse, or mention that repo's code or data.

**Problem.** When someone collapses or is hurt in a crowded place (gym, marathon, street), untrained bystanders rush in and pull, lift, or mishandle the person, and the injury gets worse. Meanwhile, medically trained people a few hundred metres away have no idea it is happening.

**Solution.** An Android app (Bangalore). A bystander posts an incident: a face-blurred photo, GPS location, problem type. Verified medical volunteers within 2-3 km are alerted immediately. A nearby doctor can reach the patient before the ambulance and give care until hospital handover. Posts auto-delete after 24 h.

**Positioning (state this everywhere, including the app):** EpiAlert alerts nearby medical *volunteers*. It is **not** an ambulance service and does not replace 112 / 108.

### 1.1 Fixed decisions (do not reopen)
- Android only. Bangalore. College major project: must be demo-able and finishable, not production-scale.
- Everyone logs in. Medical people upload proof and are verified **automatically**; verified people pick their specialities.
- Phone GPS on. Faces are **blurred automatically on the device** when a photo is taken in the app.
- Alert radius 2-3 km. Posts deleted after 24 h.
- **No first-aid instruction screen** (user decision: "only alert helpers").

### 1.2 Scope tiers
- **P0 (must ship):** login, responder registration + verification pipeline, on-duty location, incident post with blurred photo, radius alert via push, "I'm coming", resolve, 24 h expiry.
- **P1 (should ship):** radius escalation, duplicate-report merging, abuse controls, anonymised audit log, offline-tolerant posting, Kannada + English UI.
- **P2 (stretch, only after P0+P1 are green):** admin review web page polish, accessibility pass (TalkBack, large text), coverage simulation (section 11, experiment E3).

Cut P2 first if time is short. Never cut P0 tests.

---

## 2. Product spec

### 2.1 Personas
- **Bystander:** anyone logged in, at the scene. Stressed, one hand free, possibly bad network.
- **Responder:** verified doctor / nurse / paramedic / trained first-aider. Busy, will mute an app that spams them.
- **Reviewer (admin):** resolves the verifications automation could not decide.

### 2.2 User stories and acceptance criteria

**US-1 Login.** *As a user I log in with my phone number.*
- Given a valid OTP, then I am signed in with role `user`.
- Given a wrong OTP three times, then I am blocked for a cool-down.

**US-2 Become a responder.** *As a medical person I submit credentials.*
- Form: full name, qualification, registration number, **State Medical Council** (mandatory: numbers collide across councils), registration year, proof photo.
- Given the registry lookup returns a match with the same name and active status, then status `verified` and I get the `responder` claim.
- Given the lookup fails, times out, or is ambiguous, then status `needs_review`. **Never auto-approve and never silently reject.**
- Given a registry mismatch (name differs, or inactive, or blacklisted), then status `rejected` with a reason I can see.

**US-3 Choose specialities and go on duty.**
- Verified responders pick one or more of: cardiac, trauma/bleeding, bone/spine, breathing/choking, general.
- Only an **on-duty** responder shares location. Toggling off stops location sharing immediately.

**US-4 Post an incident.**
- Camera-only capture (no gallery picker). Faces blurred on device before anything is uploaded.
- GPS auto-filled with accuracy shown; problem type + optional short note.
- A banner is always visible: "Call 112 / 108 first. EpiAlert alerts nearby medical volunteers; it is not an ambulance service."
- **The alert must never wait for the photo** (see ADR-1).

**US-5 Get alerted.**
- Given an on-duty verified responder within the current radius, then a high-priority push arrives showing problem type, distance, matching speciality, and Accept / Dismiss actions.

**US-6 Respond.**
- "I'm coming" is shown to the poster as responder count + rounded distance.
- Navigate opens Google Maps. Either side can mark "Handed to ambulance / resolved".

**US-7 Expiry.** Incident, responses, and photo are gone from the user's view after 24 h and physically deleted soon after (section 4.6).

**US-8 Abuse.** Responders can flag a post as false. Repeated false posts suspend the poster. Post rate is limited.

---

## 3. Architecture

```
 Android app (Kotlin, Compose)                    Firebase
 ┌──────────────────────────┐        ┌──────────────────────────────────────┐
 │ Auth (phone OTP)         │───────▶│ Auth  ── custom claims: responder    │
 │ Responder registration   │        │ Firestore                            │
 │ Camera → ML Kit → blur   │        │   users, responderProfiles(private)  │
 │ Post incident (alert 1st)│        │   responderLive(server-read only)    │
 │ On-duty foreground svc   │        │   incidents (+responses, +alerts)    │
 │ FCM receiver + actions   │◀───────│   auditLog (anonymised), blacklist   │
 └──────────────────────────┘  push  │ Storage: proofs(private), photos(24h)│
                                     │ Cloud Functions (TS, 2nd gen)        │
 Admin review page (static web) ────▶│   verifyResponder, onIncidentCreated │
                                     │   respondToIncident, escalateStale,  │
                                     │   expireSweeper, flagIncident        │
                                     │ FCM (via injected Notifier)          │
                                     └──────────────────────────────────────┘
```

**Stack (change only with a written reason):** Kotlin + Jetpack Compose + CameraX; Firebase Auth, Firestore, Storage, Cloud Functions (Node 20, TypeScript), FCM; Google Maps SDK; ML Kit Face Detection; `geofire-common`. Use **current stable** versions; look up the real latest versions rather than trusting memory.

**Testability seams (mandatory):** every external dependency sits behind an interface that tests can fake:
- `Verifier` (registry lookup): `MockVerifier`, `ManualReviewVerifier`, optional real provider.
- `Notifier` (FCM): `FcmNotifier`, `FakeNotifier` that records sends. Automated tests never hit real FCM.
- `Clock`: inject time so escalation, expiry, and rate limits are testable without sleeping.

### 3.1 Data model (Firestore)

| Path | Fields | Who can read / write |
|---|---|---|
| `users/{uid}` | displayName, status (`active`/`suspended`), fcmToken, createdAt, falseFlagCount, locale | read/write own, except `status` and `falseFlagCount` are server-written |
| `responderProfiles/{uid}` | qualification, regNo, council, regYear, proofPath, verificationStatus (`pending`/`verified`/`needs_review`/`rejected`/`revoked`), verifiedBy (`registry`/`manual`), reason, specialities[] | own read; own create; status fields server-only; admin read all |
| `responderLive/{uid}` | onDuty, lat, lng, geohash, updatedAt, fcmToken, specialities[] | **no client reads at all**; client writes only own doc and only with the `responder` claim; server reads |
| `incidents/{id}` | createdBy, createdAt, **expireAt**, location{lat,lng,geohash,accuracyM}, problemType, note, photo{state: `none`/`pending`/`ready`/`rejected`, path}, status, ackCount, radiusKm, alertedCount, clusterId, flagCount | poster read own; alerted responders read; **never** world-readable; expired docs unreadable by rule |
| `incidents/{id}/alerts/{uid}` | alertedAt, distanceM, deliveryState | server-written; its existence grants that responder read access |
| `incidents/{id}/responses/{uid}` | state (`coming`/`arrived`/`cancelled`), at, distanceM(rounded) | responder writes own via function; poster reads |
| `auditLog/{id}` | ts, roughArea (geohash prefix, not exact), problemType, outcome, alertedCount, ackCount, timeToFirstAckS | server-only. **No photo, no names, no uids.** |
| `blacklist/{regKey}` | reason, addedAt | admin/server only |

Use **custom claims** (`responder: true`, `admin: true`), set only by Cloud Functions, for rule checks. Rules must also have a test for each denial.

### 3.2 Incident state machine

```
 OPEN ──(first "I'm coming")──▶ ACKNOWLEDGED ──(resolve)──▶ RESOLVED
  │                                   │
  ├──(poster cancels)────────────────┼──▶ CANCELLED
  ├──(flagCount ≥ threshold)─────────┼──▶ FLAGGED (hidden, poster penalised)
  └──(now ≥ expireAt)────────────────┴──▶ EXPIRED (then deleted)
```
Every transition is performed by a function in a transaction. Clients cannot write `status` directly. Test every legal and illegal transition.

### 3.3 Alert algorithm (Cloud Function `onIncidentCreated`)

1. **Dedupe:** if an OPEN/ACKNOWLEDGED incident exists within 100 m and 10 min, attach this report to it (`clusterId`, `reportCount++`), do **not** re-alert. Tell the second poster "already reported, help is being alerted".
2. **Candidates:** query `responderLive` with `geofire-common` `geohashQueryBounds(center, radius)`, then **filter exactly** with the haversine distance (geohash boxes over-fetch).
3. **Eligibility filters:** `onDuty` and `updatedAt` within the freshness window (default 10 min) and verified (claim) and not suspended and not the poster.
4. **Rank:** speciality match first, then distance. **Cap at N = 20** per ring to avoid alert fatigue.
5. **Send** high-priority FCM *data* messages through `Notifier`; record each send in `alerts/{uid}`. Batch within FCM limits.
6. **Escalate by lack of acceptance, not lack of existence** (`escalateStale`, runs every minute):
   - radius 2 km, `ackCount == 0` at 60 s: widen to 3 km, alert only responders not already alerted.
   - `ackCount == 0` at 180 s: notify the poster honestly: "No volunteer has accepted yet. Call 108."
7. Write the anonymised `auditLog` entry when the incident ends.

Prove it with unit tests at 1.9 km (in), 2.1 km (out at first ring, in after escalation), 3.1 km (always out).

---

## 4. Key design decisions (ADRs, copy into `docs/DECISIONS.md` and keep them current)

**ADR-1: Alert first, photo later.** The incident document is created and the alert fires the moment the user submits, with `photo.state = pending`. The blurred photo uploads afterwards and attaches. A slow network or failed blur must never delay the alert. If blur fails, the photo is rejected and the alert still stands.

**ADR-2: Blur fails closed, the alert does not.**
- Run ML Kit face detection in accurate mode. Blur every detected face region with strong pixelation or a heavy Gaussian, applied to the **pixels** (not an overlay layer), then re-encode.
- Strip **all EXIF** (especially GPS) from the uploaded image.
- Keep the original only in memory or app-private cache and delete it right after processing. Never write it to shared storage. Never upload it.
- "Zero faces detected" is **not** proof of "no faces" (turned heads, masks, small faces). Show the blurred preview and require the user to confirm "no identifiable faces visible" or retake, or post without a photo.
- Describe blur honestly as best-effort in the app, the report, and the paper.

**ADR-3: Responder location is a liability, so minimise it.** Only on-duty verified responders store location. It lives in `responderLive`, which **no client can read**. The poster only ever sees a responder's *rounded* distance (to the nearest 100 m), and only after that responder tapped "I'm coming".

**ADR-4: Expiry is enforced three ways.** Firestore TTL on `expireAt` is **not prompt** (it can lag well beyond the expiry time; confirm in current docs), so:
1. Security rules deny reads where `expireAt <= request.time`.
2. An `expireSweeper` function deletes expired incidents and their Storage photos.
3. A Storage lifecycle rule deletes photos at age 1 day as a backstop.
Test that an expired incident is unreadable even before the sweeper runs.

**ADR-5: Responder safety.** The system could be abused to lure a responder to a harmful place. Mitigations: authenticated phone number, post rate limit, flagging and suspension, poster identity never shown to responders, in-app "scene safety first, do not enter an unsafe scene, call 112" text on every alert, and an honest entry under Limitations.

**ADR-6: Verification is an interface, with a human fallback.**
- There is **no official public NMC API**. ABDM's Healthcare Professionals Registry is the official route, but its access terms are unconfirmed. Research the *current* reality, and the legality and terms of any unofficial scraping, **before** wiring a real provider. Document what you found with sources.
- Ship `MockVerifier` (deterministic, for tests and demo) and `ManualReviewVerifier` first. A real provider is optional and sits behind a feature flag.
- Name matching must be tolerant (case, initials, honorifics like "Dr.") but strict on active status and council.

---

## 5. Android specifics (get these right, they are where such apps usually break)

- **minSdk 26**, compile and target the current stable SDK. Verify real API behaviour rather than guessing.
- **Permissions flow**, in this order, each with a plain-language rationale screen: `POST_NOTIFICATIONS` (13+), fine location, then **background location as a separate step** (Android 11+). The responder foreground service is the primary mechanism; background location is the fallback.
- **On-duty foreground service:** declare `foregroundServiceType="location"` plus the matching permission (Android 14+), a persistent notification, and update location on significant movement or interval rather than continuously (battery).
- **FCM:** data-only, `priority=high` messages handled in a `FirebaseMessagingService`. Build a heads-up notification on a **HIGH importance channel** with Accept / Dismiss actions. Do not rely on full-screen intents (restricted on Android 14+ for non-calling apps). Handle **token refresh** and stale tokens (remove them on `UNREGISTERED`).
- **Doze and OEM battery killers:** include a "Make alerts reliable" screen that guides the responder to disable battery optimisation for the app. Record in the report which behaviours you tested and which you did not.
- **Camera:** CameraX, camera-only. The processing pipeline runs off the main thread and has a hard timeout.
- **Offline:** posting with poor connectivity queues the incident and retries with backoff. Show clear state ("sending", "sent", "no network, retrying"). The 112/108 banner works offline.
- **Localisation:** English + Kannada string resources (P1). No hard-coded UI strings.
- **Security:** no secrets in the repo. `google-services.json` and the Maps key are supplied by the user (section 12) and git-ignored; provide `*.example` templates.

---

## 6. Security and privacy

- **Rules matrix** (`docs/THREAT_MODEL.md`): for every collection and Storage path, list who may read/write what, and write a rules test for every allow **and** every deny.
- **Threat model** (STRIDE-style, short): fake doctor, fake incident (lure), location stalking via responder data, photo re-identification, token theft, replayed or forged function calls, enumeration of incidents. Each gets a mitigation or an explicit "accepted risk" entry.
- **Data minimisation:** the poster's location is read once at post time. Ordinary users' location is never stored. Proof documents are private, used only for review, and deleted after a decision (state the retention you chose).
- **Privacy note (`docs/PRIVACY.md`):** purpose, data collected, retention, deletion, who sees what. Reference India's **Digital Personal Data Protection Act, 2023**; check whether its rules have been notified and say exactly what you verified rather than assuming.
- **Legal framing:** responders are voluntary Good Samaritans. Look up the current Indian Good Samaritan provisions (the Motor Vehicles Act amendment and the Supreme Court guidelines), cite them only after confirming the wording, and do **not** present the app as providing legal immunity.
- **No real patient photos or real personal data** anywhere in the repo, tests, PPT, or paper.

---

## 7. Repository layout (in `/Users/mourya/Rubrik/epa`)

```
app/                 Android app (ui/, data/, location/, blur/, notify/)
functions/           Cloud Functions + tests (src/, test/)
admin/               minimal static review page
firestore.rules  storage.rules  firestore.indexes.json  firebase.json
docs/                SPEC.md ARCHITECTURE.md DATA_MODEL.md DECISIONS.md
                     THREAT_MODEL.md PRIVACY.md TEST_REPORT.md PROGRESS.md
                     DEMO_SCRIPT.md VIVA_QA.md  evidence/
ppt/                 build script, EpiAlert.pptx, EpiAlert.pdf, screenshots/
paper/               epialert.tex, references.bib, figures/, epialert.pdf
scripts/             seed-demo.ts, measure-latency.ts, blur-eval/, simulate-coverage.ts
README.md
```
Commit in small steps with clear messages. Never commit secrets, `google-services.json`, keys, or real photos.

---

## 8. Phase 0: preflight (before any code)

1. Check the toolchain and report exactly what is present and what is missing: `java -version`, `node -v`, `npm -v`, `python3 --version`, `git --version`, Android SDK and `adb`, an emulator or AVD, `firebase` CLI, a TeX engine (`pdflatex` or `tectonic`), and LibreOffice (for PPT render checks).
2. Write `docs/PROGRESS.md` with: current milestone, last green commit, what is next, open blockers. **Update it after every loop.** If your context is reset, this file is how you resume.
3. Freeze the spec: turn sections 1-6 into `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/THREAT_MODEL.md`.
4. Anything missing that you need and cannot install safely goes to the blockers list (section 12). Ask before installing system software.

---

## 9. Build-test-fix loop (the heart of the process)

**For each milestone M1..M8:**

1. **Plan:** a short plan (files, tests, risks) appended to `docs/PROGRESS.md`.
2. **Test first where practical:** write the failing test for the behaviour, then implement.
3. **Implement** the smallest slice that satisfies the milestone's exit gate.
4. **Run everything relevant** (not just the new test) and read the real output.
5. **If anything fails:** find the root cause, fix it, re-run. Do not paper over it with try/catch or retries that hide the failure.
6. **Record** in `docs/TEST_REPORT.md`: what was run, the exact command, the exact result, what failed, what was fixed.
7. **Commit** only when the gate is green. Update `docs/PROGRESS.md`.

**Stuck rule:** after 3 failed attempts at the same problem, stop patching. Write down what you know, what you tried, and your best hypotheses, then change approach (different design, or a smaller step). If still stuck, record it as a blocker and continue with independent work.

**Milestones and exit gates:**

| M | Scope | Exit gate (all must be true) |
|---|---|---|
| M1 | Skeleton: app + Firebase emulators, phone-OTP auth, roles/claims, navigation | App builds; OTP login works against the Auth emulator; claim set only by a function |
| M2 | Responder registration, `Verifier` interface + Mock + Manual, admin review queue, speciality picker | Verified / needs_review / rejected paths all tested; name-match unit tests green |
| M3 | Location permissions, on-duty foreground service, `responderLive` geohash writes, freshness | Writes only when on duty; rules deny client reads; permission flow tested on emulator |
| M4 | Incident posting: CameraX, ML Kit blur, EXIF strip, map pin, alert-first upload (ADR-1/2) | Blur pipeline tests pass; no original ever uploaded; post succeeds with photo blocked |
| M5 | Alerting: radius query, `Notifier`, FCM receiver, Accept action, live poster status, dedupe | Only eligible responders notified (fake notifier asserts); dedupe works |
| M6 | Escalation + expiry: `escalateStale`, `expireSweeper`, rules hiding expired, Storage lifecycle, audit log | Injected-clock tests pass for 60 s/180 s escalation and 24 h expiry; audit log has no PII |
| M7 | Hardening: rate limits, flag/suspend, offline queue, error states, Kannada strings | Abuse and offline scenarios tested; no untranslated strings |
| M8 | Demo build: seeded Bangalore responders, scripted run-through, README from scratch | A fresh clone follows the README and reaches a working demo |

---

## 10. Testing (required, and be explicit about what was not tested)

**Pyramid:**
- **Unit (functions, TS):** haversine + geohash radius filter; ranking; name matching; state-machine transitions (legal and illegal); rate limiter; expiry maths. Use an injected `Clock`.
- **Rules tests** (`@firebase/rules-unit-testing`): every collection and Storage path, every allow and every deny, including: a normal user cannot read `responderLive`; a responder cannot read an incident they were not alerted to; an expired incident is unreadable; a client cannot write `status`, claims, or `alerts`.
- **Function integration (Firebase Emulator Suite):** seeded incident notifies *only* on-duty, verified, fresh, in-radius, non-suspended responders. Unverified, off-duty, stale-location, out-of-radius, and the poster themselves are never notified. Dedupe, escalation, resolve, expiry, and audit-log paths each have a test.
- **Android unit tests:** blur pipeline logic, EXIF stripping, offline queue, notification action handling.
- **Android instrumented / UI tests (emulator):** login, post flow, alert flow, permission flow.
- **Failure injection:** stale or invalid FCM token, `Notifier` failure mid-batch, duplicate delivery of the same trigger (functions must be **idempotent**), clock skew, poster goes offline mid-post, verifier timeout.

**Measurements to report (real numbers only):**
- **Blur evaluation:** a labelled multi-face image set with a licence you checked (or consented photos of your own team, kept out of the repo). Report face recall and the blur-verification result (re-run the detector on the output; compare the face region against the original), including every miss. State the dataset, its size, and its licence.
- **Latency:** instrument `post submitted → function started → FCM send acknowledged → device received`. Run **at least 30 trials**; report p50 / p95 / max with the conditions (emulator vs device, network, region). Say whether clocks were shared.
- **Alert precision:** over a seeded population, the fraction of notifications sent to eligible responders must be 100%, and the fraction of eligible responders missed must be reported.

Every report states what was **not** tested (for example "real-device Doze behaviour untested" if no phone was available).

---

## 11. Deliverable B: PPT, and Deliverable C: IEEE paper

### 11.1 PPT (`ppt/EpiAlert.pptx`, 14-16 slides, 16:9)
Build with a script (python-pptx or pptxgenjs) so it is reproducible. One idea per slide, large type, at most about 30 words of body text, diagrams over bullets. **Speaker notes on every slide.**

1. Title (EpiAlert, team, guide, college)
2. The problem: the first minutes (bystander harm)
3. Why existing options fall short (ambulance-only, no nearby-volunteer layer); cite real sources only
4. The idea in one sentence + 112/108 positioning
5. Users and roles
6. System architecture diagram
7. Verification flow (registry → name match → manual fallback)
8. Alert flow and radius escalation (diagram of 2 km → 3 km)
9. Privacy by design: on-device face blur, EXIF strip
10. Data lifecycle: 24 h expiry, triple enforcement
11. Security and abuse controls, threat model summary
12. Tech stack and why
13. Live app: **real screenshots from the emulator/device** (`adb exec-out screencap -p`)
14. Test results: the measured numbers, charts from real data
15. Limitations and honest risks
16. Future work (more cities, ambulance/108 integration, first-aid guidance, iOS) + conclusion + references

**QA step:** export to PDF, render to images, and *look* at them: no overflow, no clipped text, no placeholders, consistent fonts. Fix and re-render.

### 11.2 `docs/VIVA_QA.md`
Write at least 30 likely examiner questions with crisp, honest, project-specific answers: "How do you verify doctors?", "What if the blur misses a face?", "What stops fake alerts?", "Why Firebase?", "What if no doctor is nearby?", "How do you handle battery drain?", "Is this legal?", "What did you actually measure?". Answers must match the code and the real results.

### 11.3 IEEE paper (`paper/epialert.tex`, IEEEtran conference template, 6-8 pages)
Sections: abstract, keywords, introduction, related work, system design, implementation, privacy and ethics, evaluation, limitations, conclusion, references.

- **Citations protocol:** keep `paper/references.md` as a ledger: each entry has the source, the URL or DOI, the date you opened it, and "verified: yes/no". Only entries marked verified go in `references.bib`. **Never cite from memory.** If you cannot verify a source, leave it out.
- **Evaluation contains only what you ran:** blur results, latency results, rules/function test summary, and (optional experiment **E3**) a **clearly labelled Monte Carlo simulation** of time-to-first-responder versus responder density and radius, with every assumption written down and labelled "assumed" unless sourced. It is a simulation, not a field study. Do not claim user studies, pilots, or adoption numbers.
- **Figures:** architecture, alert/escalation flow, latency distribution, blur results. Generated from real data by scripts in `scripts/`.
- Compile with the available TeX engine and fix every error and overfull box that matters. If no TeX engine exists, ask the user before installing one (section 12). If it still cannot be compiled, say so plainly and hand over the `.tex`.

---

## 12. When to ask the user (the only valid reasons)

Ask, once, in one batched message, for:
1. A **Firebase project** and its `google-services.json` (and confirmation of billing plan; deploying Cloud Functions needs the pay-as-you-go plan, verify current terms; everything in the emulator is free).
2. A **Google Maps API key** (or confirmation to use a placeholder for emulator demos).
3. A **physical Android device** (or permission to report device-only behaviours as untested).
4. **Permission to install** missing system tools (TeX engine, LibreOffice, Android SDK components).
5. Team and college details for the title slide and the paper (names, guide, institution).

Everything else, decide it, log it in `docs/DECISIONS.md`, and keep going.

---

## 13. Definition of Done (the loop ends only when every box is true)

- [ ] App builds cleanly; the full flow works end to end: login → become verified responder → on duty → post incident with blurred photo → in-radius responder gets the push → "I'm coming" → resolved → incident and photo expire.
- [ ] Alert fires with no photo and with a failed-blur photo (ADR-1).
- [ ] All unit, rules, emulator-integration, and Android tests pass; `docs/TEST_REPORT.md` shows the final green run with real command output.
- [ ] Rules tests cover every deny listed in section 10.
- [ ] Latency and blur numbers are measured and recorded, with conditions and limits.
- [ ] `docs/THREAT_MODEL.md`, `PRIVACY.md`, `DECISIONS.md` are complete and match the code.
- [ ] PPT opens, has no placeholder text, uses only real screenshots and real numbers, and passed the render check.
- [ ] `docs/VIVA_QA.md` has 30+ answers consistent with the code.
- [ ] Paper compiles to PDF with IEEEtran; every reference is marked verified in `references.md`; no claim exceeds what was measured.
- [ ] README lets a new person run everything from a fresh clone.
- [ ] No secrets, keys, or real personal data in git (`git log -p` spot-check and a secret scan).

---

## 14. Honesty rules (non-negotiable)

- Never invent results, benchmarks, user studies, citations, screenshots, or test output.
- If a requirement cannot be met (for example the registry lookup is unavailable or legally dubious), say so, use the documented fallback, and record it.
- Blur is best-effort. Verification automation is best-effort. Notification delivery on Android is best-effort. Say so plainly in the app, the report, and the paper.
- Do not describe EpiAlert as a medical device, a diagnosis tool, or a replacement for emergency services.
- If you find a flaw in this prompt (a contradiction, an infeasible requirement), say so in `docs/DECISIONS.md`, choose the safest reasonable interpretation, and continue.

---

## 15. Final report (your last message)

Give the user, concisely:
1. What was built (one paragraph) and where everything is.
2. How to run it (the exact commands).
3. Test results with exact numbers (and the commands that produced them).
4. Measured blur and latency figures, with conditions.
5. **What is untested, limited, or assumed.**
6. Open blockers or decisions that need the user.
7. Where the PPT, paper, and viva Q&A are.
