import { correrMigracion } from './tablaAppendOnly.js';
import { FichaConfeccionEstado } from '../models/index.js';

// Bitácora de anulaciones, reactivaciones y borrados de fichas de confección
// (models/FichaConfeccionEstado.js). Aditiva e idempotente; append-only con triggers.
//
//   npm run db:migrar-ficha-estados
//   node ./seed/migracionFichaConfeccionEstados.js --revertir   (solo si está vacía)
correrMigracion({
    modelo: FichaConfeccionEstado,
    tabla: 'FICHAS_CONFECCION_ESTADOS',
    mensaje: 'FICHAS_CONFECCION_ESTADOS es append-only: no se edita ni se borra.'
});
