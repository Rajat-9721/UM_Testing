// RDoc → PDF with jsPDF, drawn as real text (never an image) so ATS
// software can read it. Sizes mirror resume-templates.css (1px = 0.75pt).
// jsPDF is loaded only when a student downloads.

import type { RBlock, RDoc, RLink, RSection } from './model';

type RGB = [number, number, number];

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: RGB;
  url?: string;
}

interface Column {
  x: number;
  w: number;
  page: number;
  y: number;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 45;
const MARGIN_Y = 42;
const INK: RGB = [31, 35, 40];
const MUTED: RGB = [85, 91, 99];
const SEP: RGB = [160, 164, 170];

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// jsPDF's built-in fonts cover Windows-1252 only. Map the common extras
// and drop anything else rather than printing garbage.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
function pdfSafe(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/₹/g, 'Rs. ')
    .replace(/[‐-‒]/g, '-')
    .replace(/ /g, ' ')
    .split('')
    .filter((ch) => ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch))
    .join('');
}

export async function buildResumePdf(rdoc: RDoc): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const { cfg } = rdoc;
  const family = cfg.font === 'serif' ? 'times' : 'helvetica';
  const accent = hexToRgb(cfg.accent);
  const contentW = PAGE_W - MARGIN_X * 2;
  const bottom = PAGE_H - MARGIN_Y;

  pdf.setProperties({ title: `${rdoc.name || 'Resume'} — Resume`, creator: 'Utkarsh Minds Resume Generator' });

  const style = (run: Run, size: number) => {
    pdf.setFont(family, run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...(run.color ?? INK));
  };

  const goTo = (col: Column) => {
    while (pdf.getNumberOfPages() < col.page) pdf.addPage();
    pdf.setPage(col.page);
  };

  /** Moves to the next page when `h` points won't fit in the column. */
  const ensure = (col: Column, h: number) => {
    if (col.y + h > bottom) {
      col.page += 1;
      col.y = MARGIN_Y;
    }
    goTo(col);
  };

  // ---- word-wrapping rich text ----
  type Seg = Run & { width: number };
  const wrap = (runs: Run[], size: number, width: number): Seg[][] => {
    const lines: Seg[][] = [[]];
    let lineW = 0;
    const push = (seg: Seg) => {
      lines[lines.length - 1].push(seg);
      lineW += seg.width;
    };
    for (const run of runs) {
      style(run, size);
      for (const token of pdfSafe(run.text).split(/(\s+)/)) {
        if (!token) continue;
        const space = /^\s+$/.test(token);
        const text = space ? ' ' : token;
        let w = pdf.getTextWidth(text);
        if (space) {
          if (lineW > 0) push({ ...run, text, width: w });
          continue;
        }
        if (lineW + w > width && lineW > 0) {
          const line = lines[lines.length - 1];
          while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
          lines.push([]);
          lineW = 0;
        }
        // A single word wider than the line (long URLs): hard-split it.
        let rest = text;
        while (w > width && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && pdf.getTextWidth(rest.slice(0, cut)) > width - lineW) cut--;
          push({ ...run, text: rest.slice(0, cut), width: pdf.getTextWidth(rest.slice(0, cut)) });
          lines.push([]);
          lineW = 0;
          rest = rest.slice(cut);
          w = pdf.getTextWidth(rest);
        }
        push({ ...run, text: rest, width: w });
      }
    }
    return lines.filter((l) => l.length);
  };

  const lineWidth = (line: Seg[]) => line.reduce((n, s) => n + s.width, 0);

  /** Draws wrapped runs; returns nothing, advances col.y. */
  const drawRuns = (
    col: Column,
    runs: Run[],
    size: number,
    opts: { indent?: number; align?: 'left' | 'center'; bullet?: boolean; lead?: number; after?: number } = {},
  ) => {
    const indent = opts.indent ?? 0;
    const lh = size * (opts.lead ?? 1.38);
    const lines = wrap(runs, size, col.w - indent);
    lines.forEach((line, i) => {
      ensure(col, lh);
      const baseline = col.y + size * 0.82;
      let x = col.x + indent;
      if (opts.align === 'center') x = col.x + (col.w - lineWidth(line)) / 2;
      if (opts.bullet && i === 0) {
        style({ text: '' }, size);
        pdf.text('•', col.x + indent - 9, baseline);
      }
      for (const seg of line) {
        style(seg, size);
        pdf.text(seg.text, x, baseline);
        if (seg.url && seg.text.trim()) pdf.link(x, baseline - size * 0.8, seg.width, size, { url: seg.url });
        x += seg.width;
      }
      col.y += lh;
    });
    col.y += opts.after ?? 0;
  };

  const linkRuns = (links: RLink[], color: RGB): Run[] =>
    links.flatMap((l, i) => [...(i ? [{ text: ' | ', color: SEP }] : []), { text: l.text, color, url: l.url }]);

  // ---- section heading styles (mirror .rs--h-*) ----
  const heading = (col: Column, title: string) => {
    const caps = cfg.headingStyle === 'rule' || cfg.headingStyle === 'caps';
    const size = cfg.headingStyle === 'rule' ? 10.1 : cfg.headingStyle === 'caps' ? 9.75 : 11.25;
    ensure(col, size * 1.4 + 6 + 3 * 10.5 * 1.38); // keep heading with its first lines
    const text = pdfSafe(caps ? title.toUpperCase() : title);
    pdf.setFont(family, 'bold');
    pdf.setFontSize(size);
    pdf.setTextColor(...accent);
    pdf.setCharSpace(caps ? size * 0.08 : 0);
    const baseline = col.y + size * 0.82;
    const textX = cfg.headingStyle === 'bar' ? col.x + 9 : col.x;
    pdf.text(text, textX, baseline);
    const w = pdf.getTextWidth(text) + (caps ? text.length * size * 0.08 : 0);
    pdf.setCharSpace(0);
    pdf.setDrawColor(...accent);
    pdf.setFillColor(...accent);
    if (cfg.headingStyle === 'rule') {
      pdf.setLineWidth(0.9);
      pdf.line(col.x, baseline + 4, col.x + col.w, baseline + 4);
      col.y += size * 1.3 + 7;
    } else if (cfg.headingStyle === 'underline') {
      pdf.setLineWidth(1.5);
      pdf.line(col.x, baseline + 3, col.x + w, baseline + 3);
      col.y += size * 1.3 + 7;
    } else if (cfg.headingStyle === 'bar') {
      pdf.rect(col.x, col.y, 2.25, size * 1.15, 'F');
      col.y += size * 1.3 + 6;
    } else {
      col.y += size * 1.3 + 5;
    }
  };

  const block = (col: Column, b: RBlock, narrow: boolean) => {
    switch (b.type) {
      case 'text':
        drawRuns(col, [{ text: b.text }], 10.5);
        break;
      case 'bullets':
        b.items.forEach((item) => drawRuns(col, [{ text: item }], 10.1, { indent: 13, bullet: true, lead: 1.35 }));
        break;
      case 'skills':
        if (b.inline) {
          drawRuns(col, [{ text: b.groups.flatMap((g) => g.items).join(' · ') }], 10.1);
        } else {
          b.groups.forEach((g) => {
            if (narrow) {
              drawRuns(col, [{ text: g.label, bold: true }], 10.1);
              drawRuns(col, [{ text: g.items.join(', ') }], 10.1, { after: 4 });
            } else {
              drawRuns(col, [{ text: `${g.label}: `, bold: true }, { text: g.items.join(', ') }], 10.1, { after: 1.5 });
            }
          });
        }
        break;
      case 'entry': {
        const size = 10.5;
        const metaSize = 9.4;
        const lh = size * 1.38;
        ensure(col, lh * 2);
        if (b.meta && !narrow) {
          // Heading on the left, dates right-aligned on the same line.
          pdf.setFont(family, 'normal');
          pdf.setFontSize(metaSize);
          const meta = pdfSafe(b.meta);
          const metaW = pdf.getTextWidth(meta);
          // ensure() above guarantees the first line fits on this page.
          const startY = col.y;
          const startPage = col.page;
          const headCol: Column = { ...col, w: col.w - metaW - 12 };
          drawRuns(headCol, [{ text: b.heading, bold: true }], size);
          pdf.setPage(startPage);
          style({ text: '', color: MUTED }, metaSize);
          pdf.text(meta, col.x + col.w - metaW, startY + size * 0.82);
          col.page = headCol.page;
          col.y = headCol.y;
          goTo(col);
        } else {
          drawRuns(col, [{ text: b.heading, bold: true }], size);
          if (b.meta) drawRuns(col, [{ text: b.meta, color: MUTED }], metaSize);
        }
        if (b.subheading) drawRuns(col, [{ text: b.subheading, italic: true, color: MUTED }], 9.75);
        if (b.links?.length) drawRuns(col, linkRuns(b.links, MUTED), 9.4);
        if (b.text) drawRuns(col, [{ text: b.text }], 10.5);
        b.bullets.forEach((item) => drawRuns(col, [{ text: item }], 10.1, { indent: 13, bullet: true, lead: 1.35 }));
        col.y += 7;
        break;
      }
    }
  };

  const section = (col: Column, s: RSection, first: boolean, narrow = false) => {
    if (!first) col.y += 8;
    heading(col, s.title);
    s.blocks.forEach((b) => block(col, b, narrow));
  };

  // ---- header (full width) ----
  const head: Column = { x: MARGIN_X, w: contentW, page: 1, y: MARGIN_Y };
  goTo(head);
  const align = cfg.headerAlign === 'center' ? 'center' : 'left';
  if (rdoc.name) {
    const nameSize = cfg.nameUppercase ? 20.25 : 22.5;
    const name = cfg.nameUppercase ? rdoc.name.toUpperCase() : rdoc.name;
    if (cfg.nameUppercase) pdf.setCharSpace(nameSize * 0.06);
    drawRuns(head, [{ text: name, bold: true }], nameSize, { align, lead: 1.2 });
    pdf.setCharSpace(0);
  }
  if (rdoc.role) drawRuns(head, [{ text: rdoc.role, bold: true, color: accent }], 11.6, { align, lead: 1.5 });
  if (rdoc.contacts.length) drawRuns(head, linkRuns(rdoc.contacts, MUTED), 9.4, { align });
  head.y += 10;

  // ---- body ----
  if (cfg.layout === 'sidebar') {
    const sideW = 165;
    const gap = 19.5;
    const side: Column = { x: MARGIN_X, w: sideW - 13, page: 1, y: head.y };
    const main: Column = { x: MARGIN_X + sideW + gap, w: contentW - sideW - gap, page: 1, y: head.y };
    // Main column first so text extraction (ATS) reads it first.
    rdoc.main.forEach((s, i) => section(main, s, i === 0));
    rdoc.side.forEach((s, i) => section(side, s, i === 0, true));
    const pages = Math.max(main.page, side.page);
    for (let p = 1; p <= pages; p++) {
      pdf.setPage(p);
      pdf.setDrawColor(217, 221, 226);
      pdf.setLineWidth(0.75);
      const x = MARGIN_X + sideW - 3;
      pdf.line(x, p === 1 ? head.y : MARGIN_Y, x, bottom);
    }
  } else {
    const body: Column = { x: MARGIN_X, w: contentW, page: 1, y: head.y };
    rdoc.main.forEach((s, i) => section(body, s, i === 0));
  }

  return pdf.output('blob');
}
