// Geometric SVG glyphs, matching the 3D shapes.
const SHAPES = {
  fighter: '<rect x="4" y="4" width="16" height="16"/>',
  assassin: '<path d="M12 3 21 20H3Z"/>',
  ranged: '<circle cx="12" cy="12" r="8.5"/>',
  tank: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z"/>',
  commander: '<path d="M12 2 21 12 12 22 3 12Z"/>',
  hq: '<path d="M3 21V15H6V10H9V5H15V10H18V15H21V21Z"/>',
  barracks: '<path d="M3 20V9H21V20ZM7 9V5H17V9"/>',
  turret: '<path d="M7 21V12H17V21ZM10 12V7H14V12M12 7V2"/>',
  command: '<path d="M6 21V17H18V21ZM11 17V6H13V17ZM8 5a4 4 0 0 1 8 0"/>',
  outpost: '<path d="M4 21 7 15H17L20 21ZM11 15V3L18 6 11 9"/>',
  barricade: '<rect x="3" y="11" width="18" height="6"/>',
  node: '<path d="M12 3 19 12 12 21 5 12Z"/>',
};

export function glyph(kind, team = 0, size = 18) {
  const fill = team === 0 ? '#f6f6f4' : team === 1 ? '#0b0b0b' : '#8a8a8a';
  const stroke = team === 1 ? '#f6f6f4' : '#0b0b0b';
  const sw = team === 0 ? 0 : 1.6;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter">${SHAPES[kind] || SHAPES.fighter}</svg>`;
}
