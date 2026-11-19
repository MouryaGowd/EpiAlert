# EpiAlert: DATA MODEL

Custom claims `responder`, `admin` are set only by Cloud Functions.

| Path | Fields | Read / write |
|---|---|---|
| `users/{uid}` | displayName, status, fcmToken, createdAt, falseFlagCount, locale | own read/write; `status`, `falseFlagCount` server-written |
| `responderProfiles/{uid}` | qualification, regNo, council, regYear, proofPath, verificationStatus (`pending`/`verified`/`needs_review`/`rejected`/`revoked`), verifiedBy, reason, specialities[] | own read + create; status fields server-only; admin reads all |
| `responderLive/{uid}` | onDuty, lat, lng, geohash, updatedAt, fcmToken, specialities[] | **no client reads**; own write only with `responder` claim; server reads |
| `incidents/{id}` | createdAt, **expireAt**, location{lat,lng,geohash,accuracyM}, problemType, note, photo{state,path}, status, ackCount, radiusKm, alertedCount, clusterId, flagCount | poster read own; alerted responders read; never world-readable; expired unreadable |
| `incidentOwners/{id}` | createdBy | server + poster only. See DECISIONS D-1 |
| `incidents/{id}/alerts/{uid}` | alertedAt, distanceM, deliveryState | server-written; existence grants read |
| `incidents/{id}/responses/{uid}` | state, at, distanceM (rounded to 100 m) | written via function; poster reads |
| `auditLog/{id}` | ts, roughArea (geohash prefix), problemType, outcome, alertedCount, ackCount, timeToFirstAckS | server-only. No photo, names, uids |
| `blacklist/{regKey}` | reason, addedAt | admin/server only |

`photo.state`: `none` / `pending` / `ready` / `rejected`.

Storage: `proofs/{uid}/...` private (owner write, admin read, deleted after decision); `photos/{incidentId}/...` readable only by poster and alerted responders, lifecycle delete at 1 day.
