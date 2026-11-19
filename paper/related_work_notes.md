# Related work notes (EpiAlert)

Keys refer to `references.md`. **Only sentences tagged with a `verified: yes` key may go into the paper as written.** Sentences tagged with an unverified key are drafts. Open and confirm each source first, or delete the sentence.

## Stockholm SMS/mobile-phone lifesaver (Sweden)

Stockholm ran a randomised trial that used a mobile-positioning system to dispatch CPR-trained lay volunteers near a suspected OHCA. Across 667 cardiac arrests, bystander CPR rose to 62% (188/305) in the intervention group from 48% (172/360) among controls, a 14-percentage-point difference (95% CI 6–21, P<0.001) [ringh2015mobile]. The same Swedish registry group showed that CPR started before EMS arrival was associated with 30-day survival of 10.5% vs 4.0% (adjusted OR 2.15), with shorter collapse-to-CPR intervals linked to better survival [hasselqvist2015early]. Together these papers motivate EpiAlert's core premise that minutes matter and that nearby trained people can close the gap before an ambulance arrives.

*How EpiAlert differs:* The Stockholm system alerted laypersons triggered by the dispatch centre and tracked their phone positions centrally [ringh2015mobile]. EpiAlert instead recruits verified medical professionals and is triggered by a bystander smartphone report. It also coarsens responder location rather than storing exact positions, and it deletes incident data after 24 h [firebase_ttl] (Firestore TTL deletes typically within 24 h of expiry, so the effective bound is up to about 48 h after creation). *(The architectural differences are EpiAlert design facts and need no citation.)*

## Systematic evidence on citizen-responder apps

DRAFT, unverified: A 2020 systematic review found 28 manuscripts on 12 systems. Pooled CPR before ambulance arrival was 63.8% vs 55.0% (OR 1.70), and activation radii ranged from 150 m to 5 km [scquizzato2020enhancing]. A 2022 meta-analysis associated citizen activation with higher survival to discharge or 30 days (OR 1.45) [scquizzato2022dispatching]. The review named notification volume, inaccurate location and inadequate radius as threats [scquizzato2020enhancing]. These are the problems EpiAlert's radius escalation and alert caps address.

## PulsePoint (USA)

No peer-reviewed PulsePoint outcome paper was located or verified (see `brooks2016pulsepoint`). PulsePoint should be described only from a verified source. Otherwise omit it or mention it without factual claims.

## GoodSAM (UK)

DRAFT, unverified: In an observational analysis covering London and East Midlands, responders accepted only 1.3% and 5.4% of alerts. Survival to discharge was 9.6% and 7.2% respectively [smith2022goodsam]. An accompanying editorial cautioned that these associations are not causal and that arrival-before-EMS could not be established [folke2022editorial]. GoodSAM integrates with UK ambulance services [smith2017goodsam].

*How EpiAlert differs:* GoodSAM is dispatch-centre-integrated. EpiAlert targets a setting without such integration (Bangalore) and adds on-device face blur of incident media plus privacy-preserving responder location.

## HeartRunner (Denmark) and HartslagNu (Netherlands)

DRAFT, unverified: Between Sep 2017 and Dec 2022, Denmark's HeartRunner programme sent 177,866 volunteer alerts for 10,819 presumed OHCAs [heartrunner_followup2023]. About four in five accepting volunteers are sent to fetch an AED [heartrunner_jaha2024]. HartslagNu reportedly uses a 500 m first wave that widens to 2 km [hartslagnu], but that figure comes from press sources only and is not citable as is.

*How EpiAlert differs:* Both programmes are national and run by dispatch centres with AED registries. EpiAlert's radius escalation is conceptually similar to tiered activation, but EpiAlert is responder-verified (medical professionals) and does not depend on an AED network.

## Indian systems

No peer-reviewed Indian volunteer-responder app was identified in this session. The Indian context sources (bystander CPR 1.3–9.8% [ramaka2023india], [krishna2017caro], [india_prehospital_ohca]) are all still unverified.

## Alert fatigue

DRAFT, unverified: Among 5,347 Swedish volunteer responders, alarm fatigue was the strongest negative predictor of motivation, and the authors recommend alerting no more volunteers than needed [sjtrem2023motivation]. In clinical decision support, override rates around 90% are reported for drug-interaction alerts [felisberto2024ddi], and the term "alert fatigue" is rarely defined operationally [ray2026alertfatigue].

## Location privacy and spatial computation

DRAFT, unverified: EpiAlert's coarse responder location relates to spatial cloaking for k-anonymity [gruteser2003anonymous] and to geo-indistinguishability via planar Laplace noise [andres2013geo]. Distance uses the haversine formula [sinnott1984haversine]. No citable geohash reference has been found yet [geohash_ref].

## Face anonymisation

DRAFT, unverified: Newton et al. introduced k-Same and argued that ad hoc face obfuscation does not reliably defeat recognition [newton2005preserving]. That framing must be checked against the paper.

## Legal and regulatory context (India)

All rows in this section are unverified. Official texts still need to be opened.

- **Good Samaritan protection.** The Supreme Court in *Savelife Foundation v. Union of India* (30 Mar 2016) gave binding force to MoRTH's Good Samaritan guidelines and SOP [savelife2016]. Section 134A of the Motor Vehicles Act, 1988 (inserted 2019) protects good-faith helpers from civil or criminal liability [mva134a]. **Scope:** both concern victims of *motor-vehicle accidents*. Neither clearly covers a volunteer doctor attending a non-road emergency (e.g. a cardiac arrest at home), and the paper must not overstate it. The verbatim wording has to be quoted from indiacode.nic.in or the Gazette.
- **DPDP.** The DPDP Rules, 2025 (G.S.R. 846(E)) were notified in November 2025. Rules 1, 2 and 17–21 applied immediately, Rule 4 from about 13 Nov 2026, and the rest from about 13 May 2027 [dpdp_rules2025]. The 13 vs 14 November 2025 discrepancy is **unresolved**. Most secondary sources say 13 Nov, while one law firm says 14 Nov (Gazette publication date). A reported Jan 2026 proposal to shorten the 18-month window was not confirmed by any amending notification.
- **ABDM HPR.** Enrolment is described as voluntary, verification is done by the respective councils, and registration is free [abdm_hpr_faq]. API access goes through ABDM sandbox registration with gateway client credentials [abdm_hpr_api]. Production access terms were not established.
- **NMC Indian Medical Register.** No evidence was found of an official public API [nmc_imr_api]. This was not actually researched, so state it as unknown.

## What could not be verified

1. **Tool failure.** After four successful fetches, WebFetch was denied for every URL, so only 3 sources meet the "opened and confirmed" standard. Everything else is a candidate taken from search snippets.
2. **PulsePoint peer-reviewed outcomes.** Not located.
3. **The AHA "survival falls X% per minute" wording.** No primary source opened. Use [hasselqvist2015early] for time-sensitivity instead.
4. **108 ambulance response times in Indian cities.** No peer-reviewed city-level 108 study was found. The only figure seen is a hospital-cohort median of 10 min [india_prehospital_ohca].
5. **Harm from bystanders moving trauma patients.** No high-quality evidence was found that bystander movement causes secondary spinal injury. Guidelines state the benefit of immobilisation is unproven (no RCTs) but still advise minimal movement [anzcor_spinal]. The paper should say exactly this and not claim proven harm.
6. **Section 134A operative wording, SC judgment official copy, DPDP Gazette date.** Not opened.
7. **Geohash citable reference; Android location foreground service type docs; NMC IMR API.** Not found.
8. **Face detection miss rates.** Not researched.
