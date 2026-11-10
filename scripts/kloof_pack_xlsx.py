#!/usr/bin/env python3
"""
Task 185: rebuild the kloofstreet openers follow-up workbook (third generation).
Data: scripts/kloof-openers-data-20261110.json (door read, 65 rows + leads).
Laws: one call row per company; wa.me only for numbers on file (Nov 9 record +
AKJP from the DB); call status dropdown; greeting = as the campaign sent it;
notes honest (Stud failed-then-landed; Yours Truly is one shop, two inboxes).
"""
import json, sys, os

XLSX_SKILL_DIR = "/home/z/my-project/skills/xlsx"
for sub in [XLSX_SKILL_DIR, os.path.join(XLSX_SKILL_DIR, "templates")]:
    if sub not in sys.path:
        sys.path.insert(0, sub)

from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.styles import Font, PatternFill, Alignment
from base import (
    setup_sheet, style_header_row, style_data_row,
    font_body, font_caption, fill_header, PRIMARY, NEUTRAL_600,
)

DATA = json.load(open("/home/z/my-project/scripts/kloof-openers-data-20261110.json"))
OUT = "/home/z/my-project/download/kloofstreet-openers-followup/KLOOF-OPENERS-CALL-LIST.xlsx"

# Boss order, 10 Nov: "remove blondies from the list and all future mailing
# campaigns". Blondie Bar (capetown@blondie.bar, 1 open) is off the working
# list and on the platform Suppression register: no campaign touches them
# again. The pack reflects the removal so the call list and the register agree.
REMOVED_EMAILS = {"capetown@blondie.bar"}
REMOVED_META = {
    "capetown@blondie.bar": {"company": "Blondie Bar", "opens": 1},
}

# Elri at Mount Nelson clicked unsubscribe after the first mail (Suppression
# register, reason UNSUB, note kloofstreet-2026-11). The queue engine refuses
# the address at send time and the follow up queue stages no row for them; the
# email drafts sheet carries no draft either. The call list keeps the company
# with the honest note: the mailbox is closed, the phone is the boss's call.
UNSUBBED_EMAILS = {"elri.steenkamp@belmond.com"}

# numbers on file, carried from the Nov 9 record + AKJP from the DB (Task 181 law)
PHONES = {
    "info@rickscafe.co.za": "021 424 1100",
    "info@vanhunks.co.za": "021 422 5422",
    "info@juddslocal.co.za": "064 527 1272",
    "onkloof@excentric-hair.co.za": "076 783 5488",
    "info@akjpstudio.com": "079 490 9492",
}

def wa_href(raw):
    digits = "".join(c for c in raw if c.isdigit())
    if digits.startswith("0"):
        digits = "27" + digits[1:]
    elif not digits.startswith("27"):
        digits = "27" + digits
    return f"https://wa.me/{digits}"

def name_greeting(greet):
    return greet.replace("Hi ", "").replace(",", "").strip()

# ---- aggregate logs ----
logs = DATA["logs"]
leadmap = {}
for x in DATA["leadsByEmail"]:
    if x.get("email"):
        leadmap.setdefault(x["email"].lower(), x)

inboxes = {}  # email -> {opens, sent, failed}
for l in logs:
    k = l["toEmail"].lower()
    e = inboxes.setdefault(k, {"opens": 0, "sent": 0, "failed": 0, "greeting": None})
    if l["status"] == "SENT":
        e["sent"] += 1
    else:
        e["failed"] += 1
    e["opens"] += (l["openCount"] or 0)
    if l.get("body"):
        e["greeting"] = (l["body"].split("\n")[0].strip().rstrip(","))

openers = {k: v for k, v in inboxes.items() if v["opens"] > 0 and k not in REMOVED_EMAILS}

# ---- one row per company ----
companies = {}
for k, v in openers.items():
    ld = leadmap.get(k, {})
    comp = ld.get("company") or k
    c = companies.setdefault(comp, {"emails": [], "opens": 0, "phone": None, "website": None, "city": None})
    c["emails"].append(k)
    c["opens"] += v["opens"]
    c["greetings"] = [name_greeting(openers[e]["greeting"]) for e in c["emails"]] if "greetings" in c else None
    c.setdefault("greet", []).append(name_greeting(openers[k]["greeting"] or "Hi there"))
    if ld.get("phone") and not c["phone"]:
        c["phone"] = ld["phone"]
    if ld.get("website") and not c["website"]:
        c["website"] = ld["website"]
    c["city"] = ld.get("city") or c["city"]

# re-inject the carried numbers (Nov 9 record) where they match
for comp, c in companies.items():
    for k in c["emails"]:
        if k in PHONES and not c["phone"]:
            c["phone"] = PHONES[k]

rows = []
for comp, c in companies.items():
    greet = " and ".join(dict.fromkeys(c["greet"]))
    rows.append({
        "company": comp, "opens": c["opens"], "emails": c["emails"],
        "greeting": greet, "phone": c["phone"], "website": c["website"], "city": c["city"],
    })
rows.sort(key=lambda r: (-r["opens"], r["company"].lower()))
for i, r in enumerate(rows):
    r["tier"] = "T1" if i < 8 else ("T2" if i < 21 else "T3")

assert sum(1 for r in rows if r["tier"] == "T1") == 8
t2 = [r for r in rows if r["tier"] == "T2"]
t3 = [r for r in rows if r["tier"] == "T3"]

wb = Workbook()
wb.properties.creator = "Z.ai"

# ================= Sheet 1: Call list =================
ws = wb.active
ws.title = "Call list"
HEADERS = ["#", "Tier", "Company", "Greeting to use", "Opens", "Email", "Phone on file",
           "WhatsApp (one tap)", "Call status", "Best window", "Notes"]
LAST_COL = len(HEADERS) + 1  # data starts at col B
setup_sheet(ws, title="Kloofstreet openers call list, 10 Nov 2026", last_col=LAST_COL)
for col, h in enumerate(HEADERS, 2):
    ws.cell(row=4, column=col, value=h)
style_header_row(ws, 4, 2, LAST_COL)

NOTES = {
    "Club Kloof": "Hottest name on the list: opened 10 times. Ask for the manager who does marketing.",
    "Rick's Cafe Americain": "10 opens. Number on file from the Nov 9 record. Long-standing street anchor.",
    "Boetiek": "Sonia opened 6 times, by name greeting. Warm call: she already knows who you are.",
    "Vortex Shisha Kloof": "5 opens, gmail inbox, ask for the owner by role not name.",
    "AKJP Studio": "3 opens, number on file. Declined-before row: lead with what changed (summer season).",
    "Toni's on Kloof": "3 opens.",
    "Van Hunks": "3 opens, number on file. Was phone-bucket originally, email added later.",
    "Mamacita's": "3 opens, gmail inbox.",
    "Yours Truly": "One shop, two inboxes: Ameer and Daniel both opened. One call, one listing. Robert got the same mail and did not open it.",
    "Mount Nelson Hotel": "Elri opened twice by name, then clicked unsubscribe after the first mail. Email is closed for good; phone is your judgment call.",
    "Stud. The Burger Shop": "First send failed (rate limit), the retry landed and was opened once. Treated as delivered.",
    "Robyn Page Physiotherapy": "Solo practice, gmail inbox.",
    "Excentric on Kloof": "Number on file. Declined-before row: summer angle.",
}
STATUS = ["TO CALL", "CALLED, NO ANSWER", "VOICEMAIL LEFT", "GATEKEEPER", "CALLBACK BOOKED",
          "INTERESTED, SEND DEMO", "NOT INTERESTED", "CLOSED, CLAIMED", "CLOSED, LISTED"]

r = 5
for i, row in enumerate(rows, 1):
    ws.cell(row=r, column=2, value=i)
    ws.cell(row=r, column=3, value=row["tier"])
    ws.cell(row=r, column=4, value=row["company"])
    ws.cell(row=r, column=5, value=f"Hi {row['greeting']}," if row["greeting"].lower() != "there" else "Hi there,")
    ws.cell(row=r, column=6, value=row["opens"])
    ws.cell(row=r, column=7, value=", ".join(row["emails"]))
    ws.cell(row=r, column=8, value=row["phone"] or "")
    ph = row["phone"]
    if ph:
        cell = ws.cell(row=r, column=9, value="Open WhatsApp")
        cell.hyperlink = wa_href(ph)
        cell.font = Font(color="1B7D46", underline="single")
    ws.cell(row=r, column=10, value="TO CALL")
    ws.cell(row=r, column=11, value="Mid morning or mid afternoon, Tue to Thu")
    note = NOTES.get(row["company"], "")
    if row["tier"] == "T1" and note:
        pass
    ws.cell(row=r, column=12, value=note)
    style_data_row(ws, r, 2, LAST_COL, i - 1)
    r += 1
last_data = r - 1

dv = DataValidation(type="list", formula1='"' + ",".join(STATUS) + '"', allow_blank=True,
                    showDropDown=False, promptTitle="Call status", prompt="Pick one after every dial.")
ws.add_data_validation(dv)
dv.add(f"J5:J{last_data}")

widths = {2: 5, 3: 6, 4: 26, 5: 20, 6: 7, 7: 34, 8: 15, 9: 17, 10: 22, 11: 26, 12: 52}
for col, w in widths.items():
    ws.column_dimensions[get_column_letter(col)].width = w
ws.freeze_panes = "E5"
ws.page_setup.orientation = "landscape"
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0
ws.print_title_rows = "4:4"

note_row = last_data + 2
ws.cell(row=note_row, column=2,
        value="Never mention that anyone opened anything. The opens are your timing, not your opener. Phone numbers carried from the 9 Nov record plus AKJP from the database.")
ws.cell(row=note_row, column=2).font = font_caption()

# ================= Sheet 2: Email drafts =================
ws2 = wb.create_sheet("Email drafts")
H2 = ["#", "Company", "To", "Greeting line", "Subject A (recommended)", "Subject B", "Body (paste as is)"]
LAST2 = len(H2) + 1
setup_sheet(ws2, title="Follow up email, one per inbox that opened", last_col=LAST2)
for col, h in enumerate(H2, 2):
    ws2.cell(row=4, column=col, value=h)
style_header_row(ws2, 4, 2, LAST2)

SUBJ_A = "Your Kloof Street neighbours are claiming their profiles"
SUBJ_B = "Two minutes about your free profile on kloofstreet.online"

def followup_body(greet_line, company):
    return (
        f"{greet_line}\n\n"
        "I emailed you a couple of weeks ago about Kloof Street being named the 22nd coolest street in the world, and the coolest in Africa. "
        "People are using kloofstreet.online to decide where to eat, shop and unwind before they even arrive on the street. "
        f"When they do, will they find {company}?\n\n"
        "Here is the short version of what I suggested:\n\n"
        "Already listed? Claim your profile. It takes about two minutes, it is free, and it puts you in control of how your business appears on the guide.\n\n"
        "Not listed yet? Click Get Listed on the same page and I will personally help you get started.\n\n"
        "And once you are on the guide, there is a full backoffice behind it, built for local businesses: customer management, newsletters, invoices, "
        "appointments and local business leads, all in one place. Your storefront on Kloof Street, your operations behind it.\n\n"
        "If you would rather chat for five minutes, reply with a good number and I will call you. The season is starting, and I want our street's "
        "businesses to be the ones people find.\n\n"
        "Claim your profile or get listed: https://www.kloofstreet.online/get-listed\n\n"
        "Either way, thank you for reading.\n\n"
        "Warm regards,\n"
        "\u3010Your name\u3011\n"
        "Kloofstreet.online\n\n"
        'Not keen on emails from us? Reply "no thanks" and we won\u2019t mail you again.'
    )

# one draft row per OPENER INBOX, same order as the call list companies
# (suppressed addresses carry no draft: Blondie removed by the boss, Elri
# unsubscribed by their own click)
r2 = 5
draft_no = 1
for row in rows:
    for k in row["emails"]:
        if k in REMOVED_EMAILS or k in UNSUBBED_EMAILS:
            continue
        g = openers[k]["greeting"] or "Hi there"
        greet_line = f"Hi {name_greeting(g)}," if g.lower() != "hi there" else "Hi there,"
        ws2.cell(row=r2, column=2, value=draft_no)
        ws2.cell(row=r2, column=3, value=row["company"])
        ws2.cell(row=r2, column=4, value=k)
        ws2.cell(row=r2, column=5, value=greet_line)
        ws2.cell(row=r2, column=6, value=SUBJ_A)
        ws2.cell(row=r2, column=7, value=SUBJ_B)
        ws2.cell(row=r2, column=8, value=followup_body(greet_line, row["company"]))
        style_data_row(ws2, r2, 2, LAST2, draft_no - 1)
        ws2.cell(row=r2, column=8).alignment = Alignment(wrap_text=True, vertical="top")
        r2 += 1
        draft_no += 1
for col, w in {2: 4, 3: 22, 4: 30, 5: 18, 6: 40, 7: 40, 8: 90}.items():
    ws2.column_dimensions[get_column_letter(col)].width = w
ws2.freeze_panes = "C5"
n2 = r2 + 1
ws2.cell(row=n2, column=2, value="Greeting law: use the greeting the campaign already used for that inbox. Sign with your own name before sending. Nothing sends from this pack by itself.")
ws2.cell(row=n2, column=2).font = font_caption()

# ================= Sheet 3: Readout =================
ws3 = wb.create_sheet("Readout")
setup_sheet(ws3, title="Campaign readout, kloofstreet-2026-11 (read 10 Nov 2026)", last_col=6)
facts = [
    ("Sent", "26 Oct 2026, 15:45 to 16:50 SAST, from hello@hustleportal.online"),
    ("Subject", "The world has discovered Kloof Street"),
    ("Rows", "65 = 64 SENT + 1 FAILED first attempt (Stud, rate limit) whose retry landed and was opened"),
    ("Unique inboxes", "64"),
    ("Openers", "30 inboxes, 29 companies (46%). Blondie Bar removed at your instruction, 28 companies on the list"),
    ("Total opens", "77 (68 on 8 Nov, 71 on 9 Nov, 77 today: people keep coming back). 76 on this list without Blondie Bar"),
    ("Removed", "Blondie Bar, capetown@blondie.bar: 1 open. Off the list and on the do-not-send register for every future campaign"),
    ("Also off the email drafts", "Mount Nelson Hotel, elri.steenkamp@belmond.com: clicked unsubscribe after the first mail. The register carries them; the phone is your judgment call"),
    ("Non openers", "34 inboxes parked, no second touch yet"),
    ("Best day to work this list", "T1 today, T2 within 5 days, T3 within 10 days"),
]
r3 = 4
for label, val in facts:
    ws3.cell(row=r3, column=2, value=label).font = font_body()
    c = ws3.cell(row=r3, column=3, value=val)
    c.font = font_body()
    c.alignment = Alignment(wrap_text=True)
    r3 += 1
r3 += 1
ws3.cell(row=r3, column=2, value="Parked non openers (34), for a possible later touch").font = Font(bold=True, color=PRIMARY)
r3 += 1
ws3.cell(row=r3, column=2, value="Email").font = Font(bold=True, color=PRIMARY)
ws3.cell(row=r3, column=3, value="Company").font = Font(bold=True, color=PRIMARY)
style_header_row(ws3, r3, 2, 3)
hdr3 = r3
r3 += 1
i = 1
for k, v in sorted(inboxes.items()):
    if v["opens"] == 0:
        ws3.cell(row=r3, column=2, value=k)
        ws3.cell(row=r3, column=3, value=(leadmap.get(k, {}) or {}).get("company") or "")
        style_data_row(ws3, r3, 2, 3, i - 1)
        r3 += 1
        i += 1
ws3.column_dimensions["B"].width = 36
ws3.column_dimensions["C"].width = 30
n3 = r3 + 1
ws3.cell(row=n3, column=2, value="A pending pricing decision (November special) sits with the boss. Quote standard rates until he calls it. Nothing sends from this pack by itself.")
ws3.cell(row=n3, column=2).font = font_caption()

wb.save(OUT)
print("saved", OUT)
print("companies:", len(rows), "| tiers: T1", len([r for r in rows if r['tier']=='T1']),
      "T2", len(t2), "T3", len(t3), "| drafts:", draft_no - 1)
