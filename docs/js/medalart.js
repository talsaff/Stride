// Medal artwork, drawn as inline SVG: a metal rim (bronze → silver → gold →
// platinum as medals get harder), an enamel center in the family's color with
// a small illustrated scene, and the milestone on a ribbon banner.
// Shapes tell the families apart: workouts round, distance hexagon,
// streaks shield, specials round with a double rim.

const TIERS = [
  { hi: '#F8CFA4', mid: '#C97B3E', lo: '#7A4216', ink: '#4A2608' },   // bronze
  { hi: '#FFFFFF', mid: '#BFC7CF', lo: '#66717C', ink: '#2E3840' },   // silver
  { hi: '#FFF4B8', mid: '#E5B22A', lo: '#8F6408', ink: '#4A3300' },   // gold
  { hi: '#F2FFFB', mid: '#98DCCB', lo: '#337F6D', ink: '#0E4436' },   // platinum
];
const TIER_BY_INDEX = [0, 0, 1, 1, 2, 2, 3];
const FAMILY = {
  workouts: { hi: '#43C39C', lo: '#0E5644' },
  distance: { hi: '#FFAE85', lo: '#B83F18' },
  streak: { hi: '#86B6F7', lo: '#284F9E' },
  special: { hi: '#B9A3EE', lo: '#4F3B92' },
};
const CIRCLE = 'M50 4a46 46 0 1 1 0 92a46 46 0 1 1 0-92z';
const SHAPE = {
  workouts: CIRCLE,
  distance: 'M50 3L91 26.5V73.5L50 97L9 73.5V26.5Z',
  streak: 'M50 3L89 13V47C89 72 72 88 50 97C28 88 11 72 11 47V13Z',
  special: CIRCLE,
};

const CREAM = '#FFF8EC';
const speed = (y) => `<g stroke="${CREAM}" stroke-width="2.6" stroke-linecap="round" opacity=".7"><path d="M16 ${y}h9M13 ${y + 6}h10M16 ${y + 12}h8"/></g>`;
// Scenes sit around (50, 46) so the banner fits below.
const SCENE = {
  workouts: (f) => `${speed(42)}
    <path d="M30 51c0-8 3-13 7-15l7-1c2 5 7 7 13 6l9 6c5 2 7 5 7 9v3c0 1-1 2-2 2H31c-1 0-2-1-2-2z" fill="${CREAM}"/>
    <path d="M29 56h44v3c0 1-1 2-2 2H31c-1 0-2-1-2-2z" fill="${f.lo}" opacity=".35"/>
    <g stroke="${f.lo}" stroke-width="1.8" stroke-linecap="round" opacity=".7"><path d="M46 39l4-2M49 42l4-2M52 44l4-2"/></g>`,
  distance: (f) => `
    <path d="M20 64L38 37l7 9 10-17 25 35z" fill="${CREAM}"/>
    <path d="M55 29l25 35H61l-7-16zM38 37l7 9-6 3z" fill="${f.lo}" opacity=".28"/>
    <path d="M55 29V18" stroke="${CREAM}" stroke-width="2" stroke-linecap="round"/><path d="M55 18h9l-2.5 3.2L64 24.5h-9z" fill="${CREAM}"/>
    <path d="M40 86c3-10 16-12 13-22h4c4 10-9 12-8 22z" fill="${f.lo}" opacity=".55"/>`,
  streak: (f) => `
    <path d="M50 20c9 12 19 18 17 34-1 11-8 18-17 18s-17-7-18-17c-1-11 9-16 11-26 4 6 5 10 9 12 0-8-2-14-2-21z" fill="${CREAM}"/>
    <path d="M50 44c5 6 9 9 8 16-1 5-4 8-8 8s-8-3-8-8c0-5 4-7 5-12 1 3 2 5 4 6 0-4-1-7-1-10z" fill="${f.hi}"/>`,
};
const SPECIAL = {
  jog: () => `${speed(38)}<path d="M57 20L35 50h14l-5 24 24-32H54z" fill="${CREAM}"/>`,
  early: () => `<path d="M33 58a17 17 0 0 1 34 0z" fill="${CREAM}"/>
    <g stroke="${CREAM}" stroke-width="2.8" stroke-linecap="round"><path d="M50 28v6M32 35l4 4M68 35l-4 4M24 49h5M76 49h-5"/></g>
    <path d="M22 63h56" stroke="${CREAM}" stroke-width="3.2" stroke-linecap="round"/><path d="M33 70h34" stroke="${CREAM}" stroke-width="3.2" stroke-linecap="round" opacity=".55"/>`,
  night: () => `<path d="M53 24a22 22 0 1 0 17 36a17 17 0 1 1-17-36z" fill="${CREAM}"/>
    <path d="M67 26l1.8 3.7 3.7 1.8-3.7 1.8L67 37l-1.8-3.7-3.7-1.8 3.7-1.8zM74 43l1.1 2.3 2.3 1.1-2.3 1.1L74 50l-1.1-2.3-2.3-1.1 2.3-1.1z" fill="${CREAM}"/>`,
  comeback: () => `<path d="M22 62l13-13 9 8 19-21" fill="none" stroke="${CREAM}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M57 31h12v12z" fill="${CREAM}" stroke="${CREAM}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 70h56" stroke="${CREAM}" stroke-width="3" stroke-linecap="round" opacity=".5"/>`,
  half: (f) => `<rect x="45.5" y="19" width="9" height="6" rx="2" fill="${CREAM}"/><path d="M64 29l4-4" stroke="${CREAM}" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="50" cy="48" r="20" fill="${CREAM}"/><circle cx="50" cy="48" r="15" fill="${f.lo}" opacity=".85"/>
    <path d="M50 33a15 15 0 0 1 15 15H50z" fill="${CREAM}" opacity=".35"/>
    <path d="M50 48V37" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="48" r="2.6" fill="${CREAM}"/>`,
};

function label(m) {
  if (m.group === 'workouts') return String(m.n);
  if (m.group === 'distance') return `${Math.floor(m.n)} km`;
  if (m.group === 'streak') return `${m.n} wk`;
  return null;
}

let uid = 0;

export function medalTier(m, indexInGroup) {
  return m.group === 'special' ? TIERS[2] : TIERS[TIER_BY_INDEX[Math.min(indexInGroup, 6)]];
}

// m: medal object ({ id, group, n }), index: its position within its group.
export function medalSvg(m, index, size = 64) {
  const t = medalTier(m, index);
  const f = FAMILY[m.group] ?? FAMILY.special;
  const shape = SHAPE[m.group] ?? CIRCLE;
  const id = `md${++uid}`;
  const text = label(m);
  const inner = 'translate(50 50) scale(.8) translate(-50 -50)';
  const rays = Array.from({ length: 12 }, (_, i) => `<path d="M50 50L46.5 0h7z" transform="rotate(${i * 30} 50 50)"/>`).join('');
  const scene = m.group === 'special' ? (SPECIAL[m.id] ?? SPECIAL.half)(f) : SCENE[m.group](f);
  const banner = text ? `
    <g filter="url(#${id}d)">
      <path d="M17 81l7-7v17l-7-5zM83 81l-7-7v17l7-5z" fill="${t.lo}"/>
      <rect x="24" y="72" width="52" height="18" rx="4" fill="url(#${id}m)"/>
      <rect x="24.5" y="72.5" width="51" height="17" rx="3.5" fill="none" stroke="${t.lo}" stroke-opacity=".55"/>
      <text x="50" y="85.6" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-weight="900" font-size="${text.length > 5 ? 11 : 12.5}" fill="${t.ink}">${text}</text>
    </g>` : '';
  return `<svg class="medal-svg" viewBox="0 0 100 100" style="width:${size}px;height:${size}px" aria-hidden="true">
    <defs>
      <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.hi}"/><stop offset=".5" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
      <radialGradient id="${id}e" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${f.hi}"/><stop offset="1" stop-color="${f.lo}"/></radialGradient>
      <clipPath id="${id}c"><path d="${shape}" transform="${inner}"/></clipPath>
      <filter id="${id}d" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#000" flood-opacity=".28"/></filter>
    </defs>
    <path d="${shape}" fill="url(#${id}m)"/>
    <path d="${shape}" fill="none" stroke="${t.lo}" stroke-opacity=".4" stroke-width="1.5"/>
    ${m.group === 'special' ? `<path d="${shape}" transform="translate(50 50) scale(.9) translate(-50 -50)" fill="none" stroke="${t.lo}" stroke-opacity=".4" stroke-width="1.2"/>` : ''}
    <path d="${shape}" transform="${inner}" fill="url(#${id}e)"/>
    <g clip-path="url(#${id}c)">
      <g fill="#fff" opacity=".08">${rays}</g>
      <g filter="url(#${id}d)">${scene}</g>
      <ellipse cx="36" cy="20" rx="32" ry="14" fill="#fff" opacity=".12"/>
    </g>
    <path d="${shape}" transform="${inner}" fill="none" stroke="${t.lo}" stroke-opacity=".6" stroke-width="2"/>
    ${banner}
  </svg>`;
}
