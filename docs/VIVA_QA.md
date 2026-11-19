# EpiAlert: viva questions and honest answers

Every answer matches the code in `functions/` and the numbers in `paper/results/`. Where something was not measured, the answer says so. Do not claim more than this.

## The problem and the idea

**1. What problem does EpiAlert solve?**
When someone collapses or is hurt in a public place, trained people nearby usually do not know. EpiAlert lets a bystander report an incident and alerts verified, on-duty medical volunteers within 2 to 3 km, so a trained person may reach the patient before an ambulance.

**2. Is it an ambulance service?**
No, and the app says so on every screen. It does not replace 112 or 108. It adds a volunteer layer; it is not a medical device and gives no diagnosis or treatment guidance.

**3. Is this idea new?**
No. Phone-based dispatch of volunteers is already studied for cardiac arrest. A Stockholm trial with 667 arrests found bystander CPR in 62% of the intervention group against 48% of controls (Ringh et al., NEJM 2015). Our contribution is a design that keeps responder locations unreadable to clients, plus a simulated study of alert strategy, location-noise cost and lookup scaling.

**4. Does the Stockholm result prove EpiAlert works?**
No. That trial was about cardiac arrest in Sweden. We do not claim it transfers to other emergencies or to India, and we ran no field study.

## Verification of doctors

**5. How do you verify that a responder is a real doctor?**
A registry lookup behind a `Verifier` interface. An exact name match on an active, non-blacklisted record is accepted. A mismatch, an inactive record or a blacklisted record is rejected with a reason the user can see. Anything uncertain (lookup failure, timeout, unknown record, partial name match) goes to a human reviewer. It never auto-approves and never silently rejects.

**6. Does it use the real national medical register?**
No. The prototype uses a fixed mock registry. We found no evidence of an official public API for the national register, and access to the ABDM professionals registry appeared to need registration with the programme. We have not confirmed either from an official page, so the paper marks it as to be verified.

**7. What if someone submits a real doctor's number with their own name?**
The name would not match, so it is rejected. If they use the real name and number, the prototype cannot detect impersonation, and the proof photo is not checked or stored. That is a known gap that human review and phone-based login only partly cover.

**8. Why is the State Medical Council mandatory?**
Registration numbers can collide across councils, so the lookup key is council plus number.

## Alerting algorithm

**9. Who gets alerted?**
Responders who are on duty, verified, not suspended, not the reporter, and whose location was updated within 10 minutes, and who are within the current ring by an exact great-circle distance. They are ranked by speciality match, then distance, and at most 20 are alerted per ring.

**10. What happens if nobody accepts?**
After 60 seconds the ring widens from 2 km to 3 km and only newly in-range responders are alerted. After 180 seconds the reporter sees "No volunteer has accepted yet. Call 108."

**11. Why escalate instead of alerting a 3 km ring straight away?**
To send fewer alerts. In our simulation at 0.2 responders per km2, escalation sent 3.84 alerts per incident against 5.66 for a fixed 3 km ring, about 32% fewer. Alerting everyone sent 40.24.

**12. Does escalation make response slower?**
Yes, in our simulation. At default assumptions, 65.04% of incidents had a responder on scene within 10 minutes with escalation against 72.31% for a fixed 3 km ring, a 7.3 point gap. The sensitivity analysis shows the gap falls under 1 point at 30 km/h or a 15-minute deadline. So it is a trade-off, not a free win.

**13. How realistic are those simulation numbers?**
They are not measured from real life. Acceptance probability (0.4), accept delay (median 25 s), speed (20 km/h with a 1.4 detour factor) and responder density are assumptions. The simulation shows how strategies compare under those assumptions, not what would happen in Bangalore.

**14. Why is "median arrival time" not your headline metric?**
We found it biased. It is computed only over incidents that were reached, which made a narrow radius look faster. The headline metric is the share of all incidents with a responder on scene within the deadline.

**15. What about duplicate reports of the same incident?**
A second report within 100 m and 10 minutes merges into the first and does not alert again. The second reporter is told help is already being alerted.

**16. What if the alert function runs twice for the same incident?**
It is idempotent. A responder already alerted for an incident is never alerted again, and a test covers a duplicate trigger.

## Privacy

**17. Can other users see where responders are?**
No. Responder positions are never sent to any client. The reporter sees only how many volunteers are coming and each distance rounded to 100 m. Only the demo admin map shows positions, and it is labelled demo-only.

**18. Can responders see who reported the incident?**
No. The responder view contains no reporter identity, and a test checks that.

**19. How is the photo kept private?**
Capture is camera-only. The browser detects faces and pixelates them on the canvas pixels, then re-encodes the image, which drops metadata. The original is never uploaded. If the browser cannot detect faces, the photo is not sent but the alert still is.

**20. What if the blur misses a face?**
It can. Blur is best-effort, so the reporter must tick that no identifiable face is visible in the blurred preview before sending. Pixelation can also leave a person recognisable. We did not measure blur recall, because we had no labelled face dataset, so the paper makes no recall claim.

**21. Does the browser blur work everywhere?**
No. It uses the browser `FaceDetector` feature, which is not in every browser. When it is missing the app sends no photo. We have not tested the camera flow in a real browser.

**22. How long is data kept?**
Incidents become unreadable at 24 hours and a sweeper deletes them. Responder location is deleted when a responder goes off duty. The audit log keeps no names, ids, notes or exact location.

**23. Why not rely on the database TTL feature for deletion?**
The Firestore documentation says deletion typically happens within 24 hours after expiry, so expired data could linger. We hide expired incidents in the read path and also sweep them. The prototype uses an in-memory store, not Firestore.

**24. What does adding noise to responder location cost?**
In simulation, 0.4 km mean noise missed 12.7% of in-range responders, and 1 km mean noise missed 30.7%. We did not evaluate any attack, so we cannot say how much noise protects a real responder.

## Abuse and safety

**25. What stops fake alerts?**
Phone-based login, a limit of three posts per 10 minutes, flagging by alerted responders (two flags hide the post), and suspension after two false posts. We have not tested these against a determined attacker.

**26. Could someone lure a responder to a dangerous place?**
It is possible. Mitigations are the controls above, hiding the reporter's identity from responders, and a scene-safety warning on every alert. The paper lists it as a limitation.

**27. Is a volunteer legally protected?**
We make no claim of legal immunity. The Good Samaritan provision we found (section 134A of the Motor Vehicles Act) covers motor vehicle accidents only, and we have not yet verified its exact wording from an official source.

## Engineering and measurements

**28. Why is it not an Android app with Firebase?**
We built a web prototype first so it runs anywhere without installs. The architecture keeps the registry, notifier and clock behind interfaces, so a real push service and database could replace the mock parts. Android and Firebase are not built.

**29. What did you actually test?**
120 automated tests pass: unit tests for the engine, escalation, expiry, dedupe, rate limits and the audit log, plus HTTP tests for login, the full flow and admin-only routes. We did not run an automated browser test, a real-phone test or a security test.

**30. What did you measure?**
Server latency over loopback: median 1.94 ms, 95th percentile 2.71 ms, maximum 3.59 ms over 60 trials. That excludes any mobile network or push service, so it says nothing about delivery to real phones. We also measured geohash index lookup against a full scan, 6.0 to 8.0 times faster at 10,000 to 100,000 responders, varying between runs.

**31. Does the geohash index change the answer?**
No. It returns exactly the same responders as a full scan, and the experiment stops if they ever differ. It is an in-memory sorted array, so it shows the benefit of range pruning, not the speed of any database.

**32. How would it handle battery drain and phone power saving?**
We have not tested this. The prototype is a web page, so it does not use Android background services. A real Android build would need a foreground location service and a battery-optimisation guide, and we would have to test it on real devices.

**33. What would you do next?**
Open and verify the remaining citations, run a field pilot to replace assumed parameters, build the Android client, evaluate blur recall on a consented dataset, and test the controls against an adversary.

**34. What is the single biggest limitation?**
All results are simulated with assumed parameters or measured on one machine. We have no field data, no user study and no real-phone testing.
