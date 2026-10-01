// RDoc → HTML (the live preview and thumbnails). Styling lives in
// src/styles/resume-templates.css, keyed by the template's settings.
// Every piece of text is set with textContent — never innerHTML — so
// nothing a student types can inject markup.

import type { RBlock, RDoc, RLink, RSection } from './model';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function linkOrText(link: RLink, className = ''): HTMLElement {
  if (!link.url) return el('span', className, link.text);
  const a = el('a', className, link.text);
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function joined(items: RLink[], sep: string, className: string): HTMLElement {
  const p = el('p', className);
  items.forEach((item, i) => {
    if (i) p.append(el('span', 'rs-sep', sep));
    p.append(linkOrText(item));
  });
  return p;
}

function renderBlock(block: RBlock): HTMLElement {
  switch (block.type) {
    case 'text':
      return el('p', 'rs-text', block.text);
    case 'bullets': {
      const ul = el('ul', 'rs-bullets');
      block.items.forEach((i) => ul.append(el('li', '', i)));
      return ul;
    }
    case 'skills': {
      const wrap = el('div', 'rs-skills');
      if (block.inline) {
        wrap.append(el('p', 'rs-skill', block.groups.flatMap((g) => g.items).join(' · ')));
      } else {
        for (const g of block.groups) {
          const p = el('p', 'rs-skill');
          p.append(el('strong', '', `${g.label}: `), document.createTextNode(g.items.join(', ')));
          wrap.append(p);
        }
      }
      return wrap;
    }
    case 'entry': {
      const entry = el('div', 'rs-entry');
      const top = el('div', 'rs-entry-top');
      top.append(el('strong', 'rs-entry-h', block.heading));
      if (block.meta) top.append(el('span', 'rs-meta', block.meta));
      entry.append(top);
      if (block.subheading) entry.append(el('p', 'rs-sub', block.subheading));
      if (block.links?.length) entry.append(joined(block.links, ' | ', 'rs-links'));
      if (block.text) entry.append(el('p', 'rs-text', block.text));
      if (block.bullets.length) {
        const ul = el('ul', 'rs-bullets');
        block.bullets.forEach((b) => ul.append(el('li', '', b)));
        entry.append(ul);
      }
      return entry;
    }
  }
}

function renderSection(section: RSection): HTMLElement {
  const sec = el('section', `rs-sec rs-sec--${section.kind}`);
  sec.append(el('h2', 'rs-h', section.title));
  section.blocks.forEach((b) => sec.append(renderBlock(b)));
  return sec;
}

export function renderResumeHtml(doc: RDoc): HTMLElement {
  const { cfg } = doc;
  const page = el(
    'article',
    [
      'rs',
      `rs--${cfg.id}`,
      `rs--${cfg.font}`,
      `rs--h-${cfg.headingStyle}`,
      `rs--align-${cfg.headerAlign}`,
      cfg.layout === 'sidebar' ? 'rs--sidebar' : '',
      doc.placeholder ? 'rs--placeholder' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  page.style.setProperty('--rs-accent', cfg.accent);
  page.setAttribute('aria-label', 'Resume preview');

  const head = el('header', 'rs-head');
  if (doc.name) head.append(el('h1', `rs-name${cfg.nameUppercase ? ' rs-name--upper' : ''}`, doc.name));
  if (doc.role) head.append(el('p', 'rs-role', doc.role));
  if (doc.contacts.length) head.append(joined(doc.contacts, ' | ', 'rs-contacts'));
  page.append(head);

  if (cfg.layout === 'sidebar') {
    const cols = el('div', 'rs-cols');
    const side = el('aside', 'rs-side');
    const main = el('div', 'rs-main');
    doc.side.forEach((s) => side.append(renderSection(s)));
    doc.main.forEach((s) => main.append(renderSection(s)));
    cols.append(side, main);
    page.append(cols);
  } else {
    doc.main.forEach((s) => page.append(renderSection(s)));
  }

  if (!doc.main.length && !doc.side.length) {
    page.append(el('p', 'rs-empty', 'Your resume sections will appear here as you fill in each step.'));
  }
  return page;
}

/**
 * Renders the resume as an A4 page scaled to fit `host`'s width, and keeps
 * it fitted on resize. Returns a function that re-renders with new content.
 */
export function mountScaledResume(host: HTMLElement): { update: (doc: RDoc) => void; destroy: () => void } {
  host.classList.add('rs-host');
  const frame = el('div', 'rs-frame');
  host.replaceChildren(frame);

  const PAGE_WIDTH = 794; // A4 at 96 dpi
  let page: HTMLElement | null = null;

  const fit = () => {
    if (!page) return;
    const scale = Math.min(1, host.clientWidth / PAGE_WIDTH);
    page.style.transform = `scale(${scale})`;
    frame.style.height = `${page.offsetHeight * scale}px`;
    frame.style.width = `${PAGE_WIDTH * scale}px`;
  };

  const observer = new ResizeObserver(fit);
  observer.observe(host);

  return {
    update(doc: RDoc) {
      page = renderResumeHtml(doc);
      frame.replaceChildren(page);
      fit();
    },
    destroy() {
      observer.disconnect();
    },
  };
}
