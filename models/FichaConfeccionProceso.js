import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// El seguimiento de UN taller sobre UNA ficha — nace solo, en 'asignado', apenas se guarda
// un taller en la ficha (controller/fichaConfeccionController.js actualizarFichaConfeccion:
// "si existen confeccionistas en esta hoja, se crea el proceso" — pedido explícito del
// usuario). Uno por FICHAS_CONFECCION_TALLERES (idTaller es UNIQUE), nunca uno por ficha
// entera: dos talleres de la misma ficha avanzan cada uno a su propio ritmo.
//
// Flujo confirmado con el usuario (en ese orden, sin saltos):
//   asignado → entregado_taller → en_revision → entregada
// "asignado" es el taller ya elegido en la ficha (todavía no se le entregó nada físico).
// "entregado_taller" arranca el período de entrega — desde acá el taller puede tener
// novedades (FichaConfeccionProcesoBitacora: "le hizo falta tela", "le hizo falta
// herrajes"...). "en_revision" es un operador verificando calidad. "entregada" es el cierre:
// ya se puede dosificar (Dosificaciones/Pack, un sistema aparte que ya existe — acá solo se
// marca que quedó listo para eso, CLAUDE.md §6).
//
// El estado ACTUAL vive acá (para listar/filtrar sin tener que mirar el historial); fecha,
// cantidad y quién lo marcó en CADA cambio viven en FichaConfeccionProcesoHistorial
// (append-only, mismo patrón que PEDIDOS_WEB_HISTORIAL_ESTADO / PRODUCTOS_CAMBIOS_PRECIO).
const FichaConfeccionProceso = db.define('FICHAS_CONFECCION_PROCESOS', {
    idProceso: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idTaller: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'FICHAS_CONFECCION_TALLERES', key: 'idDetalle' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    estado: {
        type: DataTypes.ENUM('asignado', 'entregado_taller', 'en_revision', 'entregada'),
        allowNull: false,
        defaultValue: 'asignado'
    }
}, {
    tableName: 'FICHAS_CONFECCION_PROCESOS',
    timestamps: true
});

export default FichaConfeccionProceso;
