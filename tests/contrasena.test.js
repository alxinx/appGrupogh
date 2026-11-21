import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { prepararBaseDePrueba, cerrarBase } from './bdPrueba.js';
import db from '../config/bd.js';
import sesClient from '../config/ses.js';
import { Usuarios, RecuperacionContrasena } from '../models/index.js';
import {
    validarNuevaContrasena, solicitarRecuperacion, restablecerConToken, cambiarContrasena,
    sincronizarContrasenaInicial, enlaceVigente, hashToken
} from '../helpers/contrasena.js';
import { rutaProtegida } from '../middlewares/authMiddleware.js';

// Recuperar / cambiar contraseña (helpers/contrasena.js). Ningún correo sale de verdad:
// sesClient.send se reemplaza y se guarda lo que se habría enviado.
let enviados = [];
before(async () => {
    await prepararBaseDePrueba();
    sesClient.send = async (cmd) => { enviados.push(cmd.input); return {}; };
});
after(cerrarBase);
beforeEach(() => { enviados = []; });

const nuevoUsuario = (password = '1234567890') => Usuarios.create({
    nombreUsuario: 'Prueba', emailUsuario: `p-${randomUUID().slice(0, 8)}@prueba.test`, password, permisos: 'STORE'
});
const tokenDelCorreo = () => {
    const html = enviados.at(-1).Message.Body.Html.Data;
    return html.match(/\/restablecer\/([A-Za-z0-9_-]{43})/)[1];
};
const ip = '127.0.0.1';

test('reglas de la contraseña nueva', () => {
    const v = (nueva, confirmacion = nueva, email) => validarNuevaContrasena({ nueva, confirmacion, email });
    assert.match(v('abc12'), /al menos 8/);
    assert.match(v('abcdefgh'), /letra y un número/);
    assert.match(v('12345678'), /letra y un número/);
    assert.match(v(' abcd1234'), /espacios/);
    assert.match(v('abcd1234', 'abcd12345'), /no coinciden/);
    assert.match(v('a1@b.co99', 'a1@b.co99', 'A1@B.co99'), /tu correo/);
    assert.match(v('a1' + 'x'.repeat(80)), /demasiado larga/);
    assert.equal(v('Clave2026'), null);
});

test('correo sin cuenta o cuenta bloqueada: no se crea enlace ni sale correo', async () => {
    await solicitarRecuperacion({ correo: 'nadie@prueba.test', ip });
    const bloqueado = await nuevoUsuario();
    await db.query("UPDATE USUARIOS SET password = '0' WHERE idUsuario = ?", { replacements: [bloqueado.idUsuario] });
    await solicitarRecuperacion({ correo: bloqueado.emailUsuario, ip });
    assert.equal(enviados.length, 0);
    assert.equal(await RecuperacionContrasena.count({ where: { idUsuario: bloqueado.idUsuario } }), 0);
});

test('el enlace: solo el hash en la base, diseño de marca, y uno nuevo anula el anterior', async () => {
    const u = await nuevoUsuario();
    await solicitarRecuperacion({ correo: u.emailUsuario.toUpperCase(), ip });
    const t1 = tokenDelCorreo();
    const html = enviados[0].Message.Body.Html.Data;
    assert.equal(enviados[0].Destination.ToAddresses[0], u.emailUsuario);
    assert.ok(html.includes('background:#eef0f4') && html.includes('border-radius:16px'), 'usa la plantilla de la confirmación de pedido');
    const fila = await RecuperacionContrasena.findOne({ where: { idUsuario: u.idUsuario } });
    assert.equal(fila.tokenHash, hashToken(t1));
    assert.ok(!JSON.stringify(fila.toJSON()).includes(t1), 'el token no se guarda');

    await solicitarRecuperacion({ correo: u.emailUsuario, ip });
    const t2 = tokenDelCorreo();
    assert.equal(await enlaceVigente(t1), null, 'el primero quedó anulado');
    assert.ok(await enlaceVigente(t2));
});

test('restablecer: cambia la contraseña, gasta el enlace y fecha el cambio', async () => {
    const u = await nuevoUsuario();
    await solicitarRecuperacion({ correo: u.emailUsuario, ip });
    const token = tokenDelCorreo();

    const malo = await restablecerConToken({ token, nueva: 'corta1', confirmacion: 'corta1', ip });
    assert.match(malo.error, /al menos 8/);
    assert.ok(await enlaceVigente(token), 'un error de validación no gasta el enlace');

    const r = await restablecerConToken({ token, nueva: 'NuevaClave1', confirmacion: 'NuevaClave1', ip });
    assert.equal(r.usuario.idUsuario, u.idUsuario);
    const fresco = await Usuarios.findByPk(u.idUsuario);
    assert.ok(await fresco.checkPassword('NuevaClave1'));
    assert.ok(!(await fresco.checkPassword('1234567890')));
    assert.ok(fresco.passwordCambiadoEn);

    const otra = await restablecerConToken({ token, nueva: 'OtraClave22', confirmacion: 'OtraClave22', ip });
    assert.ok(otra.vencido, 'no se usa dos veces');
});

test('restablecer: enlace vencido o inventado no sirve', async () => {
    const u = await nuevoUsuario();
    await solicitarRecuperacion({ correo: u.emailUsuario, ip });
    const token = tokenDelCorreo();
    await RecuperacionContrasena.update({ expiraEn: new Date(Date.now() - 1000) }, { where: { tokenHash: hashToken(token) } });
    assert.ok((await restablecerConToken({ token, nueva: 'NuevaClave1', confirmacion: 'NuevaClave1', ip })).vencido);
    assert.ok((await restablecerConToken({ token: 'x'.repeat(43), nueva: 'NuevaClave1', confirmacion: 'NuevaClave1', ip })).vencido);
    assert.ok((await restablecerConToken({ token: "' OR 1=1 --", nueva: 'NuevaClave1', confirmacion: 'NuevaClave1', ip })).vencido);
});

test('restablecer: dos envíos a la vez, solo uno gana', async () => {
    const u = await nuevoUsuario();
    await solicitarRecuperacion({ correo: u.emailUsuario, ip });
    const token = tokenDelCorreo();
    const rs = await Promise.all(['ClaveUno111', 'ClaveDos222'].map(n => restablecerConToken({ token, nueva: n, confirmacion: n, ip })));
    assert.equal(rs.filter(r => r.usuario).length, 1);
    assert.equal(rs.filter(r => r.vencido).length, 1);
});

test('cambiar con la sesión abierta exige la actual y una distinta', async () => {
    const u = await nuevoUsuario('Actual2026');
    assert.ok((await cambiarContrasena({ idUsuario: u.idUsuario, actual: 'mala', nueva: 'Nueva2026x', confirmacion: 'Nueva2026x' })).actualMal);
    assert.match((await cambiarContrasena({ idUsuario: u.idUsuario, actual: 'Actual2026', nueva: 'Actual2026', confirmacion: 'Actual2026' })).error, /distinta/);
    const r = await cambiarContrasena({ idUsuario: u.idUsuario, actual: 'Actual2026', nueva: 'Nueva2026x', confirmacion: 'Nueva2026x' });
    assert.ok(r.usuario);
    assert.ok(await (await Usuarios.findByPk(u.idUsuario)).checkPassword('Nueva2026x'));
});

test('corregir el documento mueve la contraseña inicial, pero no una que la persona ya cambió', async () => {
    const inicial = await nuevoUsuario('1036000001');
    const cambio = await db.transaction(transaction => sincronizarContrasenaInicial({
        idUsuario: inicial.idUsuario, documentoAnterior: '1036000001', documentoNuevo: '1036000002', transaction
    }));
    assert.equal(cambio, true);
    assert.ok(await (await Usuarios.findByPk(inicial.idUsuario)).checkPassword('1036000002'));

    const propia = await nuevoUsuario('MiClave2026');
    const cambio2 = await db.transaction(transaction => sincronizarContrasenaInicial({
        idUsuario: propia.idUsuario, documentoAnterior: '1036000003', documentoNuevo: '1036000004', transaction
    }));
    assert.equal(cambio2, false);
    assert.ok(await (await Usuarios.findByPk(propia.idUsuario)).checkPassword('MiClave2026'));
});

test('una sesión abierta antes del cambio de contraseña deja de valer', async () => {
    const u = await nuevoUsuario();
    const firmar = (iat) => jwt.sign({ id: { id: u.idUsuario }, iat }, process.env.APP_PRIVATEKEY, { algorithm: 'HS256', expiresIn: 3600 });
    const correr = async (token) => {
        let redirigido = null, siguio = false;
        const res = { redirect: (url) => { redirigido = url; }, clearCookie() {}, set() {}, locals: {} };
        await rutaProtegida({ cookies: { _token: token } }, res, () => { siguio = true; });
        return { redirigido, siguio };
    };
    const ahora = Math.floor(Date.now() / 1000);
    await Usuarios.update({ passwordCambiadoEn: new Date(ahora * 1000) }, { where: { idUsuario: u.idUsuario }, hooks: false });
    assert.deepEqual(await correr(firmar(ahora - 60)), { redirigido: '/', siguio: false });
    assert.deepEqual(await correr(firmar(ahora)), { redirigido: null, siguio: true });
});
