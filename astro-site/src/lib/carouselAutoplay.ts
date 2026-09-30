/**
 * Shared autoplay for the homepage carousels.
 *
 * The countdown IS the CSS animation on the active slide's progress fill
 * (`@keyframes autoplay-fill`, duration `var(--autoplay-ms)`): when it
 * ends, `next()` runs. Pausing is just `animation-play-state: paused` via
 * `.is-autoplay-paused` on the root, so the bar and the timer can never
 * drift apart, and resuming continues from exactly where it stopped. A
 * manual slide change restarts the countdown because the newly active
 * fill starts its animation from zero.
 *
 * Pauses while a mouse hovers the carousel, while it has keyboard focus,
 * during a touch/drag, when it's scrolled out of view, and when the tab
 * is hidden.
 */
export function initCarouselAutoplay(opts: {
  root: HTMLElement;
  /** Element whose visibility gates autoplay (usually the slide viewport). */
  watch: HTMLElement;
  intervalMs: number;
  next: () => void;
  /** Set false to keep sliding while the mouse is over the carousel. */
  pauseOnHover?: boolean;
}) {
  const { root, watch, intervalMs, next, pauseOnHover = true } = opts;
  root.style.setProperty('--autoplay-ms', `${intervalMs}ms`);

  let hovered = false;
  let focused = false;
  let pressed = false;
  let visible = false;

  const update = () =>
    root.classList.toggle('is-autoplay-paused', hovered || focused || pressed || !visible || document.hidden);

  root.addEventListener('pointerenter', (e) => {
    if (pauseOnHover && e.pointerType === 'mouse') hovered = true;
    update();
  });
  root.addEventListener('pointerleave', () => {
    hovered = false;
    update();
  });
  // Only keyboard focus pauses — a mouse click on an arrow shouldn't stop
  // autoplay for good just because the button keeps focus afterwards.
  root.addEventListener('focusin', (e) => {
    focused = (e.target as HTMLElement).matches(':focus-visible');
    update();
  });
  root.addEventListener('focusout', () => {
    focused = false;
    update();
  });
  watch.addEventListener('pointerdown', () => { pressed = true; update(); }, { passive: true });
  window.addEventListener('pointerup', () => { if (pressed) { pressed = false; update(); } });
  window.addEventListener('pointercancel', () => { if (pressed) { pressed = false; update(); } });
  document.addEventListener('visibilitychange', update);

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      update();
    },
    { threshold: 0.35 }
  ).observe(watch);

  root.addEventListener('animationend', (e) => {
    if (e.animationName.startsWith('autoplay-fill')) next();
  });

  update();
}
