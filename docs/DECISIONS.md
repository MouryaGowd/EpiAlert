# EpiAlert: DECISIONS

## ADRs (from the spec, kept current)
- **ADR-1 Alert first, photo later.** Incident doc created and alert fired on submit with `photo.state = pending`; blurred photo attaches later. Failed blur rejects the photo, never the alert.
- **ADR-2 Blur fails closed, the alert does not.** ML Kit accurate mode, pixel-level blur, strip all EXIF, original never leaves app-private memory/cache, zero detected faces is not proof, user confirms the preview. Blur is best-effort.
- **ADR-3 Responder location minimised.** Only on-duty verified responders; stored in `responderLive`, unreadable by clients; poster sees only distance rounded to 100 m after "I'm coming".
- **ADR-4 Expiry enforced three ways.** Rules deny reads past `expireAt`; `expireSweeper` deletes docs and photos; Storage lifecycle at 1 day. Firestore docs (fetched 2026-11-20) say TTL deletion is "typically within 24 hours after expiration" and expired docs remain queryable until then, which confirms rules and the sweeper are needed.
- **ADR-5 Responder safety.** Phone auth, rate limit, flagging and suspension, poster identity never shown to responders, scene-safety text on every alert, limitation recorded.
- **ADR-6 Verification is an interface with a human fallback.** Findings (2026-11-20, search results only, official pages not yet read in full): no official public NMC API found. ABDM HPR has APIs at hpr.abdm.gov.in/apidocuments, gated by sandbox registration, client credentials, and consent-based fetch; HPR enrolment is voluntary so it does not cover every doctor. Therefore ship `MockVerifier` + `ManualReviewVerifier`; real provider optional behind a flag. Unofficial scraping is not used. Status: unverified until the HPR docs are read directly.

## Spec flaws and deviations
- **D-1 Poster identity leak in the data model.** Spec lists `incidents/{id}.createdBy` while alerted responders can read the incident, but ADR-5 says poster identity is never shown to responders. Safest interpretation: move `createdBy` to a server-only/poster-only `incidentOwners/{id}` doc; `incidents` carries no uid. Rules tests assert a responder cannot read it.
- **D-2 `auditLog` roughArea.** A geohash prefix is fine, but choose a prefix length coarse enough (about 5 chars, roughly 5 km cells) to avoid re-identifying an individual poster in a quiet area. Revisit at M6.
- **D-3 Fixed decision "faces blurred automatically" vs ADR-2 user confirmation.** Not a contradiction: blur is automatic, the confirmation step guards against misses. Kept both.
- **D-4 Name matching.** Tolerant to case, initials, honorifics; strict on status and council. Exact algorithm decided at M2 and tested.
- **D-5 Functions runtime.** Spec says Node 20. `firebase-functions` 7.4.0 declares node >=18 and local node is 22. Confirm currently supported Cloud Functions runtimes from official docs before pinning in `functions/package.json`. Not yet verified.
- **D-6 Version drift.** Spec stack versions are looked up, not assumed. See PROGRESS for what is verified.

## Open
- `git init` inside `epa/` (ask the user).
- DPDP: Rules notified Nov 2025 per commentary sources; commencement staged (about 12 and 18 months, so core obligations around May 2027). Day-level dates differ across sources; confirm against the Gazette before stating them in PRIVACY or the paper.
