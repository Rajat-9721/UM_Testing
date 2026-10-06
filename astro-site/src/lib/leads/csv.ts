// Builds a CSV file that opens cleanly in Excel / Google Sheets.
//
// Leads come from public forms, so a cell could start with "=", "+", "-"
// or "@" and be run as a formula when the file is opened (e.g.
// =HYPERLINK(...)). Such cells get a leading apostrophe so Excel shows
// them as plain text.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  // The BOM makes Excel read the file as UTF-8, so names in Hindi,
  // Marathi etc. aren't garbled.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
