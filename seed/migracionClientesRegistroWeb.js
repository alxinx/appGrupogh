import dotenv from 'dotenv';
import { ClientesRegistroWeb } from '../models/index.js';
import { correrMigracion } from './tablaAppendOnly.js';

dotenv.config();

// Crea CLIENTES_REGISTRO_WEB —la constancia de cada cliente que se registró solo desde
// grupogh.co/formularios/registroClientes— y la sella como append-only.
//
// Es la prueba de la autorización de tratamiento de datos (Ley 1581): quién, cuándo,
// desde qué IP y sobre qué versión del texto.
//
//   npm run db:migrar-registro-web
//   npm run db:migrar-registro-web -- --sin-sellar   (solo la tabla, sin triggers)
//   npm run db:migrar-registro-web -- --revertir     (solo si la tabla está vacía)
correrMigracion({
    modelo:  ClientesRegistroWeb,
    tabla:   'CLIENTES_REGISTRO_WEB',
    mensaje: 'CLIENTES_REGISTRO_WEB es append-only: una constancia de autorización no se edita ni se elimina.'
});
