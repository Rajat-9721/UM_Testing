// RDoc → DOCX with the `docx` library (loaded only on download). Uses the
// same template settings as the preview and PDF: fonts, accent colour,
// heading style, section order and the two-column sidebar (a borderless
// two-cell table, which Word and ATS parsers read left-to-right).

import type { RBlock, RDoc, RLink, RSection } from './model';

const TWIP = 20; // twips per point
const PAGE_W = 11906; // A4
const MARGIN_X = 45 * TWIP;
const MARGIN_Y = 42 * TWIP;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const MUTED = '555B63';
const SEP = 'A0A4AA';

export async function buildResumeDocx(rdoc: RDoc): Promise<Blob> {
  const d = await import('docx');
  const { cfg } = rdoc;
  const font = cfg.font === 'serif' ? 'Georgia' : 'Calibri';
  const accent = cfg.accent.replace('#', '').toUpperCase();
  const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points

  const run = (text: string, o: { bold?: boolean; italic?: boolean; color?: string; size?: number; caps?: boolean; spacing?: number } = {}) =>
    new d.TextRun({ text, font, bold: o.bold, italics: o.italic, color: o.color, size: pt(o.size ?? 10.5), allCaps: o.caps, characterSpacing: o.spacing });

  const linkRuns = (links: RLink[], size: number) =>
    links.flatMap((l, i) => {
      const parts: any[] = [];
      if (i) parts.push(run(' | ', { color: SEP, size }));
      parts.push(l.url ? new d.ExternalHyperlink({ link: l.url, children: [run(l.text, { color: MUTED, size })] }) : run(l.text, { color: MUTED, size }));
      return parts;
    });

  const para = (children: any[], o: { after?: number; before?: number; align?: 'left' | 'center'; indentLeft?: number; tabRight?: number } = {}) =>
    new d.Paragraph({
      children,
      alignment: o.align === 'center' ? d.AlignmentType.CENTER : d.AlignmentType.LEFT,
      spacing: { before: (o.before ?? 0) * TWIP, after: (o.after ?? 0) * TWIP, line: 264 },
      indent: o.indentLeft ? { left: o.indentLeft } : undefined,
      tabStops: o.tabRight ? [{ type: d.TabStopType.RIGHT, position: o.tabRight }] : undefined,
    });

  const heading = (title: string) => {
    const caps = cfg.headingStyle === 'rule' || cfg.headingStyle === 'caps';
    const size = cfg.headingStyle === 'rule' ? 10.1 : cfg.headingStyle === 'caps' ? 9.75 : 11.25;
    const border =
      cfg.headingStyle === 'rule'
        ? { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: accent, space: 2 } }
        : cfg.headingStyle === 'bar'
          ? { left: { style: d.BorderStyle.SINGLE, size: 18, color: accent, space: 6 } }
          : undefined;
    return new d.Paragraph({
      keepNext: true,
      border,
      spacing: { before: 10 * TWIP, after: 5 * TWIP },
      children: [
        new d.TextRun({
          text: title,
          font,
          bold: true,
          color: accent,
          size: pt(size),
          allCaps: caps,
          characterSpacing: caps ? 16 : undefined,
          underline: cfg.headingStyle === 'underline' ? { type: d.UnderlineType.SINGLE, color: accent } : undefined,
        }),
      ],
    });
  };

  const bullet = (text: string) =>
    new d.Paragraph({
      numbering: { reference: 'rs-bullets', level: 0 },
      spacing: { after: 1 * TWIP, line: 259 },
      children: [run(text, { size: 10.1 })],
    });

  const block = (b: RBlock, width: number, narrow: boolean): any[] => {
    switch (b.type) {
      case 'text':
        return [para([run(b.text)], { after: 2 })];
      case 'bullets':
        return b.items.map(bullet);
      case 'skills':
        if (b.inline) return [para([run(b.groups.flatMap((g) => g.items).join(' · '), { size: 10.1 })], { after: 2 })];
        return b.groups.flatMap((g) =>
          narrow
            ? [para([run(g.label, { bold: true, size: 10.1 })]), para([run(g.items.join(', '), { size: 10.1 })], { after: 4 })]
            : [para([run(`${g.label}: `, { bold: true, size: 10.1 }), run(g.items.join(', '), { size: 10.1 })], { after: 1.5 })],
        );
      case 'entry': {
        const out: any[] = [];
        if (b.meta && !narrow) {
          out.push(para([run(b.heading, { bold: true }), new d.TextRun({ text: '\t', font }), run(b.meta, { color: MUTED, size: 9.4 })], { tabRight: width }));
        } else {
          out.push(para([run(b.heading, { bold: true })]));
          if (b.meta) out.push(para([run(b.meta, { color: MUTED, size: 9.4 })]));
        }
        if (b.subheading) out.push(para([run(b.subheading, { italic: true, color: MUTED, size: 9.75 })]));
        if (b.links?.length) out.push(para(linkRuns(b.links, 9.4)));
        if (b.text) out.push(para([run(b.text)]));
        out.push(...b.bullets.map(bullet));
        out.push(para([], { after: 3 }));
        return out;
      }
    }
  };

  const sections = (list: RSection[], width: number, narrow = false) =>
    list.flatMap((s) => [heading(s.title), ...s.blocks.flatMap((b) => block(b, width, narrow))]);

  // ---- header ----
  const align = cfg.headerAlign === 'center' ? 'center' : 'left';
  const header: any[] = [];
  if (rdoc.name) {
    header.push(para([run(rdoc.name, { bold: true, size: cfg.nameUppercase ? 20.25 : 22.5, caps: cfg.nameUppercase, spacing: cfg.nameUppercase ? 24 : undefined })], { align, after: 2 }));
  }
  if (rdoc.role) header.push(para([run(rdoc.role, { bold: true, color: accent, size: 11.6 })], { align, after: 2 }));
  if (rdoc.contacts.length) header.push(para(linkRuns(rdoc.contacts, 9.4), { align, after: 8 }));

  // ---- body ----
  let body: any[];
  if (cfg.layout === 'sidebar') {
    const sideW = 165 * TWIP;
    const mainW = CONTENT_W - sideW;
    const none = { style: d.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const cell = (children: any[], width: number, rightBorder: boolean) =>
      new d.TableCell({
        width: { size: width, type: d.WidthType.DXA },
        borders: { top: none, bottom: none, left: none, right: rightBorder ? { style: d.BorderStyle.SINGLE, size: 4, color: 'D9DDE2' } : none },
        margins: { left: rightBorder ? 0 : 390, right: rightBorder ? 260 : 0 },
        children: children.length ? children : [para([])],
      });
    body = [
      new d.Table({
        width: { size: CONTENT_W, type: d.WidthType.DXA },
        columnWidths: [sideW, mainW],
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [
          new d.TableRow({
            children: [cell(sections(rdoc.side, sideW - 260, true), sideW, true), cell(sections(rdoc.main, mainW - 390), mainW, false)],
          }),
        ],
      }),
    ];
  } else {
    body = sections(rdoc.main, CONTENT_W);
  }

  const doc = new d.Document({
    creator: 'Utkarsh Minds Resume Generator',
    title: `${rdoc.name || 'Resume'} — Resume`,
    styles: { default: { document: { run: { font, size: pt(10.5), color: '1F2328' } } } },
    numbering: {
      config: [
        {
          reference: 'rs-bullets',
          levels: [{ level: 0, format: d.LevelFormat.BULLET, text: '•', alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 260, hanging: 180 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: MARGIN_X, right: MARGIN_X } } },
        children: [...header, ...body],
      },
    ],
  });
  return d.Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function resumeFileName(name: string, ext: 'pdf' | 'docx') {
  const base = (name || 'Resume').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Resume';
  return `${base}.${ext}`;
}
