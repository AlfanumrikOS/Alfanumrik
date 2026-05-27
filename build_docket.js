// Alfanumrik Developer Docket — docx generator (scaffold)
//
// FASTEST WAY TO GET .DOCX (recommended):
//   Use Pandoc on the companion Markdown file.
//     pandoc Alfanumrik_Developer_Docket.md -o Alfanumrik_Developer_Docket.docx
//   Installs in seconds: `winget install JohnMacFarlane.Pandoc` (Windows)
//   or `brew install pandoc` (macOS).
//
// ALTERNATE: Styled .docx via docx-js (this script)
//   1. npm install docx
//   2. Port section content from Alfanumrik_Developer_Docket.md into the
//      children[] array using the H1/H2/H3/body/bullet/buildTable helpers
//      already defined below.
//   3. node build_docket.js Alfanumrik_Developer_Docket.docx
//
// The Markdown file is the AUTHORITATIVE content source.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, PageBreak,
  BorderStyle, WidthType, ShadingType, PageNumber, TabStopType,
  TabStopPosition, ExternalHyperlink
} = require('docx');

const COLOR = {
  primary: '0B5394', primaryDark: '073763', accent: 'E67E22',
  ok: '2E7D32', warn: 'C62828', amber: 'F9A825',
  light: 'EAF1F8', grey: '4B5563', greyLight: 'D1D5DB',
};
const border = (color = COLOR.greyLight) => ({ style: BorderStyle.SINGLE, size: 4, color });
const cellBorders = { top: border(), bottom: border(), left: border(), right: border() };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
  spacing: { before: 360, after: 180 },
  children: [new TextRun({ text: t, bold: true, color: COLOR.primaryDark, size: 32 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 140 },
  children: [new TextRun({ text: t, bold: true, color: COLOR.primary, size: 26 })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3,
  spacing: { before: 220, after: 100 },
  children: [new TextRun({ text: t, bold: true, color: COLOR.grey, size: 22 })] });
const body = (t, opts={}) => new Paragraph({ spacing: { before: 60, after: 80, line: 300 },
  children: [new TextRun({ text: t, size: 22, ...opts })] });
const bullet = (t, level=0) => new Paragraph({ numbering: { reference: 'bullets', level },
  spacing: { before: 40, after: 40, line: 280 },
  children: typeof t === 'string' ? [new TextRun({ text: t, size: 22 })] : t });
const callout = (label, text, color=COLOR.accent) => new Paragraph({
  spacing: { before: 100, after: 100 },
  shading: { fill: COLOR.light, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 24, color, space: 8 } },
  children: [ new TextRun({ text: label + ': ', bold: true, color, size: 22 }),
              new TextRun({ text, size: 22 }) ] });

function buildTable(headers, rows, columnWidths) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({ tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: cellBorders, width: { size: columnWidths[i], type: WidthType.DXA },
      shading: { fill: COLOR.primaryDark, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20 })] })],
    })),
  });
  const dataRows = rows.map((row, rowIdx) => new TableRow({
    children: row.map((cell, i) => {
      const isString = typeof cell === 'string';
      const text = isString ? cell : cell.text;
      const fill = !isString && cell.fill ? cell.fill : (rowIdx % 2 === 0 ? 'F8FAFC' : 'FFFFFF');
      const fontColor = !isString && cell.color ? cell.color : '000000';
      const bold = !isString && cell.bold;
      return new TableCell({
        borders: cellBorders, width: { size: columnWidths[i], type: WidthType.DXA },
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text, size: 20, color: fontColor, bold: !!bold })] })],
      });
    }),
  }));
  return new Table({ width: { size: totalWidth, type: WidthType.DXA }, columnWidths, rows: [headerRow, ...dataRows] });
}

const children = [];

// COVER
children.push(
  new Paragraph({ spacing: { before: 1800, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'ALFANUMRIK', bold: true, size: 96, color: COLOR.primaryDark })] }),
  new Paragraph({ spacing: { before: 0, after: 80 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Adaptive Learning OS for CBSE', size: 32, color: COLOR.primary })] }),
  new Paragraph({ spacing: { before: 0, after: 600 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Grades 6–12  ·  NCERT-aligned  ·  AI-powered', italics: true, size: 22, color: COLOR.grey })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: 'DEVELOPER DOCKET', bold: true, size: 44 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: 'Platform Audit · Global Benchmarks · Prioritized Backlog · 90-Day Roadmap', size: 22, color: COLOR.grey })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 40 },
    children: [new TextRun({ text: 'Prepared for: Alfanumrik Engineering Team', size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
    children: [new TextRun({ text: 'Issued by: Office of the CEO  ·  Pradeep Sharma', size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
    children: [new TextRun({ text: 'Cusiosense Learning India Pvt. Ltd.  ·  Startup India Recognised', size: 22 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 },
    children: [new TextRun({ text: 'Document version: 1.0  ·  Date: 16 May 2026', italics: true, size: 22, color: COLOR.grey })] }),
);

// NOTE: For brevity in this regenerator script, body content is pulled from companion .md.
// Read Alfanumrik_Developer_Docket.md, OR use this script as scaffold and paste full content.
// The companion Markdown file is the authoritative content reference.

children.push(H1('Notice'));
children.push(body('This file is a regenerator scaffold. The authoritative content lives in Alfanumrik_Developer_Docket.md (same folder). To generate the styled .docx, port each section from the .md file into the children[] array above using the H1/H2/H3/body/bullet/buildTable helpers, then run:'));
children.push(body('  npm install -g docx'));
children.push(body('  node build_docket.js Alfanumrik_Developer_Docket.docx'));
children.push(body('The Markdown version is print-ready and team-readable as-is.'));

const doc = new Document({
  creator: 'Alfanumrik · Office of the CEO',
  title: 'Alfanumrik Developer Docket — May 2026',
  description: 'Platform Audit, Global Market Research, Prioritized Backlog and 90-Day Roadmap',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: COLOR.primaryDark },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: COLOR.primary },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: COLOR.grey },
        paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 },
      margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    headers: { default: new Header({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 10080 }],
      children: [
        new TextRun({ text: 'ALFANUMRIK · Developer Docket', bold: true, size: 18, color: COLOR.primary }),
        new TextRun({ text: '\tv1.0  ·  16 May 2026', size: 18, color: COLOR.grey }),
      ],
    })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Page ', size: 18, color: COLOR.grey }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: COLOR.grey }),
        new TextRun({ text: '  ·  Cusiosense Learning India Pvt. Ltd.  ·  Confidential', size: 18, color: COLOR.grey }),
      ],
    })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = process.argv[2] || 'Alfanumrik_Developer_Docket.docx';
  fs.writeFileSync(out, buf);
  console.log('Wrote ' + out + ' — ' + buf.length + ' bytes');
});
