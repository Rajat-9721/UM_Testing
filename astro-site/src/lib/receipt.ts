// Client-side receipt PDF generation.
//
// Data is fetched fresh from Supabase (the `payment_receipts` view —
// authoritative, derived from real payment rows) every time a receipt
// is downloaded; nothing here is a static/fake template. Rendering is
// deliberately a pure function of that data, separate from the fetch,
// so the layout can be swapped for the official Utkarsh Minds receipt
// design later without touching data-fetching or auth logic.
//
// The original architecture plan called for a Supabase Edge Function
// to do this server-side; that was adjusted for Phase 1 because no
// Supabase CLI/deploy tooling is available in this environment. The
// data model (the payment_receipts view) is unchanged either way, so
// moving generation server-side later is a template/transport swap,
// not a redesign.

import { jsPDF } from 'jspdf';
import { supabase } from './supabase';

interface ReceiptRow {
  receipt_number: string;
  payment_date: string;
  student_code: string | null;
  student_name: string | null;
  program_title: string | null;
  amount: number;
  payment_method: string;
  reference_number: string | null;
  cheque_bank_name: string | null;
  cheque_date: string | null;
  total_fee: number;
  cumulative_paid_at_payment: number;
  balance_after_payment: number;
  status_after_payment: string;
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

function formatMoney(n: number) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodLabel(method: string) {
  return ({
    cash: 'Cash',
    upi: 'UPI',
    netbanking: 'Net Banking',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
  } as Record<string, string>)[method] || method;
}

function statusLabel(status: string) {
  return ({ PARTIALLY_PAID: 'Partially Paid', PAID: 'Paid', UNPAID: 'Unpaid' } as Record<string, string>)[status] || status;
}

// TEMPORARY receipt layout — replace this function with the official
// Utkarsh Minds format once available. Everything it needs comes in
// through `data` (one row from payment_receipts).
function renderReceiptPdf(data: ReceiptRow) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 56;
  let y = 64;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('UTKARSH MINDS', marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Empower . Educate . Innovate', marginX, y + 16);

  doc.setFontSize(9);
  doc.text('TEMPORARY RECEIPT FORMAT', 595 - marginX, y, { align: 'right' });
  doc.text('(pending official design)', 595 - marginX, y + 12, { align: 'right' });

  y += 40;
  doc.setDrawColor(180);
  doc.line(marginX, y, 595 - marginX, y);
  y += 28;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Payment Receipt', marginX, y);
  y += 26;

  const rows: [string, string][] = [
    ['Receipt No.', data.receipt_number],
    ['Payment Date', data.payment_date],
    ['Student ID', data.student_code || '-'],
    ['Student Name', data.student_name || '-'],
    ['Program', data.program_title || '-'],
    ['Amount Received', formatMoney(data.amount)],
    ['Payment Mode', methodLabel(data.payment_method)],
  ];

  if (data.reference_number) {
    rows.push(['Reference / Transaction ID', data.reference_number]);
  }
  if (data.payment_method === 'cheque') {
    rows.push(['Cheque Bank', data.cheque_bank_name || '-']);
    rows.push(['Cheque Date', data.cheque_date || '-']);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  rows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), marginX + 190, y);
    y += 20;
  });

  y += 12;
  doc.setDrawColor(180);
  doc.line(marginX, y, 595 - marginX, y);
  y += 28;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Fee Status (as of this payment)', marginX, y);
  y += 22;

  const summaryRows: [string, string][] = [
    ['Total Program Fee', formatMoney(data.total_fee)],
    ['Total Paid', formatMoney(data.cumulative_paid_at_payment)],
    ['Outstanding Balance', formatMoney(data.balance_after_payment)],
    ['Status', statusLabel(data.status_after_payment)],
  ];

  doc.setFontSize(11);
  summaryRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), marginX + 190, y);
    y += 20;
  });

  y += 30;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'This is a system-generated receipt reflecting authoritative payment records at the time of',
    marginX, y
  );
  doc.text(
    'generation. Format will be replaced with the official Utkarsh Minds receipt design.',
    marginX, y + 11
  );

  return doc;
}

export async function downloadReceipt(paymentId: string) {
  const data = await fetchReceiptData(paymentId);
  const doc = renderReceiptPdf(data);
  doc.save(`${data.receipt_number}.pdf`);
}
