const sharp = require('sharp');
const fs = require('fs');
(async () => {
  const size = 512;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" rx="80" fill="#0f1115"/>
<rect x="64" y="64" width="384" height="384" rx="24" fill="#1a1d24" stroke="#2a2f3a" stroke-width="8"/>
<rect x="120" y="120" width="272" height="272" rx="16" fill="none" stroke="#4f8cff" stroke-width="14"/>
<rect x="112" y="112" width="28" height="28" rx="14" fill="white" stroke="#4f8cff" stroke-width="4"/>
<rect x="372" y="112" width="28" height="28" rx="14" fill="white" stroke="#4f8cff" stroke-width="4"/>
<rect x="112" y="372" width="28" height="28" rx="14" fill="white" stroke="#4f8cff" stroke-width="4"/>
<rect x="372" y="372" width="28" height="28" rx="14" fill="white" stroke="#4f8cff" stroke-width="4"/>
<circle cx="256" cy="256" r="48" fill="#4f8cff" opacity="0.15"/>
<text x="256" y="272" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="800" fill="#4f8cff">IF</text>
</svg>`;
  const png512 = await sharp(Buffer.from(svg)).png().toBuffer();
  const sizes = [256, 128, 64, 32, 16];
  const pngs = [];
  for (const s of sizes) {
    const buf = await sharp(png512).resize(s, s).png().toBuffer();
    pngs.push({ size: s, buf });
  }
  let header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  let entries = [];
  let dataParts = [];
  for (const p of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(p.size === 256 ? 0 : p.size, 0);
    entry.writeUInt8(p.size === 256 ? 0 : p.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(p.buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    dataParts.push(p.buf);
    offset += p.buf.length;
  }
  const ico = Buffer.concat([header, ...entries, ...dataParts]);
  fs.writeFileSync('build/icon.ico', ico);
  fs.writeFileSync('build/icon.png', pngs[0].buf);
  console.log('ico created', ico.length, 'bytes');
})();
