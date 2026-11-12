// Placeholder PWA icons: crescent on Deep Forest. Replace with the NgajiGaes logo when the owner supplies it.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const FOREST = "#354f40";
const CREAM = "#faf7ed";

function svg(size, padRatio) {
  const c = size / 2;
  const r = size * (0.5 - padRatio) * 0.62;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${FOREST}"/>
  <mask id="m"><rect width="${size}" height="${size}" fill="#fff"/><circle cx="${c + r * 0.42}" cy="${c - r * 0.3}" r="${r * 0.86}" fill="#000"/></mask>
  <circle cx="${c}" cy="${c}" r="${r}" fill="${CREAM}" mask="url(#m)"/>
</svg>`;
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", svg(512, 0.08));
const jobs = [
  ["icon-192.png", 192, 0.08],
  ["icon-512.png", 512, 0.08],
  ["icon-maskable-512.png", 512, 0.18],
  ["apple-touch-icon.png", 180, 0.1],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(svg(size, pad))).png().toFile(`public/icons/${name}`);
}
console.log("icons written");
