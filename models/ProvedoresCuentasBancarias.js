import { DataTypes } from 'sequelize';
import db from '../config/bd.js';

// Cuentas bancarias de un proveedor: a dónde se le paga.
//
// Un proveedor puede tener varias (una de Bancolombia y un Nequi, por ejemplo) y una sola es
// la principal. El banco sale del catálogo src/json/entidadesFinancieras.json
// (helpers/catalogos.js). Si la cuenta está a nombre de otra persona —el dueño de la
// empresa—, se guardan su nombre y documento; si no, el titular es el mismo proveedor.
//
// paranoid: al editar un proveedor sus cuentas se reemplazan, y las anteriores quedan
// borradas lógicamente. Así se puede saber a qué cuenta se le pagaba antes.
const ProvedoresCuentasBancarias = db.define('PROVEDORES_CUENTAS_BANCARIAS', {
    idCuentaBancaria: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    idProveedor: {
        type: DataTypes.UUID,
        allowNull: false
    },
    codigoEntidadFinanciera: {
        type: DataTypes.STRING(40),
        allowNull: false
    },
    tipoCuenta: {
        type: DataTypes.ENUM('ahorros', 'corriente', 'deposito_electronico', 'llave_breb'),
        allowNull: false
    },
    // Solo en una llave Bre-B: qué es la llave. Define su formato (helpers/catalogos.js).
    tipoLlaveBreb: {
        type: DataTypes.ENUM('celular', 'documento', 'correo', 'alfanumerica', 'comercio'),
        allowNull: true
    },
    // Número de la cuenta, el celular de una billetera o la llave Bre-B (un correo puede
    // llegar a 100 caracteres).
    numeroCuenta: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    // Titular distinto del proveedor. Los tres van juntos: o están todos o ninguno.
    titular: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    // Sin TI: un menor de edad no puede ser titular de la cuenta de un proveedor.
    tipoDocumentoTitular: {
        type: DataTypes.ENUM('CC', 'CE', 'NIT', 'PP', 'PPT', 'PEP'),
        allowNull: true
    },
    documentoTitular: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    principal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    // De dónde llegó: la cargó alguien del panel o el proveedor desde el registro web.
    origen: {
        type: DataTypes.ENUM('panel', 'web'),
        allowNull: false,
        defaultValue: 'panel'
    },
    // Una cuenta que dio el propio proveedor por internet no se da por buena hasta que
    // alguien del panel la confirma (certificación bancaria, llamada). La que carga el panel
    // queda verificada por quien la cargó. Ver helpers/proveedores.js.
    verificada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    idUsuarioVerifico: {
        type: DataTypes.UUID,
        allowNull: true
    },
    fechaVerificacion: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'PROVEDORES_CUENTAS_BANCARIAS',
    timestamps: true,
    paranoid: true
});

export default ProvedoresCuentasBancarias;
