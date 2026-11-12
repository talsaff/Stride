// Medal artwork, drawn as inline SVG in a "rich coin" style: a beveled metal
// rim (bronze → silver → gold → platinum as medals get harder), deep enamel in
// the family's brand color, and a big metallic icon.
// Shapes tell the families apart: workouts round, distance hexagon,
// streaks shield, specials round with a double rim.

const TIERS = [
  { hi: '#FFD9B0', mid: '#D38A4A', lo: '#7A4216' },   // bronze
  { hi: '#FFFFFF', mid: '#C9D0D7', lo: '#66717C' },   // silver
  { hi: '#FFF6C2', mid: '#F0BE32', lo: '#94660A' },   // gold
  { hi: '#F2FFFB', mid: '#A5E6D5', lo: '#2F7F6C' },   // platinum
];
const TIER_BY_INDEX = [0, 0, 1, 1, 2, 2, 3];
const FAMILY = {
  workouts: ['#2FB98F', '#0A4D3D'],
  distance: ['#FF9466', '#8F2E0C'],
  streak: ['#79AEF5', '#1D3A85'],
  special: ['#AE96EA', '#38297A'],
};
const CIRCLE = 'M50 3a47 47 0 1 1 0 94a47 47 0 1 1 0-94z';
const SHAPE = {
  workouts: CIRCLE,
  distance: 'M50 2.5Q52 2.5 54 3.6L89 23.8Q92.5 25.8 92.5 30V70Q92.5 74.2 89 76.2L54 96.4Q50 98.7 46 96.4L11 76.2Q7.5 74.2 7.5 70V30Q7.5 25.8 11 23.8L46 3.6Q48 2.5 50 2.5Z',
  streak: 'M50 2.5L86 11.5Q90 12.5 90 16.5V46C90 71 73 87 50 97.5C27 87 10 71 10 46V16.5Q10 12.5 14 11.5Z',
  special: CIRCLE,
};

// Icons: filled silhouettes in a 100×100 box, centered near (50, 47).
// Optional `detail` strokes are drawn in the enamel's dark color on top.
const ICON = {
  workouts: {
    d: 'M16 66V53c0-7 4-13 12-15l7-1c4 7 11 9 19 7l12 8c10 4 18 6 20 12v2zM14 68h74c0 4-3 7-8 7H22c-5 0-8-3-8-7z',
    detail: 'M40 41l5-3M45 44l5-3M50 46l5-3M16 66h72',
  },
  distance: {
    d: 'M10 72L35 34l9 12 14-24 32 50zM57 22V9h2v2h11l-3.5 4 3.5 4H59v3z',
    detail: 'M58 22l8 14-6 2M35 34l5 7',
  },
  streak: {
    d: 'M50 10c12 16 25 24 23 44-1 16-11 24-23 24s-22-8-23-23c-1-15 12-21 14-34 5 8 7 13 12 16 0-11-3-18-3-27z',
    detail: 'M50 48c5 7 10 10 9 18-1 5-4 8-9 8s-9-3-9-8c0-6 4-8 6-13 1 3 2 5 4 6',
  },
  jog: { d: 'M60 10L30 52h18l-7 34 32-44H55zM10 36h13v5H10zM6 46h15v5H6zM10 56h11v5H10z' },
  early: { d: 'M26 62a24 24 0 0 1 48 0zM47.5 18h5v11h-5zM20 30l3.5-3.5 7.5 7.5-3.5 3.5zM80 30l-3.5-3.5-7.5 7.5 3.5 3.5zM10 50h10v5H10zM80 50h10v5H80zM10 66h80v6H10zM26 76h48v6H26z' },
  night: { d: 'M52 12a34 34 0 1 0 28 54a26 26 0 1 1-28-54zM74 14l2.8 5.7 5.7 2.8-5.7 2.8L74 31l-2.8-5.7-5.7-2.8 5.7-2.8zM84 40l1.8 3.6 3.6 1.8-3.6 1.8L84 51l-1.8-3.6-3.6-1.8 3.6-1.8z' },
  comeback: { d: 'M10 68l20-20 13 11 21-24-8-8h25v25l-8-8-29 32-13-11-13 13zM10 77h80v6H10z' },
  half: { d: 'M44 8h12v8H44zM70 18l5 5-6 6-5-5zM50 19a31 31 0 1 1 0 62a31 31 0 1 1 0-62zm0 8a23 23 0 1 0 0 46a23 23 0 1 0 0-46zM47.5 32h5v20h-5z' },
};

let uid = 0;

export function medalTier(m, indexInGroup) {
  return m.group === 'special' ? TIERS[2] : TIERS[TIER_BY_INDEX[Math.min(indexInGroup, 6)]];
}

// m: medal object ({ id, group, n }), index: its position within its group.
export function medalSvg(m, index, size = 64) {
  const t = medalTier(m, index);
  const [eh, el] = FAMILY[m.group] ?? FAMILY.special;
  const shape = SHAPE[m.group] ?? CIRCLE;
  const icon = ICON[m.group === 'special' ? m.id : m.group] ?? ICON.half;
  const id = `md${++uid}`;
  const sc = (k) => `translate(50 50) scale(${k}) translate(-50 -50)`;
  const rays = Array.from({ length: 16 }, (_, i) => `<path d="M50 50L47.5 0h5z" transform="rotate(${i * 22.5} 50 50)"/>`).join('');
  const iconTf = 'translate(50 50) scale(.64) translate(-50 -47)';
  return `<svg class="medal-svg" viewBox="0 0 100 100" style="width:${size}px;height:${size}px" aria-hidden="true">
    <defs>
      <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.hi}"/><stop offset=".45" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
      <linearGradient id="${id}r" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${t.hi}"/><stop offset=".5" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
      <radialGradient id="${id}e" cx="40%" cy="30%" r="78%"><stop offset="0" stop-color="${eh}"/><stop offset="1" stop-color="${el}"/></radialGradient>
      <clipPath id="${id}c"><path d="${shape}" transform="${sc(0.78)}"/></clipPath>
      <filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".45"/></filter>
    </defs>
    <path d="${shape}" fill="url(#${id}m)"/>
    <path d="${shape}" transform="${sc(0.89)}" fill="url(#${id}r)"/>
    ${m.group === 'special' ? `<path d="${shape}" transform="${sc(0.94)}" fill="none" stroke="${t.lo}" stroke-opacity=".45" stroke-width="1"/>` : ''}
    <path d="${shape}" transform="${sc(0.81)}" fill="${t.lo}"/>
    <path d="${shape}" transform="${sc(0.78)}" fill="url(#${id}e)"/>
    <g clip-path="url(#${id}c)">
      <g fill="#fff" opacity=".07">${rays}</g>
      <g transform="${iconTf}" filter="url(#${id}s)">
        <path d="${icon.d}" fill="${el}" stroke="${el}" stroke-width="6" stroke-linejoin="round" fill-rule="evenodd" opacity=".55"/>
        <path d="${icon.d}" fill="url(#${id}m)" fill-rule="evenodd"/>
        ${icon.detail ? `<path d="${icon.detail}" fill="none" stroke="${el}" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      </g>
      <ellipse cx="40" cy="16" rx="38" ry="17" fill="#fff" opacity=".12"/>
    </g>
    <path d="${shape}" transform="${sc(0.78)}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2"/>
  </svg>`;
}
