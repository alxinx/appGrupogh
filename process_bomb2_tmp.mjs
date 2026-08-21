import sharp from 'sharp';
import fs from 'fs';
const buf = fs.readFileSync('bomb2.png');
console.log('input size:', buf.length, 'bytes');
const t0 = Date.now();
const out = await sharp(buf)
  .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80 })
  .toBuffer();
console.log('processed OK in', Date.now() - t0, 'ms, output bytes:', out.length);
