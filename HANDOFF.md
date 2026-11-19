# EpiAlert: session handoff

Written 2026-11-20 at the end of a session that only did setup and inspection. No application code exists yet.

## Read first

1. `varshith.md` is the full build contract (v2). It is the source of truth for scope, architecture, ADRs, milestones M1-M8, test rules, and the Definition of Done. Read all of it before writing code.
2. `docs/PROGRESS.md` does not exist yet. Create it first (spec section 8, step 2). It is the resume file the spec relies on.

## Current state

| Item | State |
|---|---|
| Source code (`app/`, `functions/`, `admin/`, rules) | Not started |
| `docs/` (SPEC, ARCHITECTURE, DATA_MODEL, DECISIONS, THREAT_MODEL, PRIVACY, TEST_REPORT, PROGRESS, DEMO_SCRIPT, VIVA_QA) | Not started |
| `ppt/`, `paper/`, `scripts/` | Not started |
| Milestone | Before M1 (Phase 0, preflight) |
| Last green commit | None for EpiAlert |

`epa/` is **not tracked** by its own git. `git rev-parse --show-toplevel` returns `/Users/mourya/Rubrik`, which is a parent repo whose `status` shows `?? ./` for this folder. Nothing in `epa/` has been committed. Decide whether `epa/` should get its own `git init` before M1 so commits stay separate from the parent repo. Ask the user if unsure. Do not change the parent repo.

## Toolchain (checked 2026-11-20)

| Tool | Status | Version / note |
|---|---|---|
| node | present | v22.23.1 |
| npm | present | 10.9.8 |
| python3 | present | 3.14.5 |
| git | present | 2.53.0 |
| tectonic | present | TeX engine for the IEEE paper; `pdflatex` is absent |
| java | **missing** | `Unable to locate a Java Runtime`. Needed for the Android build |
| Android SDK / `adb` | **missing** | `ANDROID_HOME` unset, no SDK under `~/Library/Android/sdk` |
| firebase CLI | **missing** | Needed for emulators and deploys |
| pdflatex | missing | Not needed if tectonic is used |
| LibreOffice (`soffice`) | **missing** | Needed for the PPT render check |

Installing Java, the Android SDK, the firebase CLI, and LibreOffice needs user permission (spec section 12, item 4). Ask before installing. Do not install silently.

## Blockers to ask the user (one batched message, spec section 12)

1. Firebase project and `google-services.json`, plus the billing plan. Cloud Functions deploys need pay-as-you-go. Emulators are free.
2. Google Maps API key, or permission to use a placeholder for emulator demos.
3. A physical Android device, or permission to mark device-only behaviour as untested.
4. Permission to install the missing tools listed above.
5. Team names, guide, and institution for the title slide and the paper.

Everything else is decided by the agent and logged in `docs/DECISIONS.md`.

## Next steps (in order)

1. Create `docs/PROGRESS.md` with the current milestone (Phase 0), this state, and the blocker list.
2. Create the `docs/` spec files from sections 1-6 of `varshith.md`. Log any contradictions or infeasible points in `docs/DECISIONS.md` (section 14).
3. Check the real latest stable versions of Kotlin, Compose, CameraX, Firebase, and the Node/TypeScript toolchain. Do not trust memory (spec section 3).
4. Research the Indian medical-registry situation (NMC has no public API, ABDM registry terms are unconfirmed) and the DPDP Act rules status. Record sources in `docs/DECISIONS.md` and `paper/references.md`, marked verified or not. Do not cite from memory (ADR-6, section 6, section 11.3).
5. Send the batched blocker message to the user. Continue with independent work while waiting.
6. Start M1: skeleton, emulators, phone-OTP auth, roles and claims. Write the failing test first where practical.

## Decisions already fixed (do not reopen)

- Android only, Bangalore, Kotlin + Compose, minSdk 26.
- Alert first, photo later (ADR-1). Blur fails closed, the alert does not (ADR-2).
- Responder location is in `responderLive`, which no client can read (ADR-3).
- Expiry enforced three ways: rules, `expireSweeper`, Storage lifecycle (ADR-4).
- Verification is an interface, with `MockVerifier` and `ManualReviewVerifier` shipped first (ADR-6).
- No first-aid instruction screen (user decision).
- Positioning: alerts volunteers, not an ambulance service. Do not present it as a medical device.

## Traps to watch for

- The spec says the repo is unrelated to `github.com/Varshith-Reddy-M/EpiAlert`. Do not clone, reuse, or mention that repo's code or data.
- No real patient photos or personal data anywhere in the repo, tests, PPT, or paper.
- Never weaken a test to make it pass. Never write a result that was not produced by a command you ran.
- Keep blur and verification described as best-effort everywhere.
- Never commit `google-services.json`, Maps keys, or real photos.
