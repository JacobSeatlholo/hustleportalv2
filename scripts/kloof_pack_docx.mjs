// Task 185: kloofstreet openers follow-up pack (docx, copywriting scene).
// Profile B (Calibri), line 400, no cover, no TOC, minimal footer.
// Laws: 0 em dashes, 0 en dashes, no markdown, 【Your name】 placeholders,
// never-say-you-opened law, honest numbers only (from the 10 Nov door read).
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, PageNumber, AlignmentType, HeadingLevel, WidthType, BorderStyle,
  ShadingType,
} from "docx";
import fs from "fs";


const OUT = "/home/z/my-project/download/kloofstreet-openers-followup/KLOOF-OPENERS-FOLLOW-UP-PACK.docx";

// palette: copywriting scene
const P = { primary: "1A1A1A", body: "333333", secondary: "666666", accent: "C0392B", brand: "1B7D46" };
const EN = { ascii: "Calibri", eastAsia: "Microsoft YaHei" };

const t = (text, opts = {}) => new TextRun({ text, size: 22, color: P.body, font: EN, ...opts });
const body = (text, opts = {}) => new Paragraph({
  spacing: { before: 120, after: 160, line: 400 }, children: [t(text)], ...opts,
});
const rich = (runs, opts = {}) => new Paragraph({ spacing: { before: 120, after: 160, line: 400 }, children: runs, ...opts });
const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 140, line: 400 },
  children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: EN })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100, line: 400 },
  children: [new TextRun({ text, bold: true, size: 24, color: P.primary, font: EN })],
});
const scriptLine = (text) => new Paragraph({
  spacing: { before: 80, after: 80, line: 400 },
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: "F8CD6E", space: 12 } },
  children: [t(text, { italics: false })],
});
const note = (text) => new Paragraph({
  spacing: { before: 60, after: 60, line: 320 },
  children: [t(text, { size: 18, color: P.secondary, italics: true })],
});

const cellMargins = { top: 80, bottom: 80, left: 140, right: 140 };
function table(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "9AA6B2" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "9AA6B2" },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D0D0D0" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((h, i) => new TableCell({
          children: [new Paragraph({ spacing: { line: 300 }, children: [t(h, { bold: true, size: 20, color: P.primary })] })],
          shading: { type: ShadingType.CLEAR, fill: "F5EFE0" },
          margins: cellMargins,
          width: { size: widths[i], type: WidthType.PERCENTAGE },
        })),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((c, i) => new TableCell({
          children: [new Paragraph({ spacing: { line: 300 }, children: [t(c, { size: 20 })] })],
          shading: ri % 2 ? { type: ShadingType.CLEAR, fill: "FAFAF7" } : undefined,
          margins: cellMargins,
          width: { size: widths[i], type: WidthType.PERCENTAGE },
        })),
      })),
    ],
  });
}

const children = [];

// ---------- title ----------
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60, line: 460 },
  children: [new TextRun({ text: "Kloofstreet Openers Follow Up Pack", bold: true, size: 36, color: P.primary, font: EN })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80, line: 340 },
  children: [t("29 inboxes opened the Kloof Street email and made your list. Here is how to work them, on the phone and by email.", { size: 21, color: P.secondary })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 220, line: 340 },
  children: [t("Nothing in this pack sends by itself. Every call, email and WhatsApp is your hand.", { size: 21, color: P.secondary, italics: true })],
}));

// ---------- 1. snapshot ----------
children.push(h1("1. Snapshot, read today, 10 November"));
children.push(table(
  ["Fact", "Number"],
  [
    ["Sent", "26 Oct, 15:45 to 16:50, from hello@hustleportal.online"],
    ["Subject", "The world has discovered Kloof Street"],
    ["Delivered", "65 rows: 64 sent, plus Stud whose first attempt failed and whose retry landed and was opened"],
    ["Opened", "30 inboxes (46%), 29 companies. Blondie Bar removed at your instruction, 28 companies on the list"],
    ["Total opens", "77, up from 68 on 8 Nov and 71 on 9 Nov. People keep coming back to the email. 76 on your list without Blondie Bar"],
    ["Removed", "Blondie Bar, capetown@blondie.bar: 1 open. Off the list and on the do-not-send register for every future campaign"],
    ["Also off the email drafts", "Mount Nelson Hotel: Elri clicked unsubscribe after the first mail. The register carries them; the phone is your judgment call"],
    ["Parked", "34 inboxes never opened, no second touch yet"],
  ],
  [22, 78],
));
children.push(body(
  "Why this list is worth your morning: a quarter of the openers came back to the email more than once, two weeks after the send. Club Kloof and Rick's Cafe Americain each opened it ten times. Sonia at Boetiek opened it six. These are warm names, and the street is walking into summer.",
));

// ---------- 2. rules ----------
children.push(h1("2. Rules of engagement"));
children.push(rich([
  t("The never say you opened law. ", { bold: true }),
  t("The opens are your timing, never your opener. Say \u201cI emailed you a couple of weeks ago\u201d, never \u201cI saw you read my email\u201d. To them it is private; using it out loud reads as watching them and burns the trust the email built."),
]));
children.push(rich([
  t("One touch at a time. ", { bold: true }),
  t("Call first. Send the follow up email only after the call, or the same day if they asked for it. WhatsApp only for the five numbers on file, and only after a call or a missed one."),
]));
children.push(rich([
  t("Dial windows. ", { bold: true }),
  t("Mid morning, 10:00 to 11:30, or mid afternoon, 15:00 to 16:30. Tuesday to Thursday is the sweet street. Restaurants, bars and salons: never Friday or Saturday service hours."),
]));
children.push(rich([
  t("Honesty laws. ", { bold: true }),
  t("Claiming a profile is free. The backoffice is included. There is no lock in. And until the November pricing call is made, quote nothing special, promise no discount."),
]));

// ---------- 3. call script ----------
children.push(h1("3. The call script"));
children.push(h2("Opening"));
children.push(scriptLine("\u201cHi {Name}, this is 【Your name】 from kloofstreet.online, the local guide for Kloof Street. I emailed you a couple of weeks ago about the street being named the coolest in Africa. Did I catch you OK for two minutes?\u201d"));
children.push(h2("Discovery, pick two, listen more than you talk"));
children.push(body("How do new customers find you today? Is summer busier than last year? Who looks after your marketing, you or someone else? Have you ever looked your business up on the guide?"));
children.push(h2("The bridge"));
children.push(scriptLine("\u201cThat is exactly the gap the guide closes. People plan the visit before they arrive. When they decide where to eat or shop, the guide is already in their hand.\u201d"));
children.push(h2("The ask"));
children.push(scriptLine("\u201cClaiming your profile takes two minutes and costs nothing. Shall we do it right now while we talk? I will send you the link and walk you through it. Once you are on, there is a full backoffice behind your page: customers, newsletters, invoices, appointments and local leads, all in one place.\u201d"));
children.push(h2("Three closes"));
children.push(rich([t("Direct: ", { bold: true }), t("\u201cShall we claim it while we are on the phone?\u201d")]));
children.push(rich([t("Demo: ", { bold: true }), t("\u201cI will prepare your page today and you judge it tonight with your own eyes.\u201d")]));
children.push(rich([t("Summer: ", { bold: true }), t("\u201cThe season is starting. Be findable before December, not after it.\u201d")]));

// ---------- 4. voicemail, gatekeeper, objections ----------
children.push(h1("4. Voicemail, gatekeeper and five objections"));
children.push(h2("Voicemail, twenty seconds"));
children.push(scriptLine("\u201cHi {Name}, 【Your name】 from kloofstreet.online here. I emailed you about the street being named the coolest in Africa and your free profile on the guide. Call me back on 【your number】, any time. Thank you.\u201d"));
children.push(h2("Gatekeeper"));
children.push(scriptLine("\u201cIt is about his free listing on the Kloof Street guide, he got an email from us a while back. When is a good time to catch him?\u201d"));
children.push(h2("Five answers"));
children.push(rich([t("\u201cWe are fully booked anyway.\u201d ", { bold: true }), t("\u201cPerfect, then the guide does the picking for you: claim the page so the right people find you, and the backoffice takes the admin off your hands.\u201d")]));
children.push(rich([t("\u201cI already do Instagram and Google.\u201d ", { bold: true }), t("\u201cThose work once people know you. The guide catches people planning a Kloof Street visit who do not know you yet. Different job, same phone.\u201d")]));
children.push(rich([t("\u201cWhat does it cost?\u201d ", { bold: true }), t("\u201cClaiming your profile is free. If you want, I personally help you set it up and show you the backoffice. Month to month, no lock in.\u201d")]));
children.push(rich([t("\u201cToo busy right now.\u201d ", { bold: true }), t("\u201cThen it is two minutes today and done before the December rush, not three hours in January.\u201d")]));
children.push(rich([t("\u201cJust email me instead.\u201d ", { bold: true }), t("\u201cWill do, today. It is the two minute claim link and my number, so you can reach a human when you want one.\u201d")]));

// ---------- 5. the follow up email ----------
children.push(h1("5. The follow up email"));
children.push(rich([
  t("Greeting law: ", { bold: true }),
  t("use the greeting the campaign already used for that inbox, it is in the Email drafts sheet of the workbook. Ameer, Daniel, Bryan, Sonia, Julian, Lauren, Zaheer and Kylie and Enver got named greetings. Everyone else starts \u201cHi there,\u201d."),
]));
children.push(rich([t("Subject A: ", { bold: true }), t("Your Kloof Street neighbours are claiming their profiles")]));
children.push(rich([t("Subject B: ", { bold: true }), t("Two minutes about your free profile on kloofstreet.online")]));
children.push(h2("Body, paste as is from the workbook"));
const emailLines = (
  "Hi {them},\n\n" +
  "I emailed you a couple of weeks ago about Kloof Street being named the 22nd coolest street in the world, and the coolest in Africa. " +
  "People are using kloofstreet.online to decide where to eat, shop and unwind before they even arrive on the street. " +
  "When they do, will they find you?\n\n" +
  "Here is the short version of what I suggested:\n\n" +
  "Already listed? Claim your profile. It takes about two minutes, it is free, and it puts you in control of how your business appears on the guide.\n\n" +
  "Not listed yet? Click Get Listed on the same page and I will personally help you get started.\n\n" +
  "And once you are on the guide, there is a full backoffice behind it, built for local businesses: customer management, newsletters, invoices, " +
  "appointments and local business leads, all in one place. Your storefront on Kloof Street, your operations behind it.\n\n" +
  "If you would rather chat for five minutes, reply with a good number and I will call you. The season is starting, and I want our street's " +
  "businesses to be the ones people find.\n\n" +
  "Claim your profile or get listed: https://www.kloofstreet.online/get-listed\n\n" +
  "Either way, thank you for reading.\n\n" +
  "Warm regards,\n【Your name】\nKloofstreet.online\n\n" +
  "Not keen on emails from us? Reply \u201cno thanks\u201d and we won\u2019t mail you again."
).split("\n");
for (const line of emailLines) {
  if (line.trim() === "") {
    children.push(new Paragraph({ spacing: { before: 0, after: 100, line: 200 }, indent: { left: 360, right: 360 },
      shading: { type: ShadingType.CLEAR, fill: "FAF7EF" }, children: [t(" ", { size: 12 })] }));
  } else {
    children.push(new Paragraph({
      spacing: { before: 0, after: 20, line: 320 }, indent: { left: 360, right: 360 },
      shading: { type: ShadingType.CLEAR, fill: "FAF7EF" },
      children: [t(line, { size: 20 })],
    }));
  }
}
children.push(note("The echo on purpose: the body repeats the claim and get listed links from the first email, so the thread reads as one conversation. The opt out line matches the first send word for word."));

// ---------- 6. whatsapp ----------
children.push(h1("6. WhatsApp texts, the five numbers on file"));
children.push(body("Rick's Cafe Americain, 021 424 1100. Van Hunks, 021 422 5422. Judd's Local, 064 527 1272. Excentric on Kloof, 076 783 5488. AKJP Studio, 079 490 9492. One tap links are in the workbook."));
children.push(scriptLine("\u201cHi Rick's team, 【Your name】 from kloofstreet.online here. I emailed you about the guide and your free profile. Want me to walk you through the two minute claim? Or I can call when it suits you.\u201d"));
children.push(note("Same three lines for the other four, swap the name. Send only after a call or a missed call, never cold."));

// ---------- 7. tiers ----------
children.push(h1("7. The three tiers"));
children.push(table(
  ["Tier", "Who", "Opens", "Work them by"],
  [
    ["T1, 8 companies", "Club Kloof, Rick's Cafe Americain, Boetiek, Vortex Shisha, AKJP Studio, Toni's on Kloof, Van Hunks, Mamacita's", "10 to 3", "Within 48 hours"],
    ["T2, 13 companies", "Workshop17, Mount Nelson, Judd's Local, Life and Brand, Sweet Revenge, Swift Dry Cleaners, Vadivelu, Yemaya Salon, Lucky Locals Club, Spoilt Hair Salon, Urban Connect, Yindee's, Yours Truly (Ameer and Daniel, one shop)", "2", "Within 5 days"],
    ["T3, 7 companies", "Sushi Box, Our Local, Unknown Eyewear, Shanti Natural, Excentric on Kloof, Robyn Page Physiotherapy, Stud", "1", "Within 10 days"],
  ],
  [18, 52, 12, 18],
));
children.push(note("Yours Truly is one shop with two inboxes, Ameer and Daniel, one call and one listing. Stud's first send failed on a rate limit, the retry landed and was opened once, so they are treated as delivered."));

// ---------- 8. tracking ----------
children.push(h1("8. Tracking discipline"));
children.push(body("Fill the Call status column the same hour, every dial. Log the objection words in Notes, they are next week's script edits. One touch per company until it answers. T1 today, T2 in five days, T3 in ten. When somebody claims or lists, write CLOSED in the status and the street guide does the rest."));

// ---------- 9. rates ----------
children.push(h1("9. Rates, and the pricing note"));
children.push(table(
  ["Pass", "Monthly", "What it carries"],
  [
    ["Explorer", "R199", "Partner discounts, WhatsApp flash deals, Member Nights, AI concierge"],
    ["Insider", "R499", "All Explorer plus bookable experiences, wellness mornings, art walks, beauty days"],
    ["Collector", "R999", "All Insider plus two experiences a month and bespoke concierge"],
  ],
  [18, 16, 66],
));
children.push(body(
  "Verified live on kloofstreet.online this morning. Claiming a business profile is free, and Get Listed is the assisted path. Pricing note: the November Black Friday decision sits with you. Until you call it, this pack quotes standard rates and promises nothing special.",
));

// ---------- document ----------
const doc = new Document({
  styles: { default: { document: {
    run: { font: EN, size: 22, color: P.body },
    paragraph: { spacing: { line: 400 } },
  } } },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
      },
    },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary, font: EN })],
    })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("saved", OUT, buf.length, "bytes");
});
