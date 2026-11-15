#!/usr/bin/env node
/**
 * HustlePortal TRL + security assessment (fundraising document).
 * English, Profile A formal (Times New Roman), R1 cover DM-1, 3 sections,
 * TOC with placeholders, horizontal-only tables.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} from "docx";
import fs from "node:fs";

// ── palette DM-1 (Deep Cyan, tech) ──
const P = {
  bg: "162235", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", footerColor: "687078", accent: "37DCF2",
  primary: "0A1628",
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
};
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };
const EN = { ascii: "Times New Roman", eastAsia: "Times New Roman" };

function safeText(v, ph) {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") return ph || "";
  return String(v);
}

// ── cover helpers (design-system.md) ──
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 10; // English text: ~half a CJK em
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, charsPerLine(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, midSpacing: Math.max(safeRemaining - topSpacing - bottomSpacing, 0), bottomSpacing };
}
function buildCoverR1(config) {
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: EN, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.titleColor, font: { ascii: "Arial", eastAsia: "SimHei" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800, line: 312 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor, font: EN })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 }, border: { left: accentLeft },
      children: [new TextRun({ text: safeText(line), size: 24, color: P.metaColor, font: EN })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: EN }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: EN }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders, children })],
    })],
  })];
}

// ── body builders ──
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: EN })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: EN })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: 120 },
    children: [new TextRun({ text: safeText(text), size: 24, color: "000000", font: EN, bold: !!opts.bold })],
  });
}
function bodyRuns(runs) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: 120 },
    children: runs.map(r => new TextRun({ text: safeText(r.text), size: 24, color: "000000", font: EN, bold: !!r.bold, italics: !!r.italics })),
  });
}
function caption(text) {
  return new Paragraph({
    keepNext: true, spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text: safeText(text), bold: true, size: 21, color: P.primary, font: EN })],
  });
}
function dataTable(headers, rows, widths) {
  const mk = (text, isHead, w) => new TableCell({
    children: [new Paragraph({
      spacing: { line: 276 },
      children: [new TextRun({ text: safeText(text), bold: isHead, size: 21, color: isHead ? P.table.headerText : "000000", font: EN })],
    })],
    shading: isHead ? { type: ShadingType.CLEAR, fill: P.table.headerBg } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    width: { size: w, type: WidthType.PERCENTAGE },
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((t, i) => mk(t, true, widths[i])) }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => new TableCell({
          children: [new Paragraph({ spacing: { line: 276 }, children: [new TextRun({ text: safeText(t), size: 21, color: "000000", font: EN })] })],
          shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: P.table.surface } : undefined,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          width: { size: widths[i], type: WidthType.PERCENTAGE },
        })),
      })),
    ],
  });
}
const pageFooter = () => new Footer({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: EN })] })],
});
const pageHeader = (t) => new Header({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, size: 18, color: "808080", font: EN })] })],
});

// ══ CONTENT ══
const tocChildren = [
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
    children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: EN, color: P.primary })],
  }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({ text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select Update Field.", italics: true, size: 18, color: "888888", font: EN })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

const bodyChildren = [];

// 1 ─ Executive Summary
bodyChildren.push(h1("1. Executive Summary"));
bodyChildren.push(body("HustlePortal is a live, revenue-bearing software platform for South African small businesses. It finds verified business leads by industry and city, unlocks their contact details on a prepaid wallet, and keeps quotes, invoices, jobs and client communication in one place. This assessment was commissioned to establish, with evidence rather than assertion, how ready the technology is for investment: a full end to end test was run against the production system on 15 November 2026, followed by a security audit across authentication, cross tenant isolation, webhooks, payment flows, rate limiting and secret handling."));
bodyChildren.push(body("The verdict is a Technology Readiness Level of 8 out of 9. The system is complete and qualified through test and demonstration in its operational environment: the full user journey passed 39 of 39 checks, the executive control wall passed 11 of 11, and 24 black box security probes returned zero successful attacks. Real money moves through the platform on a live card processor, campaigns have delivered 464 newsletters with a 43.5 percent open rate, and the suppression and bounce machinery has captured 543 dead addresses automatically."));
bodyChildren.push(body("The honest distance to level 9 is scale, not completeness. The platform serves 48 real member accounts today, monthly recurring revenue is R199, and the outbound email lane is engineered but not yet demonstrated at 50,000 sends per day. Section 7 sets out the specific, costed steps that close that distance. For an investor this reads as a working product with production grade engineering discipline, priced at the stage where growth capital buys distribution rather than development."));

// 2 ─ Product Overview and Scope
bodyChildren.push(h1("2. Product Overview and Assessment Scope"));
bodyChildren.push(h2("2.1 What the product does"));
bodyChildren.push(body("HustlePortal serves owner operated businesses and the agents who sell to them. A member registers, describes a trade and a city, and the discovery engine returns real businesses that are growing, hiring or advertising. Contact details are revealed against a prepaid wallet at R15 per unlocked lead, with a quality guarantee: a reveal only charges when real contact data exists. Around the lead finder sit the daily tools of a small business: a client pipeline with stages, quotes and invoices, finance records, appointment booking, inventory with photo previews, a WhatsApp assistant, and a campaign engine that sends personalised email with open tracking and one click unsubscribe."));
bodyChildren.push(body("The platform also carries a done for you lane for clients who buy outcomes rather than software. A client campaign for Ubuntu Wellness delivered 464 emails and recorded 202 opens. This dual motion, self serve software plus managed campaigns, is the commercial model the fundraising round is meant to scale."));
bodyChildren.push(h2("2.2 Scope and method of this assessment"));
bodyChildren.push(body("The assessment covered the production deployment at hustleportal.online on 15 November 2026, running commit aa83aba. Three evidence streams were collected. First, a functional end to end walk of the entire member journey using a disposable test account: registration, wallet credit, lead discovery, paid reveal, client and invoice creation, subscription checkout, inventory, team invites and logout. Second, a security audit in two layers: source review of every trust boundary in the codebase, and 24 black box probes against production that attempted unauthenticated access, cross tenant reads, forged webhooks and brute force. Third, an operational data pull: campaign delivery history, suppression list state, wallet balances and platform key performance indicators. No third party service was touched, no real recipient was contacted, and no production data was altered by the probes."));

// 3 ─ E2E results
bodyChildren.push(h1("3. End to End Test Results"));
bodyChildren.push(body("The end to end walk creates a real account on production and exercises every core flow through the public interface, exactly as a customer would. It is deliberately unforgiving: a flow that only works in a developer environment fails here. The run completed on 15 November 2026 with the following results."));
bodyChildren.push(caption("Table 1: End to end test suites and results"));
bodyChildren.push(dataTable(
  ["Test suite", "What it exercises", "Result"],
  [
    ["Member journey (39 checks)", "Registration, session, live card payment status, welcome wallet credit, profile, lead discovery with engine attribution, paid reveal with honesty contract, double charge protection, client, invoice, task, finance entry, subscription checkout at three price points, inventory add, adjust and delete, push keys, team creation and member join, logout", "39 of 39 passed"],
    ["Executive control wall (11 checks)", "Anonymous access refused on every executive route, member session refused on dashboard, suspend, inject and hot leads surfaces, legacy admin route still gated", "11 of 11 passed"],
    ["Staging source verification (13 checks)", "New leadsOf pipeline staging: honest readout, exclusion honoured, queue born paused, member staging refused, cleanup", "13 of 13 passed"],
  ],
  [22, 58, 20]
));
bodyChildren.push(body("Three details in the walk carry particular weight for diligence. The reveal charge obeyed its honesty contract: the wallet was charged only when the lead carried real contact details, and a second reveal of the same lead charged nothing. Card payment ran in live mode against the production Yoco account, meaning the checkout, redirect and webhook readiness checks exercised the exact path real customers money takes. And the welcome credit landed in the wallet before any paid action, confirming the free tier promise is enforced in code rather than marketing copy."));

// 4 ─ Security
bodyChildren.push(h1("4. Security Audit Results"));
bodyChildren.push(h2("4.1 Controls verified in code and against production"));
bodyChildren.push(body("The audit reviewed the source of every trust boundary and then attacked the live system to confirm the code behaves as written. The table lists each control, how it is implemented, and the live probe that verified it. Every probe result matched the source intent."));
bodyChildren.push(caption("Table 2: Security controls and live verification"));
bodyChildren.push(dataTable(
  ["Control", "Implementation", "Live verification"],
  [
    ["Session security", "JWT signed HS256 with a production only secret that refuses to boot if missing, httpOnly secure SameSite cookie, 30 day expiry, session epoch invalidates stolen cookies after a password reset, suspended accounts lock instantly", "Failed login sets no cookie; session survives only with valid epoch"],
    ["Authentication hardening", "bcrypt password hashing, per IP rate limit of 60 logins in 5 minutes plus a per email failed attempt door that cannot lock out the real owner", "8 rapid brute force attempts met honest 401 responses"],
    ["Executive wall", "Every administrative route behind a role gate; 24 routes probed anonymously plus the legacy config routes behind inline role checks", "401 or 403 on all 24 routes; member session 403 on all executive surfaces"],
    ["Cross tenant isolation", "Every lead, client, invoice and task lookup scoped to the session owner", "Fresh member account reading or mutating another account lead got 404, project got 404"],
    ["Payment webhooks", "Yoco HMAC signature with 5 minute replay window; registration route validates shape and refuses unsigned events", "Forged payment event rejected with 401"],
    ["Email webhooks", "Resend events require a shared secret; SES feedback without a secret accepts only events bound to message ids this platform generated; inbound mail verifies the full SNS RSA signature against the AWS certificate", "Forged bounce moved the suppression list by zero, 576 before and after"],
    ["Server side request forgery", "A dedicated guard resolves every fetched URL and blocks localhost, cloud metadata, octal and decimal IP forms, IPv6 loopback and DNS that points into private space", "Code review confirmed the guard is on both outbound fetch paths"],
    ["Cron endpoints", "Bearer secret required on the campaign ticker, reminder and refresh jobs", "All three returned 401 without the secret"],
    ["Secret hygiene", "Provider keys live only in server environment variables; the executive config route masks the Explee key", "8 shipped JavaScript bundles scanned: zero secret patterns"],
    ["Transport and headers", "HSTS two years, frame guard, nosniff", "Present on the production response"],
    ["Abuse pacing", "Registration 10 per hour per IP, campaign sends 120 per hour per seat, public delist 6 per hour, engine paces campaigns at the configured hourly rate with burst protection", "Rate limiting confirmed in source; delist throttled"],
    ["Money validation", "Top up amounts validated server side against the pack ladder, R50 to R10,000; reveal charging requires a real contact", "Code review; wallet arithmetic exercised in the end to end walk"],
  ],
  [16, 52, 32]
));
bodyChildren.push(h2("4.2 Residual risks, stated honestly"));
bodyChildren.push(body("No audit ends at zero. Four residuals were noted, none of them open doors today. The SES bounce webhook, when its shared secret is absent, falls back to accepting only bounce events that cite a message identifier this platform generated; adding the same RSA signature check the inbound route already uses would remove that dependency on the environment variable. The URL guard acknowledges in code that a theoretical DNS rebinding race between resolution and fetch remains open, a known industry tradeoff. The unsubscribe signature is a keyed hash whose salt falls back to a constant when neither production secret is set; both secrets are set in production, and the worst case of a forged signature is an unwanted opt out, not a data breach. Finally, open tracking pixels can be inflated by a recipient reloading their own mail, which distorts open rate vanity metrics but touches nothing of value."));
bodyChildren.push(caption("Table 3: Residual risk register"));
bodyChildren.push(dataTable(
  ["Item", "Exposure", "Assessment"],
  [
    ["SES bounce webhook signature fallback", "A forger who knew a valid message id could forge a bounce for that one address", "Low: message ids are server generated and never leave EmailLog; secret is set in production"],
    ["DNS rebinding race in URL guard", "A hostile URL could resolve public then private between check and fetch", "Low: acknowledged in code, no privileged network behind the app"],
    ["Unsubscribe signature salt fallback", "Constant salt if both production secrets are unset", "Low: secrets confirmed present; impact limited to forced opt out"],
    ["Open pixel inflation", "Open counts can be inflated by the recipient", "Informational: vanity metric only"],
  ],
  [26, 40, 34]
));

// 5 ─ TRL rating
bodyChildren.push(h1("5. Technology Readiness Level Rating"));
bodyChildren.push(body("The rating uses the standard nine level scale, where level 8 means the system is complete and qualified through test and demonstration in its operational environment, and level 9 means the actual system has proven successful in sustained operation at scale. HustlePortal sits at level 8 today. The evidence for the core is production operation with real users and real money, and every claim below was re verified on the assessment date."));
bodyChildren.push(caption("Table 4: TRL scale mapping"));
bodyChildren.push(dataTable(
  ["Level", "Definition", "Status for HustlePortal"],
  [
    ["1 to 3", "Basic principles, concept, proof of concept", "Passed in earlier development"],
    ["4 to 5", "Validation in laboratory and relevant environment", "Passed: local QA harnesses and staging lanes"],
    ["6", "Prototype demonstrated in relevant environment", "Passed: pilot campaigns and probe accounts on production"],
    ["7", "System prototype demonstrated in operational environment", "Passed: live card payments, real campaigns, real members"],
    ["8", "System complete, qualified through test and demonstration", "Current level: 39 of 39 end to end, 11 of 11 control wall, 24 of 24 security probes"],
    ["9", "Proven in sustained operational success at scale", "Not yet: see Section 7 for the closing steps"],
  ],
  [12, 44, 44]
));
bodyChildren.push(body("The single number hides useful texture, so the subsystem view follows. The security and payment cores have effectively been proven at level 9 conditions: months of continuous production, real transactions, and a standing adversarial probe that passes. The campaign engine is level 8, qualified through four regional waves totalling 446 sends. The offline mode shipped its second version and is level 7: it works, its write path sync is young. The outbound email lane at 50,000 per day is level 6, engineered and rehearsed at small volume but not yet demonstrated at target scale."));
bodyChildren.push(caption("Table 5: Subsystem readiness"));
bodyChildren.push(dataTable(
  ["Subsystem", "Evidence", "TRL"],
  [
    ["Authentication and account security", "Epoch invalidation, rate limits, probes pass, months in production", "9"],
    ["Payments and wallet", "Live Yoco mode, webhook HMAC with replay window, wallet arithmetic verified", "9"],
    ["Lead discovery and reveal", "Discovery returns attributed results, reveal honesty contract holds, cache dedupes", "8"],
    ["Campaign engine", "Born paused queues, suppression checked twice, 464 send wave at 43.5 percent open", "8"],
    ["Inbound mail and aliases", "SNS signature verification, CC to log live, alias routing", "8"],
    ["Offline capability", "Read mode and outbox version 2 shipped, write sync maturing", "7"],
    ["Bulk email lane at 50,000 per day", "SES lane live, Resend lane live, warmup and quota path designed", "6"],
  ],
  [30, 55, 15]
));

// 6 ─ Traction
bodyChildren.push(h1("6. Production Traction Evidence"));
bodyChildren.push(body("A TRL claim is only as good as the operational record behind it. The numbers below come from the platform's own executive dashboard and campaign ledger, read on the assessment date. They describe an early but genuinely operating business: real accounts, real opens, real card rails, and cost discipline in the cents per day range for the data operations that feed the lead finder."));
bodyChildren.push(caption("Table 6: Platform operating snapshot, 15 November 2026"));
bodyChildren.push(dataTable(
  ["Metric", "Value", "Reading"],
  [
    ["Registered accounts", "447 (48 real members after QA and internal filters)", "Test bench separated from humans by design"],
    ["Paying subscribers", "1 active at R199 per month, 16 paused, 2 pending", "First revenue recorded; plan ladder live"],
    ["Wallet float", "R80,465.50 total, R11,107.00 on human accounts", "Prepaid credits held against future reveals"],
    ["Leads on platform", "1,801 pipeline leads plus 30 new pool arrivals", "The lead finder and pool are in daily use"],
    ["Largest campaign", "Ubuntu Wellness: 522 queued, 464 sent, 202 opened (43.5 percent)", "Branded done for you lane delivered"],
    ["Treg introduction waves", "446 sent across four regional waves, 148 opened (41.1 percent)", "Cold outreach engine works at wave scale"],
    ["Suppression list", "576 entries: 543 bounces, 22 unsubs, 10 manual, 1 complaint", "The safety machinery catches failures automatically"],
    ["Email cost to date", "USD 0.87 for contact verification, cents per day for search sweeps", "Lead supply is effectively free at current scale"],
  ],
  [24, 42, 34]
));
bodyChildren.push(body("Two ratios deserve an investor's eye. The 43.5 percent open rate on the branded campaign is the number that makes the done for you offer sellable, because it proves the platform's mail reaches inboxes rather than spam folders. And the suppression list, far from being a failure count, is the asset that keeps it that way: every dead address the system retires protects the sender reputation that the 50,000 per day plan in Section 7 depends on."));

// 7 ─ Gaps and roadmap
bodyChildren.push(h1("7. Known Gaps and the Path to Level 9"));
bodyChildren.push(body("The distance between level 8 and level 9 is sustained success at scale, and it decomposes into four concrete workstreams. None requires research risk; all are engineering and operations with known costs. The roadmap below is deliberately conservative about what is proven and what is planned."));
bodyChildren.push(caption("Table 7: Gap closure roadmap"));
bodyChildren.push(dataTable(
  ["Gap", "Work", "Cost", "Outcome"],
  [
    ["First touch email lane capped at 100 per day on the free Resend tier", "Upgrade to Resend Pro for the outreach lane, keep AWS SES for internal traffic", "USD 20 per month", "Unlimited daily sends up to 50,000 per month for cold first touch"],
    ["SES quota below the 50,000 per day target", "AWS sending quota increase with the existing bounce and complaint record, then a dedicated IP with a four to eight week warmup ladder", "USD 24.90 per month per IP plus USD 0.10 per 1,000", "50,000 per day on owned infrastructure at roughly USD 150 per month at full volume"],
    ["Offline write sync young", "Complete phase two of the offline plan: queued writes, background sync, conflict rules", "Engineering time", "Field agents work without signal and reconcile on reconnect"],
    ["Single region database", "Enable a standby region and tested restore drill", "Hosting differential", "Recovery point measured in minutes, resilience investors can audit"],
    ["Revenue concentration", "Run the outreach programme monthly with the survey feedback loop, convert opens into activations and the activation ladder into subscribers", "Operating discipline", "A track record of months, not snapshots: the actual level 9 condition"],
  ],
  [26, 34, 16, 24]
));
bodyChildren.push(body("Sizing the round against this table: the technical budget to reach a defensible level 9 claim is dominated by the warmup calendar and the revenue track record, not by development. That is the correct shape for a raise at this stage, because it means the capital buys distribution, list quality and time, while the platform itself already carries the load."));

// 8 ─ Conclusions
bodyChildren.push(h1("8. Conclusions"));
bodyChildren.push(body("HustlePortal is a technology readiness level 8 platform: complete, qualified through demonstration, and operating in production with real customers and real money. The end to end suite passed in full, the security audit found no open door and a culture of honest fallbacks, and the operating record shows a working revenue motion at small scale with an open rate that validates the offer. The residual work to level 9 is a warmup calendar, a quota application and months of sustained operation, all costed and owned."));
bodyChildren.push(body("The recommendation to prospective investors is to treat this as an execution investment rather than a technology bet. The platform's discipline, its automatic suppression machinery, its double gated sending controls and its honest test culture, is the machinery that will keep 50,000 daily emails out of spam folders and the business on the right side of its regulators. That machinery is already built and already tested. What the round adds is fuel."));

// ══ assemble ══
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: EN, size: 24, color: "000000" }, paragraph: { spacing: { line: 312 } } },
      heading1: { run: { font: EN, size: 32, bold: true, color: P.primary }, paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 } },
      heading2: { run: { font: EN, size: 28, bold: true, color: P.primary }, paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 } },
    },
  },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "HustlePortal Technology Readiness Assessment",
        subtitle: "End to end testing, security audit and TRL rating for fundraising",
        englishLabel: "TECHNOLOGY DUE DILIGENCE",
        metaLines: [
          "Prepared for: Prospective investors and partners",
          "Prepared by: Simple Eternity Holdings (Pty) Ltd t/a Business Hustle",
          "Platform: https://www.hustleportal.online",
          "Assessment date: 15 November 2026",
        ],
        footerLeft: "Business Hustle", footerRight: "November 2026",
      }),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 }, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter() },
      children: tocChildren,
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 }, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader("HustlePortal Technology Readiness Assessment") },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.mkdirSync("/home/z/my-project/download", { recursive: true });
  fs.writeFileSync("/home/z/my-project/download/HustlePortal_TRL_Assessment.docx", buf);
  console.log("written: download/HustlePortal_TRL_Assessment.docx", buf.length, "bytes");
});
