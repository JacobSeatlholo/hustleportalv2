// Pricing Strategy v3 — Business Hustle house branding (Brand Strategist
// Agreement template style): no cover, no TOC — title + ref line + bold
// banner on page 1, left-bold numbered sections, borderless field tables,
// three-line data tables, Times New Roman, pure black, footer page number.
// Every figure is computed below and printed; nothing is done in the head.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, PageNumber, AlignmentType, HeadingLevel, WidthType, BorderStyle,
  ShadingType, UnderlineType,
} from "docx";
import fs from "node:fs";

// ── the numbers, computed ──
const RATE = 11000;            // R110 corporate managed lead, VAT incl.
const TDC = 5000;              // R50 flat recurring to Trinity (executed V2.1, clause 5.2)
const BH = RATE - TDC;         // R60
const MEMBER_SPLIT = 2500;     // R25 of the R50 when an enrolled member sourced the lead
const WELCOME_STD = 9900;      // R99
const WELCOME_REF = 12000;     // R120 referral-joined
const WELCOME_CORP = 55000;    // R550
const LIST = 1800;             // R18 self-serve list
const OP_PRICE = 1500;         // R15 at Operator level 3+
const LADDER = [6000, 6000, 4800, 3600, 2400, 1500]; // new accounts from 1 Dec 2026, levels 1-6
const PACKS = [
  { name: "Starter", pay: 50000, credit: 50000 },
  { name: "Growth", pay: 150000, credit: 165000 },
  { name: "Scale", pay: 500000, credit: 575000 },
];
const FLOOR = 250000;          // optional monthly corporate floor, not built
const CAMPAIGN_AUTO = 50000;   // R500
const r = (c) => "R" + Math.round(c / 100).toLocaleString("en-ZA");

console.log("law check: TDC+BH =", TDC + BH, "== RATE", RATE, TDC + BH === RATE);
console.log("member split check:", MEMBER_SPLIT * 2 === TDC);
console.log("exact-five:", WELCOME_CORP / RATE, "managed leads");
console.log("std welcome at list:", (WELCOME_STD / LIST).toFixed(2), "reveals");
console.log("referral welcome at ladder R60:", WELCOME_REF / LADDER[0], "reveals");
console.log("floor leads:", (FLOOR / RATE).toFixed(1));
for (const p of PACKS) console.log(`pack ${p.name}: ${r(p.pay)} -> ${r(p.credit)} (+${Math.round((p.credit / p.pay - 1) * 100)}%)`);
const LEADS = 1000;
console.log("office 1000 leads:", r(LEADS * RATE), "TDC", r(LEADS * TDC), "BH", r(LEADS * BH));
console.log("member-sourced 1000:", "TDC", r(LEADS * MEMBER_SPLIT), "+ members", r(LEADS * MEMBER_SPLIT));

// live funnel proof (17 Nov 2026, partner digest QA on prod)
const LIVE = { accounts: 4, activated: 3, leads: 3, accrualRand: 150 };

// ── style constants ──
const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimSun" };
const BLACK = "000000";
const GREY = "808080";
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };

const run = (text, opts = {}) => new TextRun({ text, font: FONT, color: BLACK, size: 24, ...opts });

const body = (text, opts = {}) => new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { line: 312, after: 140, ...(opts.spacing || {}) },
  children: [run(text, opts.run || {})],
});
// paragraph made of mixed runs (for bold key figures inline)
const bodyRuns = (runs, opts = {}) => new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { line: 312, after: 140, ...(opts.spacing || {}) },
  children: runs,
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 320, after: 140, line: 322, lineRule: "atLeast" },
  children: [run(text, { bold: true, size: 28 })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 220, after: 100, line: 312 },
  children: [run(text, { bold: true, size: 24 })],
});
const caption = (text) => new Paragraph({
  keepNext: true,
  spacing: { before: 160, after: 80, line: 312 },
  children: [run(text, { bold: true, size: 21 })],
});
const note = (text) => new Paragraph({
  spacing: { before: 60, after: 160, line: 312 },
  children: [run(text, { size: 21, italics: true })],
});

// ── table builders ──
function cell(text, { bold = false, width, fill, size = 21, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align,
      spacing: { line: 300 },
      children: [run(text, { bold, size })],
    })],
  });
}
// three-line table (formal, black rules) — the agreement's austere read
function threeLine(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: BLACK },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: BLACK },
      left: NB, right: NB, insideVertical: NB,
      insideHorizontal: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => new TableCell({
          width: { size: widths[i], type: WidthType.PERCENTAGE },
          borders: { top: NB, left: NB, right: NB, bottom: { style: BorderStyle.SINGLE, size: 3, color: BLACK } },
          margins: { top: 70, bottom: 70, left: 120, right: 120 },
          children: [new Paragraph({ spacing: { line: 300 }, children: [run(t, { bold: true, size: 21 })] })],
        })),
      }),
      ...rows.map((cells) => new TableRow({
        cantSplit: true,
        children: cells.map((t, i) => new TableCell({
          width: { size: widths[i], type: WidthType.PERCENTAGE },
          borders: noBorders,
          margins: { top: 70, bottom: 70, left: 120, right: 120 },
          children: [new Paragraph({ spacing: { line: 300 }, children: [run(t, { size: 21 })] })],
        })),
      })),
    ],
  });
}
// borderless label/value field table — the agreement's parties-block style
function fieldTable(entries) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allNoBorders,
    rows: entries.map(([label, value]) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE }, borders: noBorders,
          margins: { top: 50, bottom: 50, left: 0, right: 120 },
          children: [new Paragraph({ spacing: { line: 300 }, children: [run(label, { bold: true, size: 22 })] })],
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE }, borders: noBorders,
          margins: { top: 50, bottom: 50, left: 120, right: 0 },
          children: [new Paragraph({ spacing: { line: 300 }, children: [run(value, { size: 22 })] })],
        }),
      ],
    })),
  });
}

// ── header block (agreement style) ──
const head = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: 368, lineRule: "atLeast", after: 60 },
    children: [run("Pricing Strategy", { bold: true, size: 32 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160, line: 300 },
    children: [run("Ref: BH-PRICING-2026-03  |  Version: v3.0, live till  |  17 November 2026", { size: 21 })],
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 200, line: 300 },
    children: [new TextRun({
      text: "v3.0 — INTERNAL STRATEGY DOCUMENT. Prepared by Business Hustle for its team and for the Trinity Direct Consortium deal room. Every figure below was verified against the live platform till and the executed Strategic Partnership Agreement V2.1 on 17 November 2026. Commercial terms bind only as written in the executed agreements; this document explains them, it does not replace them. This document is not legal advice.",
      font: FONT, color: BLACK, size: 21, bold: true,
      underline: { type: UnderlineType.SINGLE },
    })],
  }),
  body("Self-serve, corporate and the referral network: one tight structure — now live. Version 2 of this document was written while the corporate rate was a proposal and the level ladder a decision waiting to be made. This version replaces it and states what the platform actually charges, what the executed agreement actually pays, and what is still open."),
];

// ── sections ──
const s1 = [
  h1("1.  What changed since v2"),
  bodyRuns([
    run("Four things. First, the partnership executed: the Strategic Partnership Agreement V2.1 was signed by Trinity Direct Consortium through their OpenSign system and counter-signed by Business Hustle on the platform's own e-sign engine, so the referral law is no longer a proposal — it is contract. Second, and this supersedes a whole family of v2 paragraphs, the executed law is a "),
    run("flat recurring R50 to the Consortium and R60 to Business Hustle per qualifying managed lead for as long as the account stays active", { bold: true }),
    run(". The 90-day launch taper v2 recommended, sliding to R25 thereafter, did not survive into the signed agreement and is dead: no table in this version contains a taper row."),
  ]),
  body("Third, the self-serve ladder v2 recommended was approved and built. Accounts created from 1 December 2026 price on the ladder — R60 at the entry levels falling to R15 at Tycoon — while every account created before the cutoff keeps the launch economics of R18 list and R15 at Operator permanently. The cohort is derived from the account's creation date, so no migration touches any balance. Fourth, the partner funnel went live end to end: an open corporate door, per-account attribution, the partner's own dashboard, and a Monday-morning digest that lands the strategist's numbers in the partnership's inbox without anyone asking."),
  body("What remains open is short and stated plainly in section 8: an optional monthly floor for corporate accounts, and re-denominating the top-up packs in leads rather than rands. Neither is built; neither blocks anything."),
];

const s2 = [
  h1("2.  Where the pricing sits today"),
  body("The platform runs on three real price points, all enforced at a single till function in code. The self-serve reveal costs R18 at list, dropping to R15 once a member reaches Operator level 3. The done-for-you corporate track — the managed rate — sits at a flat R110 per qualified lead reveal, inclusive of VAT where VAT is chargeable, standardised with the Trinity Direct Consortium partnership terms, and it never takes level discounts. The market anchor shown at every till is the R250-plus that South African pay-per-lead agencies advertise. These are the numbers the product actually charges today; every claim on every surface traces back to them."),
  body("Around the till sit the supports, each verified on 17 November 2026. New members start with R99 in welcome credits, which the welcome email honestly converts at the R18 list price. A member who joins through a referral link starts with R120 instead — the owner's rule of November 2026, live in the signup path. A corporate account opened through a partner door starts with R550, which is exactly five managed leads at the R110 rate and is the corporate door's whole promise. The top-up packs sell rands of credit with bonuses rather than leads: Growth adds ten percent, Scale adds fifteen, and every top-up of R500 or more automatically runs the account's client campaign."),
  caption("Table 1: The numbers at a glance (verified against the live till, 17 November 2026)"),
  fieldTable([
    ["Corporate managed rate", `${r(RATE)} per qualified lead reveal, flat, VAT inclusive; no level discounts apply`],
    ["Referral allocation (executed)", `${r(TDC)} to Trinity Direct Consortium / ${r(BH)} to Business Hustle, recurring per qualifying reveal`],
    ["Member-sourced split", `${r(MEMBER_SPLIT)} strategist / ${r(MEMBER_SPLIT)} member per managed lead, from the ${r(TDC)} allocation`],
    ["Corporate welcome credit", `${r(WELCOME_CORP)} = exactly ${WELCOME_CORP / RATE} managed leads on us`],
    ["Self-serve till (today)", `${r(LIST)} at list; ${r(OP_PRICE)} from Operator level 3`],
    ["Ladder (new accounts from 1 Dec 2026)", `${r(LADDER[0])} at levels 1-2, falling to ${r(LADDER[5])} at Tycoon`],
    ["Welcome credits", `${r(WELCOME_STD)} standard; ${r(WELCOME_REF)} when joined via a referral link; ${r(WELCOME_CORP)} corporate`],
    ["Top-up packs", PACKS.map((p) => `${p.name} ${r(p.pay)} (+${Math.round((p.credit / p.pay - 1) * 100)}% credit)`).join("; ")],
    ["Campaign auto-run", `every top-up of ${r(CAMPAIGN_AUTO)} or more runs the account's client campaign`],
    ["Market anchor", "R250+ per lead — the South African agency rate, shown at every till and price list"],
  ]),
  note("Enforcement is server-side at one till function; nothing in this table is enforced by copy alone."),
];

const s3 = [
  h1("3.  The competitive field"),
  body("QuickLeads (quickleads.co.za) remains the closest local comparable: shared inbound enquiry leads for home-improvement contractors, prepaid credit bundles, delivery by email and SMS. Three facts still define them. Their prices are hidden — the site says packages are priced in credits and most industries cost one credit per lead, but the actual rand figures sit behind an invoice-request step. Nothing on their site claims verification, exclusivity, replacement or a guarantee of any kind; the same enquiry can reach many contractors. And their trust signals are thin: a volume claim, a live feed of recent leads, and no reviews or badges anywhere."),
  body("The agencies above them advertise from R250 per lead, quoted per industry and volume, done for you. Between a hidden-price shared-enquiry reseller and a R250 agency sits the open space this document prices: published flat rates, verified contact details, a browsable pool, a free starting credit, and the verified-or-you-do-not-pay promise. The corporate track sells that same space to sales floors with the strategist relationship wrapped around it."),
];

const s4 = [
  h1("4.  The referral law as executed"),
  body("Clause 5 of the executed agreement fixes the economics in one sentence: the customer-facing base price for each Paid Lead Reveal is R110, inclusive of VAT where VAT is chargeable, and the allocation of that base fee is R50 to Trinity Direct Consortium and R60 to Business Hustle. The allocation is recurring for each qualifying Paid Lead Reveal for as long as the account remains active and keeps purchasing through the platform. There is no taper, no sunset and no volume condition in the signed text; v2's proposed slide to R25 after 90 days was a negotiating position, not the deal."),
  body("A qualifying reveal is precisely defined and the platform's till already implements the exclusions: the applicable R110 platform fee must be successfully charged and received, and complimentary, test, refunded, reversed, duplicate or invalid reveals are excluded. Attribution runs through the Attribution Register — an introduction is recorded when the account is materially developed by the Consortium, its personnel or an authorised referral partner, and the agreement bars Business Hustle from rejecting attribution unreasonably where documentary evidence establishes the introduction. The R50 is payable to Trinity Direct Consortium as a company, not to Mr Martins personally, and the R60 to Business Hustle as a company; each party accounts for its own allocation as its accountants require."),
  bodyRuns([
    run("Inside the platform, one refinement sits on top of the contract: when an enrolled member — not the strategist personally — sourced the lead, the strategist's "),
    run(`${r(TDC)} splits ${r(MEMBER_SPLIT)} strategist / ${r(MEMBER_SPLIT)} member`, { bold: true }),
    run(". That split is enforced in the earnings calculator and the executive surfaces, and it is the mechanism that keeps individual members firing the network without touching the contract's R60 to Business Hustle."),
  ]),
];

const s5 = [
  h1("5.  The partner funnel in operation"),
  body("Everything v2 planned for the referral network is now running. The corporate door is open — no access code, no card — and every account that registers through it is attributed to the partner on the account itself. Onboarding is done-for-you from the first minute: the corporate welcome credit lands as the exact-five R550, the welcome email names the partner, and the corporate law holds in the app — the games, the level ladder, the business-to-consumer packs and the card nudge stay hidden on done-for-you accounts, and the upgrade dialog routes corporate conversations, not self-serve checkout."),
  body("The strategist sees all of it without asking. The partner dashboard shows every account opened through their door, its activation state, the managed leads delivered, the R50 accrual computed from live reveal transactions, and two call lists — close-now (accounts too low on credit to afford their next lead) and warming (under three leads left). The deal room links the dashboard directly. Every Monday morning at 08:00 SAST a digest lands in the partnership's backend inbox with the same numbers and a button into the dashboard; the recipient is the partnership's own address, trinitydirectint@gmail.com."),
  bodyRuns([
    run("Live proof at the time of writing, 17 November 2026: "),
    run(`${LIVE.accounts} corporate accounts through the door, ${LIVE.activated} already revealing, ${LIVE.leads} managed leads delivered, ${"R" + LIVE.accrualRand} accrued to the Consortium`, { bold: true }),
    run(". Small numbers, real ones, and the machinery that grows them without a single manual report."),
  ]),
];

const s6 = [
  h1("6.  The self-serve ladder: decided and armed"),
  body("The v2 recommendation stands approved and is in the code. Accounts created from 1 December 2026 price on the ladder below; accounts created before the cutoff keep R18 at list and R15 from Operator level 3 permanently. The cohort is derived from the account's creation date inside the till itself, so no migration runs, no balance is converted and nobody's money shrinks — a member who loaded R300 at the old price finds it buys exactly what it bought yesterday, for as long as they stay. New pricing applies only to new accounts. This is the honest money law and it is not negotiable."),
  caption("Table 2: The ladder — price per verified lead reveal by level"),
  threeLine(
    ["Level", "Level name", "Ladder (accounts from 1 Dec 2026)", "Legacy (accounts before)"],
    [
      ["1", "Seedling", r(LADDER[0]), r(LIST)],
      ["2", "Builder", r(LADDER[1]), r(LIST)],
      ["3", "Operator", r(LADDER[2]), r(OP_PRICE)],
      ["4", "Closer", r(LADDER[3]), r(OP_PRICE)],
      ["5", "Boss", r(LADDER[4]), r(OP_PRICE)],
      ["6", "Tycoon", r(LADDER[5]), r(OP_PRICE)],
    ],
    [10, 22, 38, 30],
  ),
  note("Ladder prices are enforced server-side per cohort at the reveal till; the fall from R60 to R15 is earned by working the product, not negotiated."),
  body("The welcome credits settle the story the ladder opens. A standard member starts with R99 — five self-serve reveals at the R18 list, with change. A member who joins through a referral link starts with R120 — exactly two verified leads at the ladder's R60 entry price, on us, a clean sentence for the referrer to say out loud. A corporate account starts with R550 — exactly five managed leads. Each welcome number now buys a whole-number story at the price the account will actually pay, which was the entire point of re-cutting them."),
];

const s7 = [
  h1("7.  The maths"),
  body("The table below is the executed law arithmetised, with the taper rows removed. Reading it: the referral allocation is rich on purpose — it is the fuel that gets strategists talking — but it is now rich forever rather than rich for a launch quarter, which is exactly what the Consortium traded signature for. Business Hustle's R60 per lead is the margin that pays for verification, the platform and support; the member split rewards the individual referrer out of the Consortium's R50, not out of the house margin."),
  caption("Table 3: The executed allocation, arithmetised"),
  threeLine(
    ["Scenario", "Customer pays", "Consortium share", "Business Hustle", "Note"],
    [
      ["100-seller office, 1 000 managed leads in a month", r(LEADS * RATE), r(LEADS * TDC), r(LEADS * BH), "Flat law, no taper"],
      ["Same office, every lead member-sourced", r(LEADS * RATE), `${r(LEADS * MEMBER_SPLIT)} + ${r(LEADS * MEMBER_SPLIT)}`, r(LEADS * BH), "Strategist and member split the R50"],
      ["One managed lead, strategist-sourced", r(RATE), r(TDC), r(BH), "The contract in one row"],
      ["One managed lead, member-sourced", r(RATE), `${r(MEMBER_SPLIT)} + ${r(MEMBER_SPLIT)}`, r(BH), "In-platform split"],
      ["Corporate welcome credit", "—", "—", "—", `${r(WELCOME_CORP)} = exactly ${WELCOME_CORP / RATE} managed leads on us`],
      ["Referral welcome, ?ref= join", "—", "—", "—", `${r(WELCOME_REF)} = exactly ${WELCOME_REF / LADDER[0]} leads at the ladder entry`],
    ],
    [26, 16, 20, 16, 22],
  ),
  note("Qualifying reveals only: the R110 must be charged and received; complimentary, test, refunded, reversed, duplicate or invalid reveals pay nobody anything."),
];

const s8 = [
  h1("8.  Implementation status and the open decisions"),
  body("Live and enforced today: the R110 corporate rate across the corporate pages, the claim notifications and the till constant; the R550 exact-five welcome credit on the corporate door; the open partner funnel with per-account attribution; the partner dashboard and the Monday 08:00 SAST digest to the partnership's backend inbox; the referral allocations R50/R60 paid as companies; the member split R25/R25; the welcome credits R99, R120 and R550; the packs R500, R1 500 and R5 000 with ten and fifteen percent bonuses; and the ladder, coded against the 1 December 2026 cutoff, waiting for the calendar with every existing account already protected."),
  body("Open decision one: the optional monthly floor for corporate accounts. v2 floated R2 500 a month — roughly " + Math.round(FLOOR / RATE) + " leads at the R110 rate — to stabilise pipeline planning once done-for-you billing ships. It remains an option, not built, and nothing in the executed agreement requires it. Open decision two: re-denominating the top-up packs in leads rather than rands, so a buyer reads '5 leads' on the button instead of R1 500. The live packs are rand-denominated with bonus credit; the rebrand is copy plus a constant, blocked on nothing, and worth doing when the ladder's first full month shows how new members actually talk about reveals. Both decisions belong to the owner; neither has a deadline the code cares about."),
];

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24, color: BLACK },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 28, bold: true, color: BLACK },
        paragraph: { spacing: { before: 320, after: 140, line: 322 } },
      },
      heading2: {
        run: { font: FONT, size: 24, bold: true, color: BLACK },
        paragraph: { spacing: { before: 220, after: 100, line: 312 } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: GREY })],
        })],
      }),
    },
    children: [...head, ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...s8],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync("/home/z/my-project/private-docs/Pricing_Strategy_Internal.docx", buf);
console.log("written: private-docs/Pricing_Strategy_Internal.docx", buf.length, "bytes");
