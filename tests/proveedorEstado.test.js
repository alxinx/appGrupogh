import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prepararBaseDePrueba, cerrarBase, crearEmpleadoConUsuario } from './bdPrueba.js';
import db from '../config/bd.js';
import { Provedores, ProvedorEstado } from '../models/index.js';
import { cambiarEstadoProveedor, exigirProveedorActivo } from '../helpers/proveedores.js';
import { validarCabeceraOrden } from '../helpers/ordenesCompra.js';
import { migrarTablaAppendOnly } from '../seed/tablaAppendOnly.js';

// Suspender un proveedor (decidido con el dueño el 2026-11-23): motivo obligatorio,
// constancia append-only, y un suspendido no recibe órdenes de compra nuevas ni abonos.

let usuario, proveedor;

before(async () => {
    await prepararBaseDePrueba();
    // El clon no trae triggers: se sella con la misma migración de producción.
    await migrarTablaAppendOnly({ modelo: ProvedorEstado, tabla: 'PROVEDORES_ESTADOS', mensaje: 'PROVEDORES_ESTADOS es append-only: no se edita ni se borra.', argv: [] });
    const { idUsuario } = await crearEmpleadoConUsuario();
    usuario = { idUsuario, nombre: 'Prueba Estado' };
    proveedor = await Provedores.create({
        razonSocial: 'Textiles de Prueba', tipoDocumento: 'NIT', taxIdSupplier: String(Date.now()).slice(-10),
        nombreContacto: 'Contacto', direccionProvedor: 'Calle 1', emailProvedor: `p${randomUUID().slice(0, 8)}@prueba.co`,
        ciudad: '05001', departamento: '05'
    });
});
after(cerrarBase);

const cambiar = (suspender, motivo = 'Entregas incumplidas') =>
    db.transaction((t) => cambiarEstadoProveedor({ idProveedor: proveedor.idProveedor, suspender, motivo, usuario }, t));

test('suspender pide motivo, cambia el estado y deja constancia', async () => {
    await assert.rejects(cambiar(true, '  '), /motivo/);
    await cambiar(true);
    assert.equal((await Provedores.findByPk(proveedor.idProveedor)).estado, false);
    const [c] = await ProvedorEstado.findAll({ where: { idProveedor: proveedor.idProveedor }, raw: true });
    assert.equal(c.accion, 'suspendido');
    assert.equal(c.motivo, 'Entregas incumplidas');
    assert.equal(c.nombreUsuario, 'Prueba Estado');
    // Suspenderlo otra vez es un 409, no una segunda constancia.
    await assert.rejects(cambiar(true), (e) => e.status === 409);
    assert.equal(await ProvedorEstado.count({ where: { idProveedor: proveedor.idProveedor } }), 1);
});

test('un suspendido no recibe órdenes de compra ni abonos', async () => {
    const { errores = {} } = await validarCabeceraOrden({ tipo: 'orden_compra', idProveedores: [proveedor.idProveedor], fechaOrden: '2026-11-23' });
    assert.match(errores.idProveedores, /suspendido/);
    await assert.rejects(exigirProveedorActivo(proveedor.idProveedor), (e) => e.status === 409);
});

test('reactivar lo devuelve a activo y deja su constancia', async () => {
    await cambiar(false, 'Ya cumplió');
    assert.equal((await Provedores.findByPk(proveedor.idProveedor)).estado, true);
    await exigirProveedorActivo(proveedor.idProveedor);
    const { errores = {} } = await validarCabeceraOrden({ tipo: 'orden_compra', idProveedores: [proveedor.idProveedor], fechaOrden: '2026-11-23' });
    assert.equal(errores.idProveedores, undefined);
    assert.deepEqual((await ProvedorEstado.findAll({ where: { idProveedor: proveedor.idProveedor }, order: [['idRegistro', 'ASC']], raw: true })).map(c => c.accion), ['suspendido', 'reactivado']);
});

test('la bitácora de estados no se edita ni se borra', async () => {
    const fila = await ProvedorEstado.findOne({ where: { idProveedor: proveedor.idProveedor } });
    await assert.rejects(() => db.query('UPDATE PROVEDORES_ESTADOS SET motivo = "x" WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
    await assert.rejects(() => db.query('DELETE FROM PROVEDORES_ESTADOS WHERE idRegistro = :id', { replacements: { id: fila.idRegistro } }), /append-only/);
});
