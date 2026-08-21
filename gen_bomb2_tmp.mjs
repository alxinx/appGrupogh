import sharp from 'sharp';
import fs from 'fs';
const W = 16000, H = 16000; // 256,000,000 px -- just under sharp's default cap of 268,402,689
const buf = await sharp({
  create: { width: W, height: H, channels: 3, background: { r: 10, g: 200, b: 80 } }
}).png({ compressionLevel: 9 }).toBuffer();
fs.writeFileSync('bomb2.png', buf);
console.log('bomb2.png bytes:', buf.length, '(', (buf.length/1024).toFixed(1), 'KB )', 'pixels:', W*H);
