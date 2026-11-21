import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Recuperar y cambiar contraseña. Todo ADITIVO: no modifica ni borra ninguna fila existente.
//
//   USUARIOS                 + passwordCambiadoEn (NULL en todas las filas que ya existen)
//   USUARIOS_RECUPERACION    nueva: un enlace de recuperación por fila, solo el hash del token
//
//   npm run db:migrar-recuperar-contrasena
//   npm run db:migrar-recuperar-contrasena -- --revertir
//
// Idempotente: cada paso revisa si ya está hecho.
//
// passwordCambiadoEn cierra las sesiones abiertas con la contraseña vieja (authMiddleware):
// un JWT emitido antes de esa fecha deja de valer. En NULL no cierra ninguna, así que las
// filas que ya existen siguen con sus sesiones tal como están.

const REVERTIR = process.argv.includes('--revertir');

const uno = async (sql, replacements = {}) => (await db.query(sql, { replacements, type: QueryTypes.SELECT }))[0];
const existeTabla = async (t) => (await uno(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`, { t })).n > 0;
const columna = (t, c) => uno(
    `SELECT COLLATION_NAME coll FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`, { t, c });

export async function migrarRecuperarContrasena() {
    if (await columna('USUARIOS', 'passwordCambiadoEn')) console.log('· USUARIOS.passwordCambiadoEn ya existe');
    else {
        await db.query('ALTER TABLE USUARIOS ADD COLUMN passwordCambiadoEn DATETIME NULL AFTER password');
        console.log('✓ USUARIOS.passwordCambiadoEn agregada');
    }

    if (await existeTabla('USUARIOS_RECUPERACION')) { console.log('· USUARIOS_RECUPERACION ya existe'); return; }
    // La FK tiene que usar la misma collation que USUARIOS.idUsuario.
    const coll = (await columna('USUARIOS', 'idUsuario'))?.coll;
    if (!coll) throw new Error('No se pudo leer la collation de USUARIOS.idUsuario');
    await db.query(`
        CREATE TABLE USUARIOS_RECUPERACION (
            idRecuperacion CHAR(36) CHARACTER SET utf8mb4 COLLATE ${coll} NOT NULL,
            idUsuario CHAR(36) CHARACTER SET utf8mb4 COLLATE ${coll} NOT NULL,
            tokenHash CHAR(64) NOT NULL,
            estado ENUM('pendiente','usado','anulado') NOT NULL DEFAULT 'pendiente',
            expiraEn DATETIME NOT NULL,
            usadoEn DATETIME NULL,
            ipSolicitud VARCHAR(64) NULL,
            ipUso VARCHAR(64) NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            PRIMARY KEY (idRecuperacion),
            UNIQUE KEY usuarios_recuperacion_token (tokenHash),
            INDEX usuarios_recuperacion_usuario_idx (idUsuario, estado),
            CONSTRAINT usuarios_recuperacion_usuario_fk FOREIGN KEY (idUsuario) REFERENCES USUARIOS(idUsuario) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('✓ USUARIOS_RECUPERACION creada');
}

const revertir = async () => {
    // Los enlaces son de un solo uso y vencen en minutos: borrar la tabla no pierde nada de valor.
    if (await existeTabla('USUARIOS_RECUPERACION')) { await db.query('DROP TABLE USUARIOS_RECUPERACION'); console.log('✓ USUARIOS_RECUPERACION eliminada'); }
    if (await columna('USUARIOS', 'passwordCambiadoEn')) { await db.query('ALTER TABLE USUARIOS DROP COLUMN passwordCambiadoEn'); console.log('✓ USUARIOS.passwordCambiadoEn eliminada'); }
};

if (process.argv[1]?.endsWith('migracionRecuperarContrasena.js')) {
    (async () => {
        await db.authenticate();
        if (REVERTIR) await revertir(); else await migrarRecuperarContrasena();
        console.log('\nListo.');
        process.exit(0);
    })().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
}
