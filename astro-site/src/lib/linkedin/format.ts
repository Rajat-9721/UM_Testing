// Bold text for LinkedIn posts.
//
// LinkedIn has no rich-text formatting, so posts that show bold text use
// Unicode "Mathematical Sans-Serif Bold" letters (𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀). Inside the
// app, post content keeps plain **double-asterisk** markers — easy to
// edit and to store — and is converted:
//   - to real <strong> elements when shown on the page, and
//   - to Unicode bold when copied or shared to LinkedIn.
// Only A–Z, a–z and 0–9 have bold forms; everything else (punctuation,
// emoji, Devanagari) passes through unchanged.

const BOLD_MARK = /\*\*([^*\n]+?)\*\*/g;

function boldChar(ch: string): string {
  const code = ch.codePointAt(0)!;
  if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + (code - 65)); // A–Z
  if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + (code - 97)); // a–z
  if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ec + (code - 48)); // 0–9
  return ch;
}

export function toUnicodeBold(text: string): string {
  return Array.from(text, boldChar).join('');
}

/** Removes any ** left unmatched (e.g. after truncation) so they never leak. */
function stripStrayMarks(text: string): string {
  return text.replace(/\*\*/g, '');
}

/** Post content as it should be pasted into LinkedIn. */
export function toLinkedInText(content: string): string {
  return stripStrayMarks(content.replace(BOLD_MARK, (_, inner: string) => toUnicodeBold(inner)));
}

/** Plain text without formatting markers (for search, previews, etc.). */
export function toPlainText(content: string): string {
  return stripStrayMarks(content.replace(BOLD_MARK, '$1'));
}

/** Characters as LinkedIn counts them (code points, so bold letters count once). */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/**
 * Appends `content` to `target` as text nodes and <strong> elements.
 * Never uses innerHTML, so user/AI text can't inject markup.
 */
export function appendRichText(target: HTMLElement, content: string): void {
  let last = 0;
  for (const match of content.matchAll(BOLD_MARK)) {
    const index = match.index ?? 0;
    if (index > last) target.append(document.createTextNode(stripStrayMarks(content.slice(last, index))));
    const strong = document.createElement('strong');
    strong.textContent = match[1];
    target.append(strong);
    last = index + match[0].length;
  }
  if (last < content.length) target.append(document.createTextNode(stripStrayMarks(content.slice(last))));
}

/**
 * Wraps the textarea's selection in ** markers, or removes them if the
 * selection is already bold. Returns true if the text changed.
 */
export function toggleBoldSelection(area: HTMLTextAreaElement): boolean {
  const { selectionStart: start, selectionEnd: end, value } = area;
  if (start === end) return false;

  // Keep surrounding spaces outside the markers ("** word**" wouldn't render).
  let s = start;
  let e = end;
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;
  if (s === e) return false;

  const selected = value.slice(s, e);
  const before = value.slice(0, s);
  const after = value.slice(e);

  let next: string;
  let selStart: number;
  let selEnd: number;
  if (before.endsWith('**') && after.startsWith('**')) {
    next = before.slice(0, -2) + selected + after.slice(2);
    selStart = s - 2;
    selEnd = e - 2;
  } else if (/^\*\*[\s\S]+\*\*$/.test(selected)) {
    const inner = selected.slice(2, -2);
    next = before + inner + after;
    selStart = s;
    selEnd = s + inner.length;
  } else {
    // Bold each line separately so markers never span a line break.
    const wrapped = selected
      .split('\n')
      .map((line) => (line.trim() ? `**${line.replace(/\*\*/g, '')}**` : line))
      .join('\n');
    next = before + wrapped + after;
    selStart = s;
    selEnd = s + wrapped.length;
  }

  area.value = next;
  area.setSelectionRange(selStart, selEnd);
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
