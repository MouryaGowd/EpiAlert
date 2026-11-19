#!/usr/bin/env python3
"""Builds ppt/EpiAlert.pptx using only the Python standard library (no python-pptx needed).

Every number on the slides is read from paper/results/ at build time, so the deck
cannot drift from the measurements. Run:  python3 ppt/build_deck.py
"""
import csv
import json
import os
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RESULTS = os.path.join(ROOT, "paper", "results")
OUT = os.path.join(HERE, "EpiAlert.pptx")

EMU = 914400  # EMU per inch


def E(inches):
    return int(round(inches * EMU))


NAVY, TEAL, RED, AMBER, GREY = "1B2430", "0B6E4F", "B3261E", "8A5A00", "5D6B7C"
BG, WHITE, LINE, PALE = "F6F7F9", "FFFFFF", "D9DEE6", "EEF1F5"
GREEN_BG, RED_BG, AMBER_BG = "E3F4EC", "FDE7E5", "FFF4D6"
BLUE_BAR, ORANGE_BAR, GREEN_BAR, PURPLE_BAR = "0072B2", "D55E00", "009E73", "CC79A7"

# ---------------------------------------------------------------- measured numbers
def load_exp1_at(density):
    with open(os.path.join(RESULTS, "exp1_strategies.csv"), newline="") as f:
        rows = [r for r in csv.DictReader(f) if abs(float(r["density_per_km2"]) - density) < 1e-9]
    return {r["strategy"]: r for r in rows}


def load_exp3():
    with open(os.path.join(RESULTS, "exp3_index.csv"), newline="") as f:
        return list(csv.DictReader(f))


with open(os.path.join(RESULTS, "latency.json")) as f:
    LAT = json.load(f)["postToAlertReceivedMs"]

E1 = load_exp1_at(0.2)
E3 = load_exp3()
ON_TIME = {s: float(E1[s]["within_deadline_pct_mean"]) for s in ["broadcast", "fixed2", "fixed3", "escalate"]}
ALERTS = {s: float(E1[s]["alerts_per_incident_mean"]) for s in ["broadcast", "fixed2", "fixed3", "escalate"]}
GAP_PP = ON_TIME["escalate"] - ON_TIME["fixed3"]
ALERT_SAVING = 100 * (1 - ALERTS["escalate"] / ALERTS["fixed3"])
SPEEDUP = {int(r["responders"]): float(r["speedup"]) for r in E3}

# ---------------------------------------------------------------- slide builder
class Slide:
    def __init__(self, bg=BG):
        self.bg = bg
        self.parts = []
        self.nid = 1

    def _id(self):
        self.nid += 1
        return self.nid

    def box(self, x, y, w, h, paras=(), fill=None, line=None, anchor="t", inset=0.12, geom="rect"):
        i = self._id()
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
        line_xml = (f'<a:ln w="12700"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>'
                    if line else "<a:ln><a:noFill/></a:ln>")
        body = "".join(para_xml(p) for p in paras) or '<a:p><a:endParaRPr lang="en-GB" sz="1200"/></a:p>'
        self.parts.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Shape {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{E(x)}" y="{E(y)}"/><a:ext cx="{E(w)}" cy="{E(h)}"/></a:xfrm>'
            f'<a:prstGeom prst="{geom}"><a:avLst/></a:prstGeom>{fill_xml}{line_xml}</p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" lIns="{E(inset)}" tIns="{E(inset)}" rIns="{E(inset)}" '
            f'bIns="{E(inset)}" anchor="{anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>')

    def arrow(self, x1, y1, x2, y2, color=GREY, width=1.75):
        i = self._id()
        flip = (' flipH="1"' if x2 < x1 else "") + (' flipV="1"' if y2 < y1 else "")
        x, y = min(x1, x2), min(y1, y2)
        w, h = abs(x2 - x1), abs(y2 - y1)
        self.parts.append(
            f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{i}" name="Arrow {i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>'
            f'<p:spPr><a:xfrm{flip}><a:off x="{E(x)}" y="{E(y)}"/><a:ext cx="{E(w)}" cy="{E(h)}"/></a:xfrm>'
            f'<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>'
            f'<a:ln w="{int(width * 12700)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>')

    def table(self, x, y, col_widths, rows, row_h=0.42, size=14):
        i = self._id()
        grid = "".join(f'<a:gridCol w="{E(w)}"/>' for w in col_widths)
        trs = []
        for r_idx, row in enumerate(rows):
            header = r_idx == 0
            fill = TEAL if header else (WHITE if r_idx % 2 else PALE)
            color = WHITE if header else NAVY
            tcs = "".join(
                f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>'
                f'<a:rPr lang="en-GB" sz="{size * 100}" b="{1 if header else 0}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
                f'<a:latin typeface="Calibri"/></a:rPr><a:t>{escape(str(cell))}</a:t></a:r></a:p></a:txBody>'
                f'<a:tcPr marL="{E(0.1)}" marR="{E(0.1)}" marT="{E(0.05)}" marB="{E(0.05)}" anchor="ctr">'
                f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill></a:tcPr></a:tc>'
                for cell in row)
            trs.append(f'<a:tr h="{E(row_h)}">{tcs}</a:tr>')
        self.parts.append(
            f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{i}" name="Table {i}"/>'
            f'<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
            f'<p:xfrm><a:off x="{E(x)}" y="{E(y)}"/><a:ext cx="{E(sum(col_widths))}" cy="{E(row_h * len(rows))}"/></p:xfrm>'
            f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
            f'<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>{grid}</a:tblGrid>{"".join(trs)}</a:tbl>'
            f'</a:graphicData></a:graphic></p:graphicFrame>')

    def xml(self):
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            f'<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{self.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
            '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            + "".join(self.parts) +
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')


def P(text, size=18, bold=False, color=NAVY, align="l"):
    return (text, size, bold, color, align)


def para_xml(p):
    text, size, bold, color, align = p
    if text == "":
        return f'<a:p><a:endParaRPr lang="en-GB" sz="{size * 100}"/></a:p>'
    return (f'<a:p><a:pPr algn="{align}"><a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr>'
            f'<a:r><a:rPr lang="en-GB" sz="{size * 100}" b="{1 if bold else 0}" dirty="0">'
            f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:rPr>'
            f'<a:t>{escape(text)}</a:t></a:r></a:p>')


def header(s, title, number):
    s.box(0.6, 0.35, 12.1, 0.95, [P(title, 30, True, NAVY)], anchor="b", inset=0.0)
    s.box(0.6, 1.36, 1.3, 0.07, fill=TEAL)
    s.box(0.6, 6.95, 10.5, 0.4, [P("EpiAlert · not an ambulance service · call 112 or 108 first", 11, False, GREY)],
          inset=0.0, anchor="ctr")
    s.box(11.7, 6.95, 1.0, 0.4, [P(str(number), 11, False, GREY, "r")], inset=0.0, anchor="ctr")


def card(s, x, y, w, h, title, lines, accent=TEAL, fill=WHITE):
    s.box(x, y, w, h, fill=fill, line=LINE)
    s.box(x, y, 0.09, h, fill=accent)
    paras = [P(title, 19, True, accent)] + [P(t, 16, False, NAVY) for t in lines]
    s.box(x + 0.25, y + 0.15, w - 0.4, h - 0.3, paras, inset=0.02)


# ---------------------------------------------------------------- the slides
SLIDES = []  # (Slide, notes)


def add(slide, notes):
    SLIDES.append((slide, notes))


# 1. Title
s = Slide(bg=NAVY)
s.box(0.8, 1.85, 11.7, 1.3, [P("EpiAlert", 60, True, WHITE)], inset=0.0, anchor="b")
s.box(0.8, 3.25, 11.7, 1.1, [P("Alerting nearby medical volunteers in the first minutes of an emergency", 26, False, "CFE8DD")], inset=0.0)
s.box(0.8, 4.55, 11.7, 0.6, [P("College major project · web prototype and simulated evaluation · 2026", 18, False, "B8C4D0")], inset=0.0)
s.box(0.8, 5.85, 11.7, 0.95, [P("EpiAlert is not an ambulance service. Call 112 or 108 first.", 18, True, WHITE)],
      fill="8F1D17", anchor="ctr", inset=0.2)
add(s, "Open by saying what this is: a prototype that alerts verified volunteers. It is not an ambulance service, "
       "and it does not replace 112 or 108. Team names, guide and institution are added here before presenting.")

# 2. Problem
s = Slide()
header(s, "The problem: the first minutes matter", 2)
s.box(0.6, 1.7, 5.8, 2.5, [P("10.5%", 60, True, TEAL), P("30-day survival when CPR starts before the ambulance arrives", 18)], fill=WHITE, line=LINE, inset=0.25)
s.box(6.9, 1.7, 5.8, 2.5, [P("4.0%", 60, True, RED), P("30-day survival without CPR before the ambulance arrives", 18)], fill=WHITE, line=LINE, inset=0.25)
s.box(0.6, 4.55, 12.1, 2.0, [
    P("Untrained people nearby often do not know how to help safely.", 20),
    P("Trained people a few hundred metres away usually do not know it is happening.", 20),
    P("Source: Hasselqvist-Ax et al., N Engl J Med 2015, 30,381 witnessed arrests in Sweden [2].", 13, False, GREY),
], inset=0.05)
add(s, "The two figures are from a Swedish registry of 30,381 witnessed cardiac arrests. They show that early CPR before "
       "the ambulance matters. The second bullet is our motivation, not something we measured. Do not present it as data.")

# 3. Why existing options fall short
s = Slide()
header(s, "Why existing options fall short", 3)
card(s, 0.6, 1.75, 3.9, 4.4, "Ambulance alone", [
    "Arrival depends on distance and traffic.",
    "We did not measure ambulance times in Bangalore, so we make no claim about them.",
])
card(s, 4.7, 1.75, 3.9, 4.4, "Volunteer alert systems", [
    "In a randomised trial in Stockholm, phone dispatch raised bystander CPR from 48% to 62% [1].",
    "That was cardiac arrest in Sweden only.",
    "Such systems risk alert fatigue if they alert too many people.",
], accent=AMBER)
card(s, 8.8, 1.75, 3.9, 4.4, "The gap we study", [
    "We study alert volume, location privacy and lookup cost together, in one system.",
    "We study both in simulation, and measure lookup speed.",
], accent=GREEN_BAR)
s.box(0.6, 6.3, 12.1, 0.5, [P("[1] Ringh et al., N Engl J Med 2015. [2] Hasselqvist-Ax et al., N Engl J Med 2015.", 12, False, GREY)], inset=0.0)
add(s, "Be precise about the trial: it is randomised, but about cardiac arrest in Sweden. We have not yet completed a literature "
       "review, so do not claim the combination is new. The related-work section of the paper is still being completed.")

# 4. The idea
s = Slide()
header(s, "The idea in one sentence", 4)
s.box(0.6, 1.7, 12.1, 1.6, [P("A bystander reports an incident. Verified, on-duty medical volunteers within 2 to 3 km are alerted. The first to accept goes.", 28, True, NAVY)], inset=0.0)
steps = [("1  Report", "Location and problem type. Optional photo, faces blurred on the device."),
         ("2  Alert", "Volunteers within 2 km. Widen to 3 km only if nobody accepts in 60 seconds."),
         ("3  Respond", "“I'm coming”, then resolved. The data expires after 24 hours.")]
for i, (t, d) in enumerate(steps):
    x = 0.6 + i * 4.1
    s.box(x, 3.6, 3.7, 2.3, [P(t, 22, True, TEAL), P(d, 16)], fill=WHITE, line=LINE, inset=0.25)
    if i < 2:
        s.arrow(x + 3.75, 4.75, x + 4.05, 4.75, color=TEAL, width=2.5)
s.box(0.6, 6.15, 12.1, 0.55, [P("Positioning: volunteers are alerted, not an ambulance. Call 112 or 108 first.", 16, True, RED)], inset=0.0)
add(s, "This is the whole system in three steps. Stress the positioning line: EpiAlert alerts volunteers and does not replace "
       "emergency services. The 60-second escalation is the design choice we evaluate in the simulation.")

# 5. Users and roles
s = Slide()
header(s, "Who uses it", 5)
card(s, 0.6, 1.75, 3.9, 4.6, "Bystander", [
    "Signs in with a phone number.",
    "Reports the incident, with an optional blurred photo.",
    "Sees how many volunteers are coming and how far, rounded to 100 m.",
    "Never sees a volunteer's exact location.",
])
card(s, 4.7, 1.75, 3.9, 4.6, "Responder", [
    "A doctor, nurse or trained first-aider.",
    "Submits credentials. Verified automatically where a registry matches.",
    "Shares location only while on duty.",
    "Accepts alerts and never sees who reported.",
], accent=TEAL)
card(s, 8.8, 1.75, 3.9, 4.6, "Reviewer (admin)", [
    "Decides the verifications that automation cannot.",
    "Runs the demo controls: seed responders, advance the clock.",
    "Sees the anonymised audit log.",
], accent=AMBER)
add(s, "Three roles. Stress the two privacy rules: a bystander never sees a volunteer's exact location, and a volunteer never "
       "sees who reported. The admin controls are demo-only.")

# 6. Architecture
s = Slide()
header(s, "System architecture (prototype)", 6)
s.box(0.6, 1.75, 3.5, 3.1, [P("Browser app", 20, True, NAVY), P("Report", 16), P("Respond", 16), P("Admin", 16),
                             P("No framework. Strict content security policy.", 13, False, GREY)], fill=WHITE, line=LINE, inset=0.2)
s.box(4.9, 1.75, 3.9, 3.1, [P("Engine (Node.js)", 20, True, TEAL), P("Verification", 16), P("Eligibility and ranking", 16),
                             P("Dedupe, rate limit, flags", 16), P("Escalation and expiry", 16), P("Anonymised audit", 16)],
      fill=GREEN_BG, line=TEAL, inset=0.2)
s.box(9.3, 1.75, 3.4, 1.4, [P("Notifier", 18, True, NAVY), P("Live stream now. Push later.", 14)], fill=WHITE, line=LINE, inset=0.18)
s.box(9.3, 3.45, 3.4, 1.4, [P("Verifier", 18, True, NAVY), P("Mock registry, manual review", 14)], fill=WHITE, line=LINE, inset=0.18)
s.box(4.9, 5.25, 3.9, 1.2, [P("Store: in memory now", 16, True, NAVY), P("Database later", 14)], fill=WHITE, line=LINE, inset=0.15)
s.box(9.3, 5.25, 3.4, 1.2, [P("Clock: injected", 16, True, NAVY), P("Tests run without waiting", 14)], fill=WHITE, line=LINE, inset=0.15)
s.arrow(4.1, 3.3, 4.9, 3.3, color=TEAL)
s.arrow(8.8, 2.45, 9.3, 2.45)
s.arrow(8.8, 4.15, 9.3, 4.15)
s.arrow(6.85, 4.85, 6.85, 5.25)
s.box(0.6, 5.25, 3.5, 1.2, [P("Each outside dependency sits behind an interface. The production design (Firebase, Android, FCM) is specified but not built.", 13, False, GREY)], inset=0.0)
add(s, "Walk the boxes left to right. The key point is the interfaces: the verifier, notifier, store and clock can each be swapped "
       "for a real service without changing the engine. Be clear that only the left and middle boxes exist today.")

# 7. Verification flow
s = Slide()
header(s, "How a responder is verified", 7)
s.box(0.6, 2.9, 2.5, 1.3, [P("Submit credentials", 17, True, NAVY), P("Name, council, number, year", 13)], fill=WHITE, line=LINE, inset=0.15, anchor="ctr")
s.box(3.9, 2.9, 2.7, 1.3, [P("Registry lookup", 17, True, NAVY), P("5 second timeout", 13)], fill=WHITE, line=LINE, inset=0.15, anchor="ctr")
s.arrow(3.1, 3.55, 3.9, 3.55)
outcomes = [(1.75, GREEN_BG, TEAL, "Verified", "Name matches, active, not blacklisted"),
            (3.4, RED_BG, RED, "Rejected, reason shown", "Name differs, or inactive, or blacklisted"),
            (5.05, AMBER_BG, AMBER, "Human review", "Unknown, timeout, or partial name match")]
for y, fill, accent, t, d in outcomes:
    s.box(7.5, y, 5.2, 1.3, [P(t, 18, True, accent), P(d, 15)], fill=fill, line=accent, inset=0.2, anchor="ctr")
    s.arrow(6.6, 3.55, 7.5, y + 0.65, color=accent)
s.box(0.6, 6.45, 12.1, 0.45, [P("Never auto-approve, never silently reject. Every outcome shows a reason.", 16, True, NAVY)], inset=0.0)
add(s, "Name matching is tolerant of case, honorifics such as Dr, and initials, but strict on status and council. "
       "Anything uncertain goes to a human. Note that the prototype uses a fixed mock registry, not the real national register, "
       "because we could not confirm an official API.")

# 8. Alert and escalation
s = Slide()
header(s, "Alerting and radius escalation", 8)
s.arrow(1.0, 4.2, 12.5, 4.2, color=NAVY, width=2.25)
for x, label in [(1.8, "0 s"), (6.0, "60 s"), (10.6, "180 s")]:
    s.box(x - 0.2, 4.0, 0.4, 0.4, fill=TEAL, geom="ellipse")
    s.box(x - 0.8, 4.45, 1.6, 0.4, [P(label, 16, True, NAVY, "ctr")], inset=0.0)
s.box(0.6, 1.7, 3.9, 2.1, [P("Alert within 2 km", 18, True, TEAL), P("On duty, verified, not the reporter. Ranked by speciality, then distance. Up to 20.", 15)], fill=WHITE, line=LINE, inset=0.2)
s.box(4.8, 4.85, 3.9, 1.8, [P("No one accepted?", 18, True, AMBER), P("Widen to 3 km. Alert only responders not already alerted.", 15)], fill=AMBER_BG, line=AMBER, inset=0.2)
s.box(8.9, 1.7, 3.8, 2.1, [P("Still no one?", 18, True, RED), P("The reporter sees: no volunteer has accepted yet. Call 108.", 15)], fill=RED_BG, line=RED, inset=0.2)
s.box(0.6, 6.25, 12.1, 0.55, [P(f"Simulated at 0.2 responders per km²: escalation sends {ALERTS['escalate']:.2f} alerts per incident, against {ALERTS['fixed3']:.2f} for a fixed 3 km ring.", 14, False, GREY)], inset=0.0)
add(s, "Escalation is about who is alerted, not whether someone exists. It saves alerts but waits 60 seconds before widening. "
       "The results slide shows the cost in on-time response, and it depends on our assumed speed.")

# 9. Privacy by design
s = Slide()
header(s, "Privacy by design", 9)
card(s, 0.6, 1.75, 5.9, 3.9, "Location", [
    "Responder positions are never sent to any client.",
    "The reporter sees only how many volunteers are coming, and distances rounded to 100 m.",
    "A responder never sees who reported.",
])
card(s, 6.8, 1.75, 5.9, 3.9, "Photo", [
    "Camera only. No gallery picker.",
    "Faces are found and pixelated in the browser, and the image is re-encoded to drop metadata.",
    "The original is never uploaded. If face detection fails, no photo is sent, but the alert still is.",
], accent=AMBER)
s.box(0.6, 5.8, 12.1, 1.1, [P("Blur is best-effort. The reporter must confirm the preview shows no identifiable face. The audit log holds no names, IDs, notes or exact location.", 15, True, NAVY)], fill=WHITE, line=LINE, inset=0.2, anchor="ctr")
add(s, "Be honest about blur: it can miss faces and pixelation can leave a person recognisable. We did not measure blur recall "
       "because we had no labelled face dataset. The guarantee is about what leaves the device, not about perfect anonymity.")

# 10. Data lifecycle
s = Slide()
header(s, "Data lifecycle: 24 hours, then gone", 10)
stages = [("Reported", "Alert sent at once"), ("Responded", "Volunteers accept, incident resolved"),
          ("24 hours", "Unreadable to everyone straight away"), ("Swept", "Sweeper deletes the record")]
for i, (t, d) in enumerate(stages):
    x = 0.6 + i * 3.1
    fill = RED_BG if i == 2 else WHITE
    accent = RED if i == 2 else TEAL
    s.box(x, 2.0, 2.8, 1.9, [P(t, 19, True, accent), P(d, 14)], fill=fill, line=accent, inset=0.18)
    if i < 3:
        s.arrow(x + 2.8, 2.95, x + 3.1, 2.95, color=GREY, width=2)
s.box(0.6, 4.2, 12.1, 1.5, [P("Enforced three ways", 18, True, NAVY),
                            P("The read path hides expired incidents. A sweeper deletes them. A production build would add database TTL and storage lifecycle rules as backstops.", 15)],
      fill=WHITE, line=LINE, inset=0.2)
s.box(0.6, 5.9, 12.1, 0.9, [P("Responder positions are deleted when a responder goes off duty. The prototype keeps everything in memory, so a restart erases it all.", 15, False, GREY)], inset=0.0)
add(s, "The 24-hour rule is enforced in the read path first, so an expired incident is unreadable before the sweeper runs. "
       "The paper cites the Firestore documentation for why we do not rely on database TTL alone.")

# 11. Security and abuse
s = Slide()
header(s, "Security and abuse controls", 11)
rows = [["Risk", "Control", "Tested"],
        ["Flooding alerts", "3 posts per 10 minutes per reporter", "Yes"],
        ["Repeated false posts", "2 flags hide a post; 2 false posts suspend", "Yes"],
        ["Login guessing", "3 wrong codes lock the number for 5 minutes", "Yes"],
        ["Stranger reads an incident", "Only alerted responders and the reporter can read", "Yes"],
        ["Responder location leak", "Never sent to any client", "Yes"],
        ["Path traversal, script injection", "Path check, strict content policy, no innerHTML", "Partly: no browser test"],
        ["Luring a responder to danger", "Scene-safety warning, reporter identity hidden", "Not evaluated"]]
s.table(0.6, 1.75, [3.8, 6.2, 2.1], rows, row_h=0.56, size=15)
add(s, "Read the right-hand column aloud. The honest answer on luring is that it is mitigated, not solved, and we have not tested it "
       "against an adversary. The browser script defences are checked only by HTTP-level tests, not in a real browser.")

# 12. Tech stack
s = Slide()
header(s, "Technology and why", 12)
rows = [["Layer", "Choice", "Why"],
        ["Server", "Node.js 22, built-in HTTP", "Runs with no installs"],
        ["Language", "TypeScript, strict", "Typed engine logic"],
        ["Tests", "Vitest 5", "Fast; real HTTP tests"],
        ["Geohash", "geofire-common", "Standard geohash ranges"],
        ["Browser", "Plain JavaScript, no framework", "Small; strict content policy"],
        ["Live alerts", "Server-sent events", "Simple one-way push"],
        ["Production (not built)", "Firebase, Android, FCM", "As in the original specification"]]
s.table(0.6, 1.75, [3.2, 4.6, 4.3], rows, row_h=0.56, size=15)
add(s, "Be precise: at runtime the engine uses geofire-common only. The package file also lists firebase-admin and firebase-functions, "
       "which the prototype does not use. Remove them before any release, and say so if asked.")

# 13. Demo flow
s = Slide()
header(s, "Live demo: what the audience sees", 13)
demo = ["Sign in as the demo admin. The login code shows on screen.",
        "Seed eight demo responders around the chosen location.",
        "Sign in on a second window as a normal user and send an alert.",
        "Watch the responder window pop up the alert and accept it.",
        "The reporter sees the volunteer count and distance, with the map.",
        "Advance the demo clock: 70 seconds widens the ring, 3 minutes shows the 108 notice.",
        "Advance 25 hours: the incident expires and the audit log gains an entry."]
for i, t in enumerate(demo):
    col, row = i % 2, i // 2
    x, y = 0.6 + col * 6.1, 1.75 + row * 1.25
    s.box(x, y, 5.9, 1.05, [P(f"{i + 1}.  {t}", 16)], fill=WHITE, line=LINE, inset=0.18, anchor="ctr")
add(s, "Run the demo from the README on the presenting laptop, with the server started by npm start. Two browser windows are needed. "
       "The steps are the same as the README quick demo. Do this live only after rehearsing once. Screenshots are not included in this deck, "
       "because the browser run had not been done when it was built.")

# 14. Results
s = Slide()
header(s, "Results (simulated and measured)", 14)
s.box(0.6, 1.6, 6.2, 0.45, [P("On-time response and alert volume, 0.2 responders per km²", 15, True, NAVY)], inset=0.0)
s.box(0.6, 6.25, 6.2, 0.5, [P("Simulated. Assumed: 40% accept, 20 km/h, 10-minute deadline.", 12, False, GREY)], inset=0.0)
labels = [("Everyone", "broadcast", BLUE_BAR), ("2 km", "fixed2", ORANGE_BAR), ("3 km", "fixed3", GREEN_BAR), ("Ours", "escalate", PURPLE_BAR)]
base_y, max_h = 5.7, 3.2


def bar_group(x0, values, scale_max, title, fmt):
    s.box(x0, 2.1, 3.1, 0.5, [P(title, 13, True, GREY)], inset=0.0)
    for i, (lab, key, col) in enumerate(labels):
        v = values[key]
        h = max(0.02, v / scale_max * max_h)
        x = x0 + i * 0.75
        s.box(x, base_y - h, 0.6, h, fill=col)
        s.box(x - 0.1, base_y - h - 0.36, 0.8, 0.33, [P(fmt(v), 12, True, NAVY, "ctr")], inset=0.0)
        s.box(x - 0.1, base_y + 0.05, 0.8, 0.3, [P(lab, 11, False, GREY, "ctr")], inset=0.0)
    s.arrow(x0 - 0.1, base_y, x0 + 3.0, base_y, color=GREY, width=1)


bar_group(0.6, ON_TIME, 100, "% on scene within 10 min", lambda v: f"{v:.0f}%")
bar_group(3.9, ALERTS, 40.24, "Alerts per incident", lambda v: f"{v:.1f}")
s.box(7.4, 1.6, 5.3, 5.1, [
    P("Measured", 16, True, TEAL),
    P(f"120 automated tests pass.", 15),
    P("Lookup 6 to 8× faster than a full scan at 10,000 to 100,000 responders in the final run (up to 11× in an earlier run). Results match the scan exactly.", 15),
    P(f"Server latency over loopback, 60 trials: median {LAT['p50']:.2f} ms, 95th percentile {LAT['p95']:.2f} ms.", 15),
    P("Not measured", 16, True, RED),
    P("Real phones, push services, mobile networks, and field response times.", 15),
    P(f"Escalation is {abs(GAP_PP):.1f} points slower on time than a fixed 3 km ring at these settings, and the gap closes at 30 km/h.", 15),
], fill=WHITE, line=LINE, inset=0.25)
add(s, "The left chart is simulated at one density. Escalation sends about a third fewer alerts than a fixed 3 km ring, but is "
       "slightly slower on time. The lookup range comes from several runs on one laptop. Latency is loopback only and says nothing about phones.")

# 15. Limitations
s = Slide()
header(s, "Limitations", 15)
s.box(0.6, 1.75, 12.1, 4.9, [
    P("Simulated, with assumed parameters. Acceptance, speed and density in a real city are unknown.", 18),
    P("No field study, pilot or user study. No measured response times.", 18),
    P("The browser interface has no automated browser test. Camera and face-detection depend on a browser feature that is not in every browser.", 18),
    P("Blur is best-effort. Recall is unmeasured.", 18),
    P("Credential verification uses a mock registry. The national register's API is unconfirmed.", 18),
    P("Indian legal protection for volunteers is limited to motor-vehicle accidents, and we make no claim of immunity.", 18),
    P("The literature review is incomplete. Only two peer-reviewed sources have been checked.", 18),
], inset=0.05)
add(s, "Say these before the audience asks. The last point matters for the paper: a reviewer would expect a fuller literature review "
       "than we have verified so far.")

# 16. Future work, conclusion, references
s = Slide()
header(s, "Future work, conclusion and references", 16)
card(s, 0.6, 1.75, 5.9, 3.0, "Next", [
    "Field pilot to replace assumed parameters.",
    "Android client with FCM and a foreground location service.",
    "Real registry integration, once access is confirmed.",
    "Measure blur recall on a consented dataset.",
], accent=TEAL)
card(s, 6.8, 1.75, 5.9, 3.0, "Conclusion", [
    "Escalation saves about a third of alerts, at a cost in on-time response.",
    "Location noise lowers accuracy quickly.",
    "A geohash index keeps results exact and cuts lookup time.",
], accent=AMBER)
s.box(0.6, 5.0, 12.1, 1.8, [
    P("References", 15, True, NAVY),
    P("[1] M. Ringh et al., “Mobile-phone dispatch of laypersons for CPR in out-of-hospital cardiac arrest,” N Engl J Med, 2015. doi:10.1056/NEJMoa1406038", 12, False, GREY),
    P("[2] I. Hasselqvist-Ax et al., “Early cardiopulmonary resuscitation in out-of-hospital cardiac arrest,” N Engl J Med, 2015. doi:10.1056/NEJMoa1405796", 12, False, GREY),
], inset=0.05)
add(s, "Close on the conclusion, then the two verified references. Other references in the paper are not yet checked and are deliberately "
       "left off this slide. Do not add any until they have been opened and verified.")


# ---------------------------------------------------------------- package parts
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
REL_OFF = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def rels_xml(items):
    body = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{g}"/>' for i, t, g in items)
    return HDR + f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def theme_xml(name):
    def ln(w):
        return f'<a:ln w="{w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
    fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    eff = "<a:effectStyle><a:effectLst/></a:effectStyle>"
    colours = {"dk1": "1B2430", "lt1": "FFFFFF", "dk2": "1B2430", "lt2": "F6F7F9", "accent1": "0B6E4F",
               "accent2": "0072B2", "accent3": "D55E00", "accent4": "CC79A7", "accent5": "E69F00", "accent6": "56B4E9",
               "hlink": "0072B2", "folHlink": "5D6B7C"}
    clr = "".join(f'<a:{k}><a:srgbClr val="{v}"/></a:{k}>' for k, v in colours.items())
    return (HDR + f'<a:theme xmlns:a="{NS_A}" name="{name}"><a:themeElements>'
            f'<a:clrScheme name="{name}">{clr}</a:clrScheme>'
            f'<a:fontScheme name="{name}"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
            f'<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
            f'<a:fmtScheme name="{name}"><a:fillStyleLst>{fill * 3}</a:fillStyleLst>'
            f'<a:lnStyleLst>{ln(9525)}{ln(19050)}{ln(28575)}</a:lnStyleLst>'
            f'<a:effectStyleLst>{eff * 3}</a:effectStyleLst><a:bgFillStyleLst>{fill * 3}</a:bgFillStyleLst></a:fmtScheme>'
            f'</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>')


GROUP = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
         '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')
CLRMAP = ('<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" '
          'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>')


def master_xml():
    return (HDR + f'<p:sldMaster xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"><p:cSld>'
            f'<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
            f'<p:spTree>{GROUP}</p:spTree></p:cSld>{CLRMAP}'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')


def layout_xml():
    return (HDR + f'<p:sldLayout xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}" type="blank" preserve="1">'
            f'<p:cSld name="Blank"><p:spTree>{GROUP}</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')


def notes_master_xml():
    return (HDR + f'<p:notesMaster xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"><p:cSld>'
            f'<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{GROUP}'
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>'
            '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
            '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-GB"/></a:p></p:txBody></p:sp>'
            f'</p:spTree></p:cSld>{CLRMAP}</p:notesMaster>')


def notes_slide_xml(text):
    paras = "".join(f'<a:p><a:r><a:rPr lang="en-GB" dirty="0"/><a:t>{escape(t)}</a:t></a:r></a:p>' for t in text.split("\n") if t.strip())
    return (HDR + f'<p:notes xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"><p:cSld><p:spTree>{GROUP}'
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
            '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
            '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>'
            f'<p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp>'
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>')


def presentation_xml(n):
    slide_ids = "".join(f'<p:sldId id="{256 + i}" r:id="rIdS{i + 1}"/>' for i in range(n))
    return (HDR + f'<p:presentation xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}" saveSubsetFonts="1">'
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>'
            '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNM"/></p:notesMasterIdLst>'
            f'<p:sldIdLst>{slide_ids}</p:sldIdLst>'
            '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')


def build():
    n = len(SLIDES)
    files = {}
    files["[Content_Types].xml"] = (
        HDR + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
        + "".join(
            f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
            f'<Override PartName="/ppt/notesSlides/notesSlide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>'
            for i in range(1, n + 1))
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '</Types>')
    files["_rels/.rels"] = rels_xml([
        ("rId1", REL_OFF + "officeDocument", "ppt/presentation.xml"),
        ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
        ("rId3", REL_OFF + "extended-properties", "docProps/app.xml"),
    ])
    files["docProps/core.xml"] = (
        HDR + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>EpiAlert</dc:title>'
        '<dc:creator>EpiAlert project</dc:creator>'
        '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-20T00:00:00Z</dcterms:created></cp:coreProperties>')
    files["docProps/app.xml"] = (
        HDR + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        f'<Application>ppt/build_deck.py</Application><Slides>{n}</Slides></Properties>')
    files["ppt/presentation.xml"] = presentation_xml(n)
    pres_rels = [("rIdM", REL_OFF + "slideMaster", "slideMasters/slideMaster1.xml"),
                 ("rIdNM", REL_OFF + "notesMaster", "notesMasters/notesMaster1.xml"),
                 ("rIdT", REL_OFF + "theme", "theme/theme1.xml")]
    pres_rels += [(f"rIdS{i}", REL_OFF + "slide", f"slides/slide{i}.xml") for i in range(1, n + 1)]
    files["ppt/_rels/presentation.xml.rels"] = rels_xml(pres_rels)
    files["ppt/slideMasters/slideMaster1.xml"] = master_xml()
    files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = rels_xml([
        ("rId1", REL_OFF + "slideLayout", "../slideLayouts/slideLayout1.xml"),
        ("rId2", REL_OFF + "theme", "../theme/theme1.xml")])
    files["ppt/slideLayouts/slideLayout1.xml"] = layout_xml()
    files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = rels_xml([
        ("rId1", REL_OFF + "slideMaster", "../slideMasters/slideMaster1.xml")])
    files["ppt/theme/theme1.xml"] = theme_xml("EpiAlert")
    files["ppt/theme/theme2.xml"] = theme_xml("EpiAlert notes")
    files["ppt/notesMasters/notesMaster1.xml"] = notes_master_xml()
    files["ppt/notesMasters/_rels/notesMaster1.xml.rels"] = rels_xml([
        ("rId1", REL_OFF + "theme", "../theme/theme2.xml")])
    for i, (slide, notes) in enumerate(SLIDES, start=1):
        files[f"ppt/slides/slide{i}.xml"] = slide.xml()
        files[f"ppt/slides/_rels/slide{i}.xml.rels"] = rels_xml([
            ("rId1", REL_OFF + "slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId2", REL_OFF + "notesSlide", f"../notesSlides/notesSlide{i}.xml")])
        files[f"ppt/notesSlides/notesSlide{i}.xml"] = notes_slide_xml(notes)
        files[f"ppt/notesSlides/_rels/notesSlide{i}.xml.rels"] = rels_xml([
            ("rId1", REL_OFF + "notesMaster", "../notesMasters/notesMaster1.xml"),
            ("rId2", REL_OFF + "slide", f"../slides/slide{i}.xml")])

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
        for name, data in files.items():
            z.writestr(name, data)
    print(f"wrote {OUT} with {n} slides")


if __name__ == "__main__":
    build()
