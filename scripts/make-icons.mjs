// Builds the app's icons from the lantern-orb mark. Run after changing the design:
//   node scripts/make-icons.mjs
// Writes app/favicon.ico (16, 32, 48), app/apple-icon.png (180) and public/icon-192.png,
// public/icon-512.png, public/icon-maskable-512.png for the web manifest. app/icon.svg is the
// hand-written vector version modern browsers use. Uses sharp, which Next.js already installs.
import { writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const INK = "#121a2f";
const defs = `
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#a9bcff" stop-opacity="0.55" />
      <stop offset="0.6" stop-color="#a9bcff" stop-opacity="0.18" />
      <stop offset="1" stop-color="#a9bcff" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="orb" cx="35%" cy="35%" r="72%">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="0.45" stop-color="#a9bcff" />
      <stop offset="1" stop-color="#4b5fa8" />
    </radialGradient>
  </defs>`;

/**
 * The mark on a 64-unit canvas.
 * rx: corner radius of the ink tile (0 = full square, for platforms that mask it themselves).
 * orb, halo: radii. Small sizes get a bigger orb and a tighter halo so they don't turn to mud.
 */
const mark = ({ rx, orb, halo }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" rx="${rx}" fill="${INK}" />
  ${halo ? `<circle cx="32" cy="32" r="${halo}" fill="url(#halo)" />` : ""}
  <circle cx="32" cy="32" r="${orb}" fill="url(#orb)" />
</svg>`;

const TAB = mark({ rx: 14, orb: 16, halo: 27 }); // same as app/icon.svg
const TINY = mark({ rx: 12, orb: 20, halo: 29 }); // 16 px: bigger orb reads better
const SQUARE = mark({ rx: 0, orb: 15, halo: 26 }); // iOS and Android round the corners themselves
const MASKABLE = mark({ rx: 0, orb: 12, halo: 21 }); // kept inside the 80% safe zone

const png = (svg, size) => sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An .ico holding PNG images (supported by every current browser and Windows Vista onward). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir("public", { recursive: true });
const favicon = ico([
  { size: 16, data: await png(TINY, 16) },
  { size: 32, data: await png(TAB, 32) },
  { size: 48, data: await png(TAB, 48) },
]);
const outputs = [
  ["app/favicon.ico", favicon],
  ["app/apple-icon.png", await png(SQUARE, 180)],
  ["public/icon-192.png", await png(SQUARE, 192)],
  ["public/icon-512.png", await png(SQUARE, 512)],
  ["public/icon-maskable-512.png", await png(MASKABLE, 512)],
];
for (const [file, data] of outputs) {
  await writeFile(file, data);
  console.log(`${file}: ${data.length} bytes`);
}
