// Converts a rupee amount into words, Indian numbering system
// (thousand / lakh / crore), matching how amounts are conventionally
// written on Indian fee receipts — e.g. 19500 -> "Nineteen Thousand
// Five Hundred Rupees Only".

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ' ' + ONES[ones] : '');
}

function threeDigits(n: number): string {
  let out = '';
  if (n >= 100) {
    out += ONES[Math.floor(n / 100)] + ' Hundred';
    n = n % 100;
    if (n) out += ' ';
  }
  if (n) out += twoDigits(n);
  return out;
}

function integerToWordsIndian(value: number): string {
  if (value === 0) return 'Zero';

  let n = Math.floor(value);
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(' ');
}

export function amountToWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  let words = integerToWordsIndian(rupees) + ' Rupees';
  if (paise > 0) {
    words += ' and ' + integerToWordsIndian(paise) + ' Paise';
  }
  return words + ' Only';
}
