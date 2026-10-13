// Small inline icon set (24x24, stroke based).
const s = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

// The Stride mark: a runner whose body (torso, front thigh, shin) is a sharp
// S. Arms and head float free. `bg` paints the small gap where the back leg
// passes behind the body, so it must match whatever the mark sits on.
export function logoMark(fg, bg) {
  const st = (c, w) => `style="stroke:${c}" stroke-width="${w}"`;
  const S = 'M60 27 L 44 45 L 69 61 L 50 88';
  return `<g transform="translate(4 4) scale(.92)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path ${st(fg, 11)} d="M45 50 L 19 86"/>
    <path ${st(bg, 22)} d="${S}"/>
    <path ${st(fg, 14)} d="${S}"/>
    <path ${st(fg, 9.5)} d="M66 38 L 76 45 L 88 34"/>
    <path ${st(fg, 9.5)} d="M48 23 L 36 27 L 29 38"/>
    <circle cx="71" cy="11" r="9" style="fill:${fg}" stroke="none"/></g>`;
}

export function wordmark(size = 64) {
  return `<span class="wordmark" style="--wm:${size}px" role="img" aria-label="Stride">
    <svg viewBox="13 2 80 90" aria-hidden="true">${logoMark('var(--primary)', 'var(--bg)')}</svg><span aria-hidden="true">tride</span></span>`;
}

export const ICONS = {
  walk: s('<circle cx="13" cy="4" r="2"/><path d="M9 21l2.5-6.5L14 17v4"/><path d="M7 11l3-3.5 4 1.5 2 3 3 1"/><path d="M10 7.5L11.5 14"/>'),
  home: s('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  chart: s('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  leaf: s('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>'),
  bolt: s('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  play: s('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  pause: s('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  skip: s('<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>'),
  stop: s('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  slow: s('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  heart: s('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>'),
  share: s('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/>'),
  check: s('<path d="M5 12l5 5 9-10"/>'),
  sliders: s('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  calendar: s('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  shield: s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  chev: s('<path d="M9 6l6 6-6 6"/>'),
  medal: s('<circle cx="12" cy="15" r="6"/><path d="M8.5 10.5L5 3h5l2 4 2-4h5l-3.5 7.5"/><path d="M12 13v4"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  refresh: s('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  bell: s('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  run: s('<circle cx="15" cy="4" r="2"/><path d="M5 21l4-6 3 2 1 4"/><path d="M8 11l3-4 4 1 2 4h3"/><path d="M11 7l-1 5 3 3"/>'),
};
