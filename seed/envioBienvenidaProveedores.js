import dotenv from 'dotenv';
import db from '../config/bd.js';
import { Provedores, CategoriasDeProvedores, ProvedoresCuentasBancarias, ProvedoresRegistroWeb, Documentacion } from '../models/index.js';
import { mailBienvenidaProveedor } from '../helpers/mailBienvenidaProveedor.js';

dotenv.config();

// Backfill del correo de bienvenida (helpers/mailBienvenidaProveedor.js) para los
// proveedores que se registraron por la web ANTES de que registroProveedorWebController.js
// empezara a mandarlo (nadie lo había recibido todavía).
//
//   npm run db:enviar-bienvenida-proveedores             → solo muestra a quién le llegaría
//   npm run db:enviar-bienvenida-proveedores -- --aplicar → lo envía de verdad
//
// --solo=correo1@x.com,correo2@x.com → reintentar solo esos proveedores puntuales (ej. los
// que fallaron en una corrida anterior) en vez de los registrados por la web. Combinable con
// --aplicar: npm run db:enviar-bienvenida-proveedores -- --aplicar --solo=correo1@x.com
//
// Solo a los que se registraron SOLOS por grupogh.co/formularios/registroProvedores
// (tienen fila en PROVEDORES_REGISTRO_WEB): el correo dice "Gracias por registrarte" y les
// recuerda su usuario/contraseña, y eso no tiene sentido para un proveedor que dio de alta
// un empleado desde el panel — decisión tomada con el usuario.
//
// Ritmo de envío: el mismo límite que ya gobierna la cola de SES (SES_RATE_LIMIT_PER_SEC,
// helpers/colaEmailProducto.js) — no un número aparte inventado acá.
const APLICAR = process.argv.includes('--aplicar');
const argSolo = process.argv.find(a => a.startsWith('--solo='));
const SOLO = argSolo
    ? new Set(argSolo.slice('--solo='.length).split(',').map(e => e.trim().toLowerCase()).filter(Boolean))
    : null;
const POR_SEGUNDO = parseInt(process.env.SES_RATE_LIMIT_PER_SEC) || 1;
const ESPERA_MS = Math.ceil(1000 / POR_SEGUNDO);

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
    await db.authenticate();

    const proveedores = await Provedores.findAll({
        include: [
            { model: ProvedoresRegistroWeb, as: 'registrosWeb', required: true, attributes: [] },
            { model: CategoriasDeProvedores, as: 'categorias' },
            { model: ProvedoresCuentasBancarias, as: 'cuentasBancarias' }
        ],
        order: [['createdAt', 'ASC']]
    });

    console.log(`${proveedores.length} proveedor(es) registrados por la web.`);

    const aProcesar = SOLO ? proveedores.filter(p => SOLO.has(String(p.emailProvedor).trim().toLowerCase())) : proveedores;
    if (SOLO) console.log(`--solo: ${aProcesar.length} de ${SOLO.size} correo(s) pedidos coinciden con un proveedor registrado por la web.`);
    if (!aProcesar.length) { process.exit(0); }

    if (!APLICAR) {
        aProcesar.forEach(p => console.log(`   · ${p.razonSocial} <${p.emailProvedor}>`));
        console.log('\nNada se envió. Corre con --aplicar para mandar los correos.');
        process.exit(0);
    }

    let enviados = 0, fallidos = 0;
    for (const p of aProcesar) {
        const documentos = await Documentacion.findAll({
            where: { idPropietario: p.idProveedor, pertenece: 'provedor' },
            attributes: ['nombreDocumento', 'formato', 'keyName'],
            raw: true
        });

        try {
            const ok = await mailBienvenidaProveedor({
                razonSocial: p.razonSocial,
                emailProveedor: p.emailProvedor,
                tipoDocumento: p.tipoDocumento,
                taxIdSupplier: p.taxIdSupplier,
                fechaRegistro: p.createdAt,
                categorias: p.categorias.map(c => c.nombre),
                cuentas: p.cuentasBancarias,
                documentos
            });
            if (ok) { enviados++; console.log(`   ✓ ${p.razonSocial} <${p.emailProvedor}>`); }
            else { fallidos++; console.log(`   ✗ ${p.razonSocial} <${p.emailProvedor}> — enviarCorreoSes devolvió false`); }
        } catch (e) {
            fallidos++;
            console.error(`   ✗ ${p.razonSocial} <${p.emailProvedor}>: ${e.message}`);
        }

        await dormir(ESPERA_MS);
    }

    console.log(`\nEnviados: ${enviados} · con error: ${fallidos}${fallidos ? ' (se pueden reintentar corriendo de nuevo)' : ''}`);
    process.exit(fallidos ? 1 : 0);
};

run().catch((e) => { console.error('Envío fallido:', e); process.exit(1); });
