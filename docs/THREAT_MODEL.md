# EpiAlert: THREAT MODEL

Short STRIDE-style table. Mitigations are planned; none are tested yet.

| Threat | Mitigation | Status |
|---|---|---|
| Fake doctor | Registry lookup behind `Verifier`; `needs_review` on any doubt; blacklist; admin review | planned (M2) |
| Fake incident / lure (ADR-5) | Phone-authenticated posts, rate limit, flagging, suspension, scene-safety text, poster identity hidden | planned (M7) |
| Location stalking via responder data | `responderLive` unreadable by clients; rounded distance after accept only | planned (M3) |
| Photo re-identification | On-device blur, EXIF strip, user confirmation, 24 h expiry | planned (M4); blur is best-effort |
| Token theft | Short-lived Firebase ID tokens, stale FCM token removal | planned |
| Replayed / forged function calls | Auth-checked callable functions, idempotent handlers, transactions | planned |
| Incident enumeration | No world-read; alerts subcollection grants access; random IDs | planned (M5) |
| Expired data lingering | Rules + sweeper + Storage lifecycle | planned (M6) |

## Rules matrix
To be filled per collection and Storage path as rules are written (M1-M6), with one test per allow and per deny.

## Accepted risks
- A malicious but phone-verified user can still send a lure; limited by rate limit and suspension, not eliminated.
- Blur misses are possible.
- Notification delivery is best-effort (Doze, OEM battery killers).
