import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const ClientesTributario = db.define('CLIENTES_TRIBUTARIO', {
    idClienteTributario: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    idCliente: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'CLIENTES', key: 'idCliente' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    regimen_fiscal: {
        type: DataTypes.STRING(2),
        allowNull: false,
        comment: '48=Responsable IVA, 49=No responsable IVA'
    },

    // Códigos de responsabilidad fiscal de la DIAN, separados por coma: "O-13,O-15".
    //
    // Varias pueden aplicar a la vez, por eso una cadena y no un solo valor. Nulo significa
    // "todavía no se declaró", que es distinto de R-99-PN, que es declarar que no aplica
    // ninguna. Esa diferencia importa: lo primero es un dato faltante, lo segundo es un
    // dato.
    //
    // No se derivan de `gran_contribuyente` y compañía aunque se parezcan: esas casillas
    // son del formulario de la tienda y estos códigos son lo que la DIAN valida contra el
    // RUT. Deducir uno del otro sería inventar un dato que después se factura.
    responsabilidad_fiscal: {
        type: DataTypes.STRING(60),
        allowNull: true
    },
    gran_contribuyente: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    autorretenedor: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    agente_retencion: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    obligado_aduanero: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    ciiu: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    descripcion_ciiu: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    fecha_rut: {
        type: DataTypes.DATEONLY,
        allowNull: true
    }
}, {
    tableName: 'CLIENTES_TRIBUTARIO',
    timestamps: true
});

export default ClientesTributario;
