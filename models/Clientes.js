import { DataTypes } from "sequelize";
import db from "../config/bd.js";

const Clientes = db.define('CLIENTES', {
    idCliente: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    tipo_persona: {
        type: DataTypes.CHAR(1),
        allowNull: false,
        comment: 'N=Natural, J=Jurídica'
    },
    // Mismo set de valores que EMPLEADOS.TipoDocumento (ENUM) salvo PEP — antes era
    // VARCHAR sin restricción y en snake_case, dos inconsistencias con la tabla que
    // representa exactamente el mismo dato. Nombre en camelCase (la convención real del
    // proyecto), no el PascalCase legado de EMPLEADOS. Ver
    // seed/migracionClientesTipoDocumento.js y seed/migracionClientesPep.js.
    //
    // PEP (Permiso Especial de Permanencia) es SOLO de CLIENTES a propósito — EMPLEADOS
    // no lo lleva.
    tipoDocumento: {
        type: DataTypes.ENUM('CC', 'CE', 'TI', 'NIT', 'PP', 'PPT', 'PEP'),
        allowNull: false,
        defaultValue: 'CC'
    },
    numero_doc: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    digito_verif: {
        type: DataTypes.CHAR(1),
        allowNull: true
    },
    razon_social: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    primer_nombre: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    segundo_nombre: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    primer_apellido: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    segundo_apellido: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    email: {
        type: DataTypes.STRING(150),
        allowNull: true,
        validate: {
            isEmail: { msg: "Debe ser un correo electrónico válido" }
        }
    },
    telefono: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    genero: {
        type: DataTypes.CHAR(1),
        allowNull: true,
        comment: 'M=Masculino, F=Femenino, O=Otro'
    },
    activo: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    credito: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull : false
    },
    // Cupo de crédito del cliente. Ya existía como columna en la base (decimal(12,2),
    // default 0) pero nadie la había modelado — ningún controlador la leía ni escribía
    // por Sequelize. DECIMAL porque es dinero, nunca FLOAT (CLAUDE.md §"Datos
    // financieros"); se mantiene en (12,2), el tamaño real de la columna, sin migrar a
    // (15,2) sin que se haya pedido.
    valorCredito: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
            min: { args: [0], msg: 'El valor del crédito no puede ser negativo.' }
        }
    }
}, {
    tableName: 'CLIENTES',
    timestamps: true
});

export default Clientes;
