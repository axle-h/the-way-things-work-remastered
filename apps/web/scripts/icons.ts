// Draws the web app's icons (public/icons): two plain gears on a blue square, our own artwork with
// nothing from the disc. Run `node apps/web/scripts/icons.ts` after changing the design; the
// output is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

interface Gear {
  readonly cx: number;
  readonly cy: number;
  readonly root: number;
  readonly tip: number;
  readonly teeth: number;
  readonly hole: number;
  readonly rotation: number;
  readonly colour: readonly [number, number, number];
}

/** In a unit square. */
const GEARS: readonly Gear[] = [
  {
    cx: 0.41,
    cy: 0.58,
    root: 0.235,
    tip: 0.3,
    teeth: 10,
    hole: 0.085,
    rotation: 0.12,
    colour: [0xf0, 0xc4, 0x19],
  },
  {
    cx: 0.72,
    cy: 0.28,
    root: 0.12,
    tip: 0.17,
    teeth: 7,
    hole: 0.045,
    rotation: 0.3,
    colour: [0x8f, 0xd3, 0xf4],
  },
];
const BACKGROUND: readonly [number, number, number] = [0x15, 0x34, 0x5c];
/** Corner radius of the rounded square, for the plain icons. */
const CORNER = 0.18;

function insideGear(gear: Gear, x: number, y: number): boolean {
  const dx = x - gear.cx;
  const dy = y - gear.cy;
  const r = Math.hypot(dx, dy);
  if (r < gear.hole || r > gear.tip) return false;
  const turn = (Math.atan2(dy, dx) - gear.rotation) / (2 * Math.PI);
  const phase = (((turn * gear.teeth) % 1) + 1) % 1;
  return r <= (phase < 0.5 ? gear.tip : gear.root);
}

function insideRoundedSquare(x: number, y: number, corner: number): boolean {
  const cx = Math.min(Math.max(x, corner), 1 - corner);
  const cy = Math.min(Math.max(y, corner), 1 - corner);
  return Math.hypot(x - cx, y - cy) <= corner;
}

/** RGBA pixels, 4×4 supersampled. `padding` shrinks the artwork (maskable icons' safe zone). */
function draw(size: number, rounded: boolean, padding = 0): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (rounded && !insideRoundedSquare(x, y, CORNER)) continue;
          const ax = (x - padding) / (1 - 2 * padding);
          const ay = (y - padding) / (1 - 2 * padding);
          const gear = GEARS.find((candidate) => insideGear(candidate, ax, ay));
          const colour = gear?.colour ?? BACKGROUND;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }
      const n = samples * samples;
      const at = (py * size + px) * 4;
      // Colours averaged over the covered samples; coverage as alpha.
      const covered = a / 255;
      rgba[at] = covered > 0 ? Math.round(r / covered) : 0;
      rgba[at + 1] = covered > 0 ? Math.round(g / covered) : 0;
      rgba[at + 2] = covered > 0 ? Math.round(b / covered) : 0;
      rgba[at + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

function png(size: number, rgba: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    rows.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function svg(): string {
  const hex = (c: readonly number[]): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const n = (v: number): string => (v * 100).toFixed(2).replace(/\.?0+$/, '');
  const gears = GEARS.map((gear) => {
    const points: string[] = [];
    for (let k = 0; k < gear.teeth; k++) {
      const a0 = gear.rotation + (2 * Math.PI * k) / gear.teeth;
      const a1 = a0 + Math.PI / gear.teeth;
      for (const [angle, radius] of [
        [a0, gear.root],
        [a0, gear.tip],
        [a1, gear.tip],
        [a1, gear.root],
      ] as const) {
        points.push(`${n(gear.cx + radius * Math.cos(angle))} ${n(gear.cy + radius * Math.sin(angle))}`);
      }
    }
    const hole =
      `M${n(gear.cx + gear.hole)} ${n(gear.cy)}a${n(gear.hole)} ${n(gear.hole)} 0 1 0 ${n(-2 * gear.hole)} 0` +
      `a${n(gear.hole)} ${n(gear.hole)} 0 1 0 ${n(2 * gear.hole)} 0z`;
    return `  <path fill="${hex(gear.colour)}" fill-rule="evenodd" d="M${points.join('L')}z${hole}"/>`;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `  <rect width="100" height="100" rx="${n(CORNER)}" fill="${hex(BACKGROUND)}"/>`,
    ...gears,
    '</svg>',
    '',
  ].join('\n');
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const write = (name: string, data: string | Uint8Array): void => writeFileSync(new URL(name, out), data);
write('icon-192.png', png(192, draw(192, true)));
write('icon-512.png', png(512, draw(512, true)));
// Maskable: full bleed, the gears inside the 80% safe zone.
write('icon-maskable-512.png', png(512, draw(512, false, 0.1)));
// iOS rounds the corners itself and wants an opaque square.
write('apple-touch-icon.png', png(180, draw(180, false, 0.06)));
write('icon.svg', svg());
console.log(`icons written to ${out.pathname}`);
