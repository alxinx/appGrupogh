import dotenv from 'dotenv';
import { ProductosCambiosPrecio } from '../models/index.js';
import { correrMigracion } from './tablaAppendOnly.js';

dotenv.config();

// Crea PRODUCTOS_CAMBIOS_PRECIO —la bitácora de los cambios de precio en bloque— y la sella
// como append-only: un historial de precios que se puede editar no prueba nada.
//
//   npm run db:migrar-cambios-precio
//   npm run db:migrar-cambios-precio -- --sin-sellar
//   npm run db:migrar-cambios-precio -- --revertir   (solo si la tabla está vacía)
correrMigracion({
    modelo:  ProductosCambiosPrecio,
    tabla:   'PRODUCTOS_CAMBIOS_PRECIO',
    mensaje: 'PRODUCTOS_CAMBIOS_PRECIO es append-only: un cambio de precio registrado no se edita ni se elimina.'
});
