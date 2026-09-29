import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import db from '../config/bd.js';
import s3Client from '../config/r2.js';
import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { Documentacion } from '../models/index.js';
import { keyDocumento, borrarObjetos } from '../helpers/almacenamientoDocumentos.js';

dotenv.config();

// Pasa los documentos de proveedor que quedaron en el bucket PÚBLICO (documentacion/…)
// al PRIVADO gh-pay-assets, carpeta provedores/{idProveedor}/, y actualiza su keyName.
//
//   npm run db:migrar-documentos-proveedor             → solo muestra qué movería
//   npm run db:migrar-documentos-proveedor -- --aplicar → copia, actualiza la fila y borra
//                                                          el original público
//
// Se corre UNA vez por ambiente (local y producción tienen bases distintas pero comparten
// los buckets: cada uno mueve solo los archivos que referencian SUS filas). Orden por
// documento, para que nunca quede una fila apuntando a un archivo que no existe:
//   1. copiar al privado  2. verificar que llegó  3. actualizar la fila  4. borrar el público
// Si algo falla en el medio, el público sigue ahí y la fila no cambió: se puede repetir.

const APLICAR = process.argv.includes('--aplicar');

const cuerpo = async (stream) => Buffer.concat(await stream.toArray());

const run = async () => {
    await db.authenticate();
    const docs = await Documentacion.findAll({
        where: { pertenece: 'provedor', keyName: { [Op.like]: 'documentacion/%' } },
        raw: true
    });
    console.log(`${docs.length} documento(s) de proveedor en el bucket público.`);
    if (!docs.length || !APLICAR) {
        docs.forEach(d => console.log(`   · ${d.keyName}`));
        if (docs.length) console.log('\nNada se movió. Corre con --aplicar para migrarlos.');
        process.exit(0);
    }

    let movidos = 0, fallidos = 0;
    for (const [i, d] of docs.entries()) {
        const extension = d.keyName.split('.').pop();
        const destino = keyDocumento({ carpeta: 'provedores', prefijo: 'doc', idPropietario: d.idPropietario, idx: i, extension });
        try {
            // Las credenciales de un bucket no leen el otro: se descarga del público y se
            // sube al privado (CopyObject entre cuentas de acceso distintas no aplica).
            const origen = await s3Client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: d.keyName }));
            await r2PrivateClient.send(new PutObjectCommand({
                Bucket: R2_PRIVATE_BUCKET, Key: destino, Body: await cuerpo(origen.Body), ContentType: origen.ContentType
            }));
            await r2PrivateClient.send(new HeadObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: destino }));
            await Documentacion.update({ keyName: destino }, { where: { idDocumento: d.idDocumento, keyName: d.keyName } });
            await borrarObjetos([d.keyName]);
            movidos++;
            console.log(`   ✓ ${d.keyName}  →  ${destino}`);
        } catch (e) {
            fallidos++;
            console.error(`   ✗ ${d.keyName}: ${e.name} ${e.message}`);
        }
    }
    console.log(`\nMovidos: ${movidos} · con error: ${fallidos}${fallidos ? ' (se pueden reintentar corriendo de nuevo)' : ''}`);
    process.exit(fallidos ? 1 : 0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
