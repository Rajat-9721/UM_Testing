// Small DOM helpers shared by the Resume Generator and My Resumes pages.
// All text goes through textContent / value — never innerHTML.

import { autocorrectText } from './autocorrect';
import type { SpellMode } from './spell';

type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string | boolean | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: any) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  for (const [evt, fn] of Object.entries(props.on ?? {})) node.addEventListener(evt, fn as EventListener);
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

let idSeq = 0;
export const nextId = (prefix = 'rg') => `${prefix}-${++idSeq}`;

export function field(label: string, control: HTMLElement, opts: { hint?: string; optional?: boolean; wide?: boolean } = {}): HTMLElement {
  const id = control.id || nextId('f');
  control.id = id;
  const lab = h('label', { attrs: { for: id } }, label, opts.optional ? h('span', { class: 'rg-optional', text: ' (optional)' }) : null);
  return h('div', { class: `form-group${opts.wide ? ' rg-wide' : ''}` }, lab, control, opts.hint ? h('p', { class: 'rg-hint', text: opts.hint }) : null);
}

// Leaving a field by clicking a button right below it must not move that
// button mid-click, so a correction note waits until the click finishes.
let pointerDown = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointerDown = true), true);
  document.addEventListener('pointerup', () => setTimeout(() => (pointerDown = false), 0), true);
  document.addEventListener('pointercancel', () => (pointerDown = false), true);
}
const afterClick = (fn: () => void) => {
  if (!pointerDown) return fn();
  document.addEventListener('pointerup', () => setTimeout(fn, 50), { once: true, capture: true });
};

/**
 * Autocorrect a field when the student leaves it: fix spelling, then show
 * a small "Spelling corrected … Undo" note under the field.
 */
function attachAutocorrect(el: HTMLInputElement | HTMLTextAreaElement, mode: SpellMode, onInput: (v: string) => void) {
  el.spellcheck = true;
  let note: HTMLElement | null = null;
  const clearNote = () => {
    note?.remove();
    note = null;
  };
  el.addEventListener('input', clearNote);
  el.addEventListener('blur', async () => {
    const before = el.value;
    const { text, fixes } = await autocorrectText(before, mode);
    // Skip if nothing changed, or the student typed again meanwhile.
    if (text === before || el.value !== before) return;
    el.value = text;
    onInput(text);
    clearNote();
    const undo = h('button', { class: 'rg-link-btn', text: 'Undo', attrs: { type: 'button' } });
    undo.addEventListener('click', () => {
      el.value = before;
      onInput(before);
      clearNote();
    });
    const list = fixes.slice(0, 6).map((f) => `${f.from} → ${f.to}`).join(', ');
    const fresh = h('p', { class: 'rg-autofix', attrs: { role: 'status' } }, `✓ Spelling corrected: ${list}${fixes.length > 6 ? '…' : ''} `, undo);
    note = fresh;
    afterClick(() => {
      if (note !== fresh || !el.isConnected) return; // superseded or step changed
      el.insertAdjacentElement('afterend', fresh);
      setTimeout(() => note === fresh && clearNote(), 12000);
    });
  });
}

export function textInput(value: string, onInput: (v: string) => void, opts: { type?: string; placeholder?: string; maxlength?: number; list?: string; autocomplete?: string; autocorrect?: SpellMode } = {}) {
  const input = h('input', {
    attrs: { type: opts.type ?? 'text', placeholder: opts.placeholder, maxlength: String(opts.maxlength ?? 200), list: opts.list, autocomplete: opts.autocomplete ?? 'off' },
  });
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  if (opts.autocorrect) attachAutocorrect(input, opts.autocorrect, onInput);
  else input.spellcheck = false;
  return input;
}

export function textArea(value: string, onInput: (v: string) => void, opts: { rows?: number; placeholder?: string; maxlength?: number; autocorrect?: SpellMode } = {}) {
  const area = h('textarea', { attrs: { rows: String(opts.rows ?? 4), placeholder: opts.placeholder, maxlength: String(opts.maxlength ?? 2000) } });
  area.value = value;
  area.addEventListener('input', () => onInput(area.value));
  if (opts.autocorrect) attachAutocorrect(area, opts.autocorrect, onInput);
  return area;
}

export function select(options: readonly string[], value: string, onChange: (v: string) => void) {
  const sel = h('select');
  for (const o of options) sel.append(h('option', { text: o, attrs: { value: o, selected: o === value } }));
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** Tag/chip input: Enter or comma adds, × removes, Backspace on empty removes last. */
export function chipInput(values: string[], onChange: (values: string[]) => void, opts: { placeholder?: string; label?: string; transform?: (v: string) => string } = {}) {
  const list = [...values];
  const wrap = h('div', { class: 'rg-chips' });
  const input = h('input', { attrs: { type: 'text', placeholder: opts.placeholder ?? 'Type and press Enter', autocomplete: 'off', 'aria-label': opts.label } });

  const render = () => {
    wrap.querySelectorAll('.rg-chip').forEach((c) => c.remove());
    list.forEach((value, i) => {
      const remove = h('button', { class: 'rg-chip__x', text: '×', attrs: { type: 'button', 'aria-label': `Remove ${value}` } });
      remove.addEventListener('click', () => {
        list.splice(i, 1);
        render();
        onChange([...list]);
        input.focus();
      });
      wrap.insertBefore(h('span', { class: 'rg-chip' }, h('span', { text: value }), remove), input);
    });
  };

  const commit = (raw: string) => {
    let added = false;
    for (const part of raw.split(',')) {
      const raw = part.trim().replace(/\s+/g, ' ');
      const v = raw && opts.transform ? opts.transform(raw) : raw;
      if (v && !list.some((x) => x.toLowerCase() === v.toLowerCase())) {
        list.push(v.slice(0, 50));
        added = true;
      }
    }
    input.value = '';
    if (added) {
      render();
      onChange([...list]);
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input.value);
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      render();
      onChange([...list]);
    }
  });
  input.addEventListener('blur', () => input.value.trim() && commit(input.value));
  input.addEventListener('paste', (e) => {
    const text = (e as ClipboardEvent).clipboardData?.getData('text') ?? '';
    if (text.includes(',')) {
      e.preventDefault();
      commit(text);
    }
  });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) input.focus();
  });

  wrap.append(input);
  render();
  return Object.assign(wrap, { input, prefill: (text: string) => { input.value = text; input.focus(); } });
}

export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const region = document.getElementById('toasts');
  if (!region) return;
  const node = h('div', { class: `rg-toast${kind === 'error' ? ' is-error' : ''}`, text: message });
  region.append(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

export const ICON = {
  up: '↑',
  down: '↓',
  sparkle: '✨',
};
