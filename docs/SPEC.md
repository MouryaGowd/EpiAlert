# EpiAlert: SPEC

Frozen from `varshith.md` sections 1-2. That file stays the source of truth; changes go through `DECISIONS.md`.

## Project
EpiAlert (`com.epialert.responder`), Android only, Bangalore, college major project. A bystander posts an incident (blurred photo, GPS, problem type). Verified, on-duty medical volunteers within 2-3 km are alerted. Posts expire after 24 h.

**Positioning:** EpiAlert alerts nearby medical volunteers. It is not an ambulance service, not a medical device, and does not replace 112 / 108. Blur, verification, and notification delivery are best-effort.

## Fixed decisions
- Android only, Bangalore, Kotlin + Compose, minSdk 26.
- Everyone logs in (phone OTP). Medical people upload proof and are verified automatically where possible.
- Faces blurred on device. Radius 2-3 km. Posts deleted after 24 h.
- No first-aid instruction screen.

## Scope tiers
- **P0:** login, responder registration + verification, on-duty location, incident post with blurred photo, radius push alert, "I'm coming", resolve, 24 h expiry.
- **P1:** radius escalation, duplicate merging, abuse controls, anonymised audit log, offline-tolerant posting, Kannada + English.
- **P2:** admin page polish, accessibility pass, coverage simulation (E3). Cut first.

## Personas
Bystander, Responder, Reviewer (admin).

## User stories
- **US-1 Login:** valid OTP gives role `user`; three wrong OTPs trigger a cool-down.
- **US-2 Become responder:** form (name, qualification, reg no, State Medical Council, reg year, proof photo). Registry match with same name and active status -> `verified` + `responder` claim. Failure / timeout / ambiguity -> `needs_review` (never auto-approve, never silently reject). Mismatch / inactive / blacklisted -> `rejected` with visible reason.
- **US-3 Specialities and duty:** cardiac, trauma/bleeding, bone/spine, breathing/choking, general. Only on-duty responders share location; toggling off stops sharing immediately.
- **US-4 Post incident:** camera-only, faces blurred on device before upload, GPS with accuracy, problem type + optional note, always-visible 112/108 banner. The alert never waits for the photo (ADR-1).
- **US-5 Get alerted:** on-duty verified responder in radius gets a high-priority push with problem type, distance, matching speciality, Accept / Dismiss.
- **US-6 Respond:** poster sees responder count + rounded distance. Navigate opens Google Maps. Either side can resolve.
- **US-7 Expiry:** incident, responses, photo gone from view after 24 h, physically deleted soon after.
- **US-8 Abuse:** responders flag false posts; repeated false posts suspend the poster; post rate limited.

## Acceptance
See `varshith.md` sections 9 (milestone gates), 10 (tests), 13 (Definition of Done).
