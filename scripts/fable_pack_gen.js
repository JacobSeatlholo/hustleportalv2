// HustlePortal Client Video Prompt Pack - docx generator.
// Cover: R1 recipe (design-system) with the BH brand palette (charcoal + yellow).
// Body: copywriting profile (Calibri, line 400, no TOC, minimal footer).
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, ShadingType, WidthType,
  TableLayoutType, Footer, PageNumber, SectionType,
} = require('docx');
const fs = require('fs');
const { prompts, anatomy } = require('./fable_pack_content.js');

// ---------- palette (BH brand on the cover, readable on white in the body) ----------
const COVER = {
  bg: '101013', titleColor: 'FFFFFF', subtitleColor: 'A6A9B0',
  metaColor: 'D5D7DC', accent: 'F5C518', footerColor: '8A8D94',
};
const INK = '141414';       // headings
const BODY = '2A2C31';      // body text
const MUTED = '63666D';     // secondary
const ACCENT = 'C9970F';    // darker yellow for white-background use (readable)
const BLOCK_BG = 'F7F6F2';  // prompt block background
const BLOCK_BORDER = 'E3E1DA';

// ---------- cover helpers (from design-system.md, verbatim logic) ----------
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([...'，。、；：！？', ...'的与和及之在于为', ...'-_—–·/', ...' \t']);
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
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
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
  return { topSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const P = config.palette;
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
      children: [new TextRun({ text: config.englishLabel.split('').join('  '), size: 18, color: P.accent, font: { ascii: 'Calibri' }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.titleColor, font: { ascii: 'Arial' } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800, line: 300, lineRule: 'atLeast' },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor, font: { ascii: 'Calibri' } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 22, color: P.metaColor, font: { ascii: 'Calibri' } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.footerColor, font: { ascii: 'Arial' } }),
      new TextRun({ text: '                                        ' }),
      new TextRun({ text: config.footerRight || '', size: 16, color: P.footerColor, font: { ascii: 'Arial' } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ---------- body helpers ----------
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 420, after: 160, line: 400 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'F5C518', space: 10 } },
    children: [new TextRun({ text, bold: true, size: 30, color: INK, font: { ascii: 'Calibri' } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120, line: 400 },
    children: [new TextRun({ text, bold: true, size: 26, color: INK, font: { ascii: 'Calibri' } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 80, after: 140, line: 400 },
    children: [new TextRun({ text, size: 22, color: BODY, font: { ascii: 'Calibri' }, ...opts })],
  });
}
function metaLine(label, text) {
  return new Paragraph({
    spacing: { before: 40, after: 60, line: 340 },
    children: [
      new TextRun({ text: label + '  ', bold: true, size: 20, color: ACCENT, font: { ascii: 'Calibri' } }),
      new TextRun({ text, size: 20, color: MUTED, font: { ascii: 'Calibri' } }),
    ],
  });
}
// The paste-ready prompt block: shaded paragraphs (page-break friendly, no tables)
function promptBlock(text) {
  const lines = text.split('\n');
  const paras = [];
  lines.forEach((line, i) => {
    const first = i === 0, last = i === lines.length - 1;
    paras.push(new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: BLOCK_BG },
      border: { left: { style: BorderStyle.SINGLE, size: 10, color: 'F5C518', space: 10 } },
      indent: { left: 240, right: 240 },
      spacing: { before: first ? 120 : 0, after: last ? 160 : 0, line: 264, lineRule: 'atLeast' },
      children: [new TextRun({ text: line === '' ? ' ' : line, size: 18, color: '1B1D23', font: { ascii: 'Courier New' } })],
    }));
  });
  return paras;
}

// ---------- assemble body ----------
const bodyChildren = [];

bodyChildren.push(h1('How to use this pack'));
for (const p of anatomy.howTo) bodyChildren.push(body(p));

bodyChildren.push(h1(anatomy.anatomyTitle));
for (const p of anatomy.anatomy) bodyChildren.push(body(p));

bodyChildren.push(h1('The eight prompts'));
bodyChildren.push(body('Paste one prompt, get one video. The three you asked for come first (meetings, outreach, lead search), then the five your clients ask for next. Each prompt carries its own style block, so any single prompt works on its own.'));

prompts.forEach((pr, i) => {
  bodyChildren.push(h2(`Prompt ${i + 1} — ${pr.title}`));
  bodyChildren.push(metaLine('Teaches:', pr.teaches));
  bodyChildren.push(metaLine('Example used:', pr.example));
  bodyChildren.push(metaLine('Swap-outs:', pr.swap));
  bodyChildren.push(...promptBlock(pr.text));
});

// ---------- document ----------
const doc = new Document({
  styles: { default: { document: {
    run: { font: { ascii: 'Calibri' }, size: 22, color: BODY },
    paragraph: { spacing: { line: 400 } },
  } } },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: 'Client Video Prompt Pack',
        subtitle: 'Eight paste-ready Fable prompts for client explainer videos, built from the launch ad',
        englishLabel: 'HUSTLEPORTAL CLIENT TRAINING',
        metaLines: [
          'Format: 9:16 vertical, 35-40 seconds, motion graphics',
          'Style: charcoal cards, yellow accents, mock UI, one story per video',
          'Source: the launch ad analysed frame by frame and by ear',
          'Prepared: 12 November 2026',
        ],
        footerLeft: 'Business Hustle',
        footerRight: 'hustleportal.online',
        palette: COVER,
      }),
    },
    {
      properties: { type: SectionType.NEXT_PAGE, page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 } } },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED, font: { ascii: 'Calibri' } })],
      })] }) },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync('/home/z/my-project/download/HustlePortal_Client_Video_Prompt_Pack.docx', buf);
  console.log('written', buf.length, 'bytes,', prompts.length, 'prompts');
});
