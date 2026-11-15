#!/usr/bin/env node
/**
 * Business Hustle first-touch outreach pack (email draft, survey, lanes,
 * footer marketing). English, Profile A formal, R1 cover GO-1, 3 sections.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} from "docx";
import fs from "node:fs";

// ── palette GO-1 (Graphite Orange, plans/proposals) ──
const P = {
  bg: "1A2330", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", footerColor: "687078", accent: "D4875A",
  primary: "2C3E50",
  table: { headerBg: "D4875A", headerText: "FFFFFF", accentLine: "D4875A", innerLine: "DDD0C8", surface: "F8F0EB" },
};
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };
const EN = { ascii: "Times New Roman", eastAsia: "Times New Roman" };

function safeText(v, ph) {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") return ph || "";
  return String(v);
}
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
  const charWidth = (pt) => pt * 10;
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
/** The letter box: a shaded single cell table so the draft reads as one block. */
function letterBox(lines) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      left: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      right: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideHorizontal: NB, insideVertical: NB,
    },
    rows: [new TableRow({
      cantSplit: false,
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.table.surface },
        margins: { top: 140, bottom: 140, left: 200, right: 200 },
        children: lines.map(l => new Paragraph({
          spacing: { line: 300, after: l === "" ? 80 : 60 },
          children: [new TextRun({ text: l === "" ? " " : l, size: 22, color: "000000", font: EN })],
        })),
      })],
    })],
  });
}
const pageFooter = () => new Footer({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: EN })] })],
});
const pageHeader = (t) => new Header({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, size: 18, color: "808080", font: EN })] })],
});

// ── the approved letter (dash free, matches scripts/bh_outreach.mjs) ──
const LETTER = `Hi {name}

I am Jacob from Business Hustle in Cape Town. I have a quick question and a free offer, and that is the whole email.

Most business owners tell me the same thing. Finding new customers takes the most time and the most money. Not doing the work, finding the people who need the work.

So we built HustlePortal. It finds real businesses in your industry and your city that are growing, hiring or advertising right now, and it puts their contact details in front of you. You open your laptop, you pick your trade, you get a list of people to contact today. It also keeps your quotes, your jobs and your money talk in one place.

Here is the free part. Reply to this email with your industry and your city and I will send you a free sample of real leads for your trade. No payment, no card, no catch. If the sample is good you can carry on inside the app for free and only pay when you want more.

If you have 30 seconds, answer these four and I will make the sample fit you better.

1. How do you find most of your customers today?
2. What eats the most time when you look for new customers?
3. What would a steady list of new customers every month be worth to you?
4. Which industry and city should the free sample come from?

Either way, the free sample stands. Just reply.

Jacob Seatlholo
Business Hustle
HustlePortal, made for South African businesses
Unsubscribe any time, the link is below.`;

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

const B = [];
// 1 ─ positioning
B.push(h1("1. How the Offer Is Positioned"));
B.push(body("The letter leads with the problem, not the product. Every industry feels the same squeeze: doing the work is fine, finding the people who need the work is what eats the time and the money. Because that framing is true for a plumber, a salon and an agency alike, the same sentence lands regardless of who reads it, which is exactly the industry agnostic visibility the outreach needs. The product is then introduced in one concrete sentence about what it does, with no jargon and no claims about the technology behind it."));
B.push(body("The offer is a free sample of real leads in the reader's own trade and city, claimed by replying to the email. A reply is the strongest signal a cold campaign can produce: it confirms the address is live, it starts a personal conversation with the boss as the sender, and it sidesteps the automation traps that damage sender reputation. The four question survey is folded into that same reply, so the survey costs the reader nothing extra and every answer maps a pain point the platform already solves. The letter is written in plain english with no dashes anywhere, as instructed, and it closes with the sender identity and an unsubscribe line in every send."));
B.push(body("Positioning alternatives considered and set aside: a discount led pitch, which anchors the product as cheap and invites price shoppers; a feature tour, which buries the problem and reads like every other software email; and a meeting request, which asks for the biggest possible commitment from a stranger. The free sample asks for the smallest honest action and hands over value before asking for anything in return."));

// 2 ─ the draft
B.push(h1("2. The Email Draft for Approval"));
B.push(body("The draft below is the exact text staged by the sending script. The greeting fills in each reader's first name automatically, and the system falls back to the business name or an honest there when no name is on record. Two subject lines are offered; the first is set in the script and the second is the alternate if the boss prefers a softer opening."));
B.push(caption("Subject line options"));
B.push(dataTable(
  ["Option", "Subject line", "Why"],
  [
    ["A (set in script)", "Quick one about finding customers", "Sounds like a person, promises brevity, names the pain in plain words"],
    ["B (alternate)", "A free sample of customers for your trade", "Leads with the gift, names the personalisation"],
  ],
  [18, 40, 42]
));
B.push(caption("The letter, exactly as it will send"));
B.push(letterBox(LETTER.split("\n")));
B.push(body("Notes on the mechanics: the merge token appears once in the greeting, the letter carries no links except the signed unsubscribe line the engine appends automatically, and the open tracking pixel rides invisibly so the follow up can separate readers from non readers. The body is short enough to read on a phone in under forty seconds."));

// 3 ─ survey
B.push(h1("3. The Short Survey"));
B.push(body("The survey lives inside the letter as four numbered questions the reader answers in their reply. That design choice matters: a hosted form link would leak attention to a third party page, add a click barrier, and read as marketing machinery. A reply keeps everything in the boss's own inbox and every answer is attached to a real thread with a real person."));
B.push(caption("Table: survey questions and what each one establishes"));
B.push(dataTable(
  ["Question", "What it establishes"],
  [
    ["1. How do you find most of your customers today?", "The current behaviour and its cost, the baseline the problem statement is measured against"],
    ["2. What eats the most time when you look for new customers?", "Where the pain concentrates, which shapes product priorities and the sales script"],
    ["3. What would a steady list of new customers every month be worth to you?", "Willingness to pay in the reader's own words, which validates the pricing ladder"],
    ["4. Which industry and city should the free sample come from?", "The fulfilment instruction for the free sample, and clean segmentation data for the follow up"],
  ],
  [46, 54]
));
B.push(body("Read together the four answers outline the problem the product solves, in the market's own language. They also sort replies into hot, warm and cold by effort: a full answer set with a specific trade and city is a hot lead for a personal demo, a one line reply is warm, and silence after the sample lands is cold."));

// 4 ─ audience
B.push(h1("4. Audience, Exclusions and Safety Rails"));
B.push(body("The campaign goes to the Business Hustle pipeline: every lead on the boss's own account that carries an email address, exactly the list the boss named, with one person removed by name. Wilscha van Heerden of Wilscha Skincare is a Business Hustle client with an invoice on record, so she is excluded from her own supplier's cold outreach; the exclusion is written into the staging command and reported in the staging readout. The platform's own safety rails apply on top, automatically and without exception."));
B.push(caption("Table: who receives the letter and who never can"));
B.push(dataTable(
  ["Group", "Treatment"],
  [
    ["Business Hustle pipeline leads with an email, all stages, new and old", "Queued by the leadsOf staging source, resolved server side so no address list ever leaves the platform"],
    ["Wilscha Skincare", "Excluded by name in the staging command, count reported back at stage time"],
    ["Suppressed addresses (576 today: bounces, unsubs, manual, one complaint)", "Refused at staging and checked again before every single send by the queue engine"],
    ["Anyone who unsubscribes later", "One click, signed link in every email, immediate suppression, never contacted again"],
    ["Member blast audiences", "Untouched: this campaign rides the executive campaign lane, not the system blast law"],
  ],
  [44, 56]
));
B.push(body("The queue is born paused and nothing can send until Start is pressed. The script that stages it carries a second gate of its own: the start command refuses to run unless the environment carries the word GREENLIGHT. Compliance notes for the record: every email carries the sender identity, a physical presence in Cape Town, and a working unsubscribe, and the public remove my business endpoint stays open for any listing owner under POPIA. The list is business role mail gathered from public business activity; the boss should have his own advisor confirm the POPIA position for cold business email as the volume grows."));

// 5 ─ lanes
B.push(h1("5. Sending Lanes: Resend and AWS SES"));
B.push(body("The boss's instinct is right and the numbers now confirm its exact shape: Resend for first touch, AWS for everything internal. Resend's free tier gives 100 emails per day and 3,000 per month at zero cost, which comfortably covers the opening waves of this campaign and keeps the newest spend at zero. AWS SES, already granted production access and already delivering the platform's internal traffic, is the scale lane: it prices at about USD 0.10 per thousand sends and, after a quota increase, carries the 50,000 per day target. The verified plan caps as of November 2026 are in the table."));
B.push(caption("Table: the two lanes with verified limits and current pricing"));
B.push(dataTable(
  ["Lane", "Verified limits", "Price", "Role"],
  [
    ["Resend Free", "100 per day, 3,000 per month", "USD 0", "First touch waves while the list is small and the survey is learning"],
    ["Resend Pro", "No daily cap, 50,000 per month, overage USD 0.90 per 1,000", "USD 20 per month", "First touch at full pipeline volume, roughly 1,600 per day"],
    ["AWS SES", "Production access live; 50,000 per day after a standard quota increase", "About USD 0.10 per 1,000", "Internal comms: welcomes, reminders, receipts, and the 50,000 per day programme"],
  ],
  [16, 34, 20, 30]
));
B.push(body("The practical recommendation: start this campaign on Resend Free and let the first ninety sends prove the letter. If the pipeline queue is larger than the free daily cap, either stage it in daily batches or move the lane to Resend Pro for twenty dollars a month; what must never happen is firing thousands of sends into a daily cap, because the rejects would burn the audience. The platform's queue engine already paces sends and retries politely, so the only real decision is the cap arithmetic."));

// 6 ─ 50k/day
B.push(h1("6. The Road to 50,000 Emails a Day"));
B.push(body("Fifty thousand a day is not a switch, it is a reputation you build. The engineering is already in place: dual lanes, per hour pacing, burst protection, automatic suppression, signed unsubscribe and full send logging. What the volume needs is a warm, defensible sending identity and a clean list, and those have a known calendar."));
B.push(caption("Table: the warmup ladder from today to 50,000 per day"));
B.push(dataTable(
  ["Phase", "Actions", "Volume", "Duration"],
  [
    ["Now", "First touch on Resend Free; SES keeps internal comms; the survey shapes the letter", "Up to 100 per day", "Weeks 1 and 2"],
    ["Lane upgrade", "Resend Pro; continue survey driven iterations; watch reply and bounce rates", "Up to about 1,600 per day", "Weeks 3 and 4"],
    ["Quota and identity", "AWS sending quota increase; dedicated sending subdomains with their own SPF, DKIM and DMARC; SES dedicated IP ordered", "Warmup from 200 per day, doubling every two to three days", "Weeks 5 to 8"],
    ["Warmup ladder", "Ramp the SES lane with the verified, suppressed list; hold if bounces pass 2 percent or complaints pass 0.1 percent, the platform's existing hard stops", "500, then 2,000, then 10,000, then 25,000", "Weeks 9 to 12"],
    ["Steady state", "50,000 per day on SES at roughly USD 150 per month, first touch stays on Resend, internal on SES aliases", "50,000 per day", "From month 4"],
  ],
  [16, 44, 22, 18]
));
B.push(body("Two honest constraints sit under this table. The historical list carries a high bounce legacy, which is why the suppression list of 576 entries is treated as an asset: every future wave sends to freshly verified addresses only, and the platform's own verification spend to date has been under one dollar for hundreds of contacts. And reputation is earned per sending identity, which is why the plan isolates cold first touch on its own subdomain so that a bad week there can never poison the invoices and reminders that members depend on."));

// 7 ─ footer
B.push(h1("7. The Footer That Sells While You Sleep"));
B.push(body("Every email the platform sends, welcome letters, reminders, invoices, campaign sends, already rides a common chrome. Adding one quiet line to that chrome turns the entire email operation into a free marketing channel: no extra sends, no extra spend, and an impression count that grows with the business itself. The tone must be subtle, one line, no exclamation marks, because the footer's job is to be noticed by the right reader and ignored politely by everyone else."));
B.push(caption("The proposed footer line, in plain english"));
B.push(letterBox([
  "Lead lists, quotes and invoices in one place. Free to start at hustleportal.online",
]));
B.push(body("The arithmetic of compounding impressions, marked clearly as illustrative: at 50,000 sends per day the footer prints about 1.5 million impressions a month. If one in a thousand readers clicks and one in twenty of those opens a free account, the footer alone adds about 75 signups a month at zero marginal cost. At the current R199 plan price that is roughly R14,900 of monthly recurring value created by a line of text that was already being delivered. Even if the real rates land at half those figures, the footer pays for its own existence many times over, and it costs nothing to run."));
B.push(body("Discipline rules to keep it subtle: the footer never changes per campaign, never shouts, never discounts, and never grows a second line. It is the quietest possible handshake at the bottom of every letter the business sends."));

// 8 ─ greenlight
B.push(h1("8. The Greenlight Checklist"));
B.push(body("Everything is built and nothing has moved. The letter and survey are awaiting the boss's word, and the sequence after that word is deliberately short and visible."));
B.push(caption("Table: what happens on greenlight"));
B.push(dataTable(
  ["Step", "Command or action", "Effect"],
  [
    ["1. Stage the queue", "node scripts/bh_outreach.mjs stage", "Every pipeline lead with an email is queued, wilscha excluded, suppressed refused; the readout prints the honest counts"],
    ["2. Read the counts", "node scripts/bh_outreach.mjs status", "Queue size, provider and pace confirmed; the queue sits paused"],
    ["3. Arm the send", "GREENLIGHT=yes node scripts/bh_outreach.mjs start", "The queue turns active and the engine paces it at 45 per hour on Resend"],
    ["4. Watch the first hour", "status command and the reply inbox", "Open tracking, replies and any bounces; the engine suppresses failures automatically"],
  ],
  [22, 36, 42]
));
B.push(body("Any time after arming, the same script pauses the queue with one command, and every queued row stays editable from the campaign console. The master draft rides the queue state, so a correction to the letter re-personalises every queued row without touching the audience. The gate is the boss's word: nothing in the chain sends before it, and the script itself refuses to arm without the explicit greenlight flag."));

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
        title: "Business Hustle First Touch Outreach Pack",
        subtitle: "Email draft, short survey, sending lanes and the footer that sells",
        englishLabel: "GROWTH OPERATIONS",
        metaLines: [
          "Audience: Business Hustle pipeline leads, wilscha excluded",
          "Lanes: Resend first touch, AWS SES internal",
          "Status: awaiting the boss's greenlight",
          "Date: 15 November 2026",
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
      headers: { default: pageHeader("Business Hustle First Touch Outreach Pack") },
      footers: { default: pageFooter() },
      children: B,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/BH_Outreach_Pack.docx", buf);
  console.log("written: download/BH_Outreach_Pack.docx", buf.length, "bytes");
});
