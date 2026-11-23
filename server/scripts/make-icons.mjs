import sharp from 'sharp';
import fs from 'node:fs';
const svg = fs.readFileSync('../client/public/logo.svg');
for (const s of [192, 512]) await sharp(svg, { density: 300 }).resize(s, s).png().toFile(`../client/public/icons/icon-${s}.png`);
// maskable: fond plein + marge de sécurité
const inner = await sharp(svg, { density: 300 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#10354D' } }).composite([{ input: inner, left: 76, top: 76 }]).png().toFile('../client/public/icons/maskable-512.png');
await sharp(svg, { density: 300 }).resize(180, 180).png().toFile('../client/public/icons/apple-touch-icon.png');
await sharp(svg, { density: 300 }).resize(400, 400).png().toFile('/tmp/logo-preview.png');
