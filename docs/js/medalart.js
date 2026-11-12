// Medal artwork: a metal disc on a ribbon, drawn as inline SVG.
// Tier (bronze → silver → gold → platinum) follows how hard the medal is;
// the ribbon color follows the medal family; the milestone sits on the disc.

const TIERS = [
  { light: '#F2C08F', mid: '#CD7F32', dark: '#8A5220', ink: '#5C3410' },   // bronze
  { light: '#F4F7F9', mid: '#BFC7CF', dark: '#7D8892', ink: '#3E4852' },   // silver
  { light: '#FFF0A8', mid: '#E8B931', dark: '#A87A0C', ink: '#5E4300' },   // gold
  { light: '#E6FBF4', mid: '#8FD9C4', dark: '#3C9C84', ink: '#14503F' },   // platinum
];
const TIER_BY_INDEX = [0, 0, 1, 1, 2, 2, 3];
const RIBBON = {
  workouts: ['#1E8A6E', '#146B55'],
  distance: ['#FF8A5B', '#E0603A'],
  streak: ['#5B8DEF', '#3F6CC9'],
  special: ['#8D7AC4', '#6C5AA6'],
};

const ICON = {
  jog: '<circle cx="13.5" cy="4.5" r="2"/><path d="M8 21l3-6 3 2 1 4M7.5 11l3-3.5 4 1.5 2 3h3M11.5 7.5L10 13"/>',
  early: '<circle cx="12" cy="13" r="4"/><path d="M12 3v3M4.2 6.2l2 2M19.8 6.2l-2 2M2 17h20M5 21h14"/>',
  night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  comeback: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  half: '<circle cx="12" cy="14" r="7"/><path d="M12 14V10M10 3h4M12 3v4"/>',
};

function label(m) {
  if (m.group === 'workouts') return String(m.n);
  if (m.group === 'distance') return `${Math.floor(m.n)}K`;
  if (m.group === 'streak') return `${m.n}W`;
  return null;
}

let uid = 0;

export function medalTier(m, indexInGroup) {
  return m.group === 'special' ? TIERS[2] : TIERS[TIER_BY_INDEX[Math.min(indexInGroup, 6)]];
}

// m: medal object ({ id, group, n }), index: position within its group.
export function medalSvg(m, index, size = 64) {
  const t = medalTier(m, index);
  const [r1, r2] = RIBBON[m.group] ?? RIBBON.special;
  const id = `md${++uid}`;
  const text = label(m);
  const fs = text && text.length >= 3 ? 17 : 21;
  const center = text
    ? `<text x="50" y="${82 + fs * 0.36}" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-weight="900" font-size="${fs}" fill="${t.ink}">${text}</text>`
    : `<g transform="translate(32 64) scale(1.5)" fill="none" stroke="${t.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[m.id] ?? ICON.half}</g>`;
  return `<svg class="medal-svg" viewBox="0 0 100 124" style="width:${size}px;height:${Math.round(size * 1.24)}px" aria-hidden="true">
    <defs>
      <radialGradient id="${id}g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${t.light}"/><stop offset=".55" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.dark}"/></radialGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="M27 0h18l14 52H41z" fill="${r1}"/>
    <path d="M73 0H55L41 52h18z" fill="${r2}"/>
    <path d="M33 0h4l14 52h-4z" fill="#fff" opacity=".35"/>
    <circle cx="50" cy="84" r="34" fill="${t.dark}"/>
    <circle cx="50" cy="82" r="34" fill="url(#${id}g)"/>
    <circle cx="50" cy="82" r="26" fill="none" stroke="${t.dark}" stroke-opacity=".45" stroke-width="2"/>
    <circle cx="50" cy="82" r="31" fill="url(#${id}s)"/>
    ${center}
  </svg>`;
}
