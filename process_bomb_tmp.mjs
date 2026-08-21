import sharp from 'sharp';
import fs from 'fs';

const buf = fs.readFileSync('/private/tmp/claude-501/-Users-apple-Documents-CLIENTES-grupoGh-appGrupogh/28c6179f-065e-4a03-9164-ab016d5dd4d2/scratchpad/bomb.png');
console.log('input size:', buf.length, 'bytes');

const t0 = Date.now();
// EXACT call used in controller/adminControllers.js saveProduct (no validarImagen, no limitInputPixels override)
const out = await sharp(buf)
  .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80 })
  .toBuffer();
console.log('processed OK in', Date.now() - t0, 'ms, output bytes:', out.length);
