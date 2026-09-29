import dotenv from 'dotenv';
import { ProvedoresRegistroWeb } from '../models/index.js';
import { correrMigracion } from './tablaAppendOnly.js';

dotenv.config();

// Crea PROVEDORES_REGISTRO_WEB —la constancia de cada proveedor que se registró solo desde
// grupogh.co/formularios/registroProvedores— y la sella como append-only. Mismo criterio
// que CLIENTES_REGISTRO_WEB.
//
//   npm run db:migrar-registro-web-proveedores
//   npm run db:migrar-registro-web-proveedores -- --sin-sellar
//   npm run db:migrar-registro-web-proveedores -- --revertir   (solo si la tabla está vacía)
correrMigracion({
    modelo:  ProvedoresRegistroWeb,
    tabla:   'PROVEDORES_REGISTRO_WEB',
    mensaje: 'PROVEDORES_REGISTRO_WEB es append-only: una constancia de autorización no se edita ni se elimina.'
});
