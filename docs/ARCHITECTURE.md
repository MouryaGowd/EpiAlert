# EpiAlert: ARCHITECTURE

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

## Seams (all faked in tests)
- `Verifier`: `MockVerifier`, `ManualReviewVerifier`, optional real provider behind a flag.
- `Notifier`: `FcmNotifier`, `FakeNotifier` (records sends). Tests never hit real FCM.
- `Clock`: injected, so escalation, expiry, rate limits need no sleeping.

## Alert algorithm (`onIncidentCreated`)
1. Dedupe: open/acknowledged incident within 100 m and 10 min -> attach, do not re-alert.
2. Candidates: `geohashQueryBounds(center, radius)` then exact haversine filter.
3. Eligibility: on duty, `updatedAt` within 10 min, verified claim, not suspended, not the poster.
4. Rank: speciality match, then distance. Cap 20 per ring.
5. Send high-priority FCM data messages via `Notifier`; record in `alerts/{uid}`.
6. `escalateStale` (every minute): 60 s with no ack widens 2 -> 3 km (new responders only); 180 s with no ack tells the poster to call 108.
7. Anonymised `auditLog` entry when the incident ends.

## State machine
OPEN -> ACKNOWLEDGED -> RESOLVED; OPEN/ACKNOWLEDGED -> CANCELLED / FLAGGED / EXPIRED. Every transition is a function in a transaction; clients never write `status`.

## Android notes
minSdk 26; permissions ordered POST_NOTIFICATIONS, fine location, background location (separate step); foreground service type `location`; data-only high-priority FCM on a HIGH importance channel, no full-screen intents; CameraX camera-only; offline queue with backoff; English + Kannada.
