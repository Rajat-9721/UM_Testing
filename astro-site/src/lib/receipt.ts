// Fee receipt PDF — built to match the official SPIT "Payment Receipt"
// template (client-supplied image) as closely as jsPDF's drawing
// primitives allow: double-line outer border, logo + institute header,
// "PAYMENT RECEIPT" banner, a two-column field block, a bordered
// particulars-of-fees table with a Total row, and an Amount in Words
// line. Only the dynamic data changes — the layout itself is not a
// redesign, it's a reproduction of the supplied template.
//
// Two deliberate departures from the original blank template, per
// client direction after seeing the first generated receipt: the
// separate "Student PRN" field was dropped in favour of a single
// "Roll No. (UID)" field (profiles/enrollment student_id, now in the
// {year}{course code}-{sequence} format — see phase3_fee_receipts.sql
// section 4), and Payment Mode / Transaction ID were added since the
// original template had no way to show how a payment was made.
//
// NOTE: built without the ability to render/inspect the PDF visually
// in this environment — coordinates are a best-effort match to the
// reference image's proportions. Treat spacing as a first pass; flag
// anything that needs nudging once it's been seen on a real printout.

import { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { amountToWords } from './numberToWords';
import spitLogoUrl from '../assets/brand/spit-logo.png?url';

export interface FeeParticular {
  particular: string;
  amount: number;
}

interface ReceiptRow {
  payment_id: string;
  receipt_number: string;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  student_name: string | null;
  student_code: string | null; // shown as "Roll No. (UID)" — the one unique student identifier
  student_email: string | null;
  student_phone: string | null;
  program_title: string | null;
  amount: number;
  academic_year: string | null;
  financial_year: string | null;
  fee_particulars: FeeParticular[] | null;
}

function methodLabel(method: string): string {
  return ({
    cash: 'Cash',
    upi: 'UPI',
    netbanking: 'Net Banking',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
  } as Record<string, string>)[method] || method;
}

async function fetchReceiptData(paymentId: string): Promise<ReceiptRow> {
  const { data, error } = await supabase
    .from('payment_receipts')
    .select('*')
    .eq('payment_id', paymentId)
    .single();

  if (error || !data) {
    throw new Error(error ? error.message : 'Receipt not found.');
  }
  return data as ReceiptRow;
}

let logoDataUrlPromise: Promise<string | null> | null = null;
function getLogoDataUrl(): Promise<string | null> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(spitLogoUrl)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .catch(() => null);
  }
  return logoDataUrlPromise;
}

function formatReceiptDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, ' ');
}

function formatMoney(n: number): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function renderReceiptPdf(data: ReceiptRow): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = 595.28;
  const margin = 32;

  // ---- Outer double-line border ----
  doc.setDrawColor(20, 30, 60);
  doc.setLineWidth(1.2);
  doc.rect(margin, margin, pageW - margin * 2, 778);
  doc.setLineWidth(0.6);
  doc.rect(margin + 4, margin + 4, pageW - margin * 2 - 8, 770);

  const left = margin + 16;
  const right = pageW - margin - 16;
  const contentW = right - left;

  // ---- Header box: logo cell | institute text cell ----
  let y = margin + 20;
  const headerH = 96;
  doc.setLineWidth(0.75);
  doc.rect(left, y, contentW, headerH);
  const logoColW = 120;
  doc.line(left + logoColW, y, left + logoColW, y + headerH);

  const logoDataUrl = await getLogoDataUrl();
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', left + (logoColW - 76) / 2, y + (headerH - 76) / 2, 76, 76);
    } catch {
      // If the logo can't be embedded for any reason, the header text
      // alone still renders — never let a PDF fail over the logo.
    }
  }

  const textCenterX = left + logoColW + (contentW - logoColW) / 2;
  doc.setFont('times', 'normal');
  doc.setFontSize(13);
  doc.text("Bharatiya Vidhya Bhavan's", textCenterX, y + 28, { align: 'center' });
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text('Sardar Patel Institute of Technology', textCenterX, y + 54, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.text('Munshi Nagar, Andheri (West), Mumbai 400 058', textCenterX, y + 76, { align: 'center' });

  y += headerH + 22;

  // ---- "PAYMENT RECEIPT" banner ----
  const bannerW = 260;
  const bannerH = 26;
  const bannerX = left + (contentW - bannerW) / 2;
  doc.setFillColor(222, 233, 246);
  doc.setDrawColor(20, 30, 60);
  doc.setLineWidth(0.75);
  doc.rect(bannerX, y, bannerW, bannerH, 'FD');
  doc.setFont('times', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(20, 30, 60);
  doc.text('PAYMENT RECEIPT', bannerX + bannerW / 2, y + bannerH / 2 + 5, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  y += bannerH + 26;

  // ---- Two-column field block ----
  const colGap = 24;
  const leftColX = left;
  const rightColX = left + contentW / 2 + colGap / 2;
  const rowH = 22;
  const labelFont = 11;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelFont);

  // maxW clips (never wraps) a value so a long name/email on the left
  // column can never run into the right column's text on the same row.
  function field(x: number, rowY: number, label: string, value: string, labelW: number, maxW?: number) {
    doc.setFont('helvetica', 'bold');
    doc.text(label, x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(':', x + labelW, rowY);
    let text = value || '-';
    if (maxW) {
      const lines = doc.splitTextToSize(text, maxW);
      text = lines[0] + (lines.length > 1 ? '…' : '');
    }
    doc.text(text, x + labelW + 10, rowY);
  }

  const leftLabelW = 92;
  const rightLabelW = 95;
  const leftValueMaxW = rightColX - (leftColX + leftLabelW + 10) - 10;

  field(leftColX, y, 'Receipt No.', data.receipt_number, leftLabelW, leftValueMaxW);
  field(rightColX, y, 'Receipt Date', formatReceiptDate(data.payment_date), rightLabelW);

  field(leftColX, y + rowH, 'Student Name', data.student_name || '-', leftLabelW, leftValueMaxW);
  field(rightColX, y + rowH, 'Roll No. (UID)', data.student_code || '-', rightLabelW);

  field(leftColX, y + rowH * 2, 'Email Id', data.student_email || '-', leftLabelW, leftValueMaxW);
  field(rightColX, y + rowH * 2, 'Financial Year', data.financial_year || '-', rightLabelW);

  field(leftColX, y + rowH * 3, 'Academic Year', data.academic_year || '-', leftLabelW, leftValueMaxW);
  field(rightColX, y + rowH * 3, 'Mobile', data.student_phone || '-', rightLabelW);

  field(rightColX, y + rowH * 4, 'Payment Mode', methodLabel(data.payment_method), rightLabelW);
  field(rightColX, y + rowH * 5, 'Transaction ID', data.reference_number || '-', rightLabelW);

  // Program Name gets its own full-width row below the two columns —
  // it's routinely the longest value on the receipt (e.g. "Professional
  // Certification in Artificial Intelligence"), so it's never safe to
  // share a row with anything on the right.
  const programRowY = y + rowH * 6;
  field(leftColX, programRowY, 'Program Name', data.program_title || '-', leftLabelW, contentW - leftLabelW - 10);

  y = programRowY + rowH + 10;

  // ---- Particulars of Fees table ----
  const srColW = 46;
  const amtColW = 110;
  const particularColW = contentW - srColW - amtColW;
  const tableRowH = 24;
  const tableHeaderH = 24;

  doc.setDrawColor(20, 30, 60);
  doc.setLineWidth(0.75);
  doc.setFillColor(222, 233, 246);
  doc.rect(left, y, contentW, tableHeaderH, 'FD');
  doc.line(left + srColW, y, left + srColW, y + tableHeaderH);
  doc.line(left + srColW + particularColW, y, left + srColW + particularColW, y + tableHeaderH);

  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('Sr.No', left + srColW / 2, y + tableHeaderH / 2 + 4, { align: 'center' });
  doc.text('Particulars of the Fees', left + srColW + particularColW / 2, y + tableHeaderH / 2 + 4, { align: 'center' });
  doc.text('Amount (Rs.)', left + srColW + particularColW + amtColW / 2, y + tableHeaderH / 2 + 4, { align: 'center' });

  y += tableHeaderH;

  const particulars: FeeParticular[] = data.fee_particulars && data.fee_particulars.length
    ? data.fee_particulars
    : [{ particular: 'Tuition Fees', amount: data.amount }];

  const rowCount = Math.max(particulars.length, 5);
  doc.setFont('times', 'normal');
  doc.setFontSize(11);

  for (let i = 0; i < rowCount; i++) {
    doc.rect(left, y, contentW, tableRowH);
    doc.line(left + srColW, y, left + srColW, y + tableRowH);
    doc.line(left + srColW + particularColW, y, left + srColW + particularColW, y + tableRowH);

    doc.text(String(i + 1), left + srColW / 2, y + tableRowH / 2 + 4, { align: 'center' });

    const item = particulars[i];
    if (item) {
      doc.text(item.particular, left + srColW + 8, y + tableRowH / 2 + 4);
      doc.text(formatMoney(item.amount), left + srColW + particularColW + amtColW - 8, y + tableRowH / 2 + 4, { align: 'right' });
    }
    y += tableRowH;
  }

  // Total row
  doc.rect(left, y, contentW, tableRowH);
  doc.line(left + srColW + particularColW, y, left + srColW + particularColW, y + tableRowH);
  doc.setFont('times', 'bold');
  doc.text('Total:', left + srColW + particularColW - 8, y + tableRowH / 2 + 4, { align: 'right' });
  doc.text(formatMoney(data.amount), left + srColW + particularColW + amtColW - 8, y + tableRowH / 2 + 4, { align: 'right' });
  y += tableRowH + 28;

  // ---- Amount in Words ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Amount in Words :', left, y);
  doc.setFont('helvetica', 'normal');
  const wordsText = amountToWords(data.amount);
  const wrapped = doc.splitTextToSize(wordsText, contentW - 130);
  doc.text(wrapped, left + 128, y);

  y += 22 * Math.max(wrapped.length, 1);

  // ---- Disclaimer ----
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9.5);
  doc.text('*This is a computer generated receipt and does not require signature or stamp.', left, y);

  return doc;
}

async function buildReceiptDocForPayment(paymentId: string): Promise<{ doc: jsPDF; data: ReceiptRow }> {
  const data = await fetchReceiptData(paymentId);
  const doc = await renderReceiptPdf(data);
  return { doc, data };
}

export async function downloadReceipt(paymentId: string) {
  const { doc, data } = await buildReceiptDocForPayment(paymentId);
  doc.save(`${data.receipt_number}.pdf`);
}

export async function viewReceipt(paymentId: string) {
  const { doc } = await buildReceiptDocForPayment(paymentId);
  window.open(doc.output('bloburl'), '_blank');
}

export async function printReceipt(paymentId: string) {
  const { doc } = await buildReceiptDocForPayment(paymentId);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}
