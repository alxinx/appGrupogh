import { correrMigracion } from './tablaAppendOnly.js';
import { ProvedorEstado } from '../models/index.js';

// Bitácora de suspensiones y reactivaciones de proveedores (models/ProvedorEstado.js).
// Aditiva e idempotente; append-only con triggers.
//
//   npm run db:migrar-proveedor-estados
//   node ./seed/migracionProveedorEstados.js --revertir   (solo si está vacía)
correrMigracion({
    modelo: ProvedorEstado,
    tabla: 'PROVEDORES_ESTADOS',
    mensaje: 'PROVEDORES_ESTADOS es append-only: no se edita ni se borra.'
});
