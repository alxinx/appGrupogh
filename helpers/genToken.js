import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { COSTO_BCRYPT } from "../models/Usuarios.js";

// La sesión dura 8 h (CLAUDE.md § 5.1). El JWT vence a la misma hora que la cookie: antes
// el token valía 1 día aunque la cookie muriera a las 8 h, así que uno copiado del
// navegador seguía abriendo el panel 16 h después de "vencida" la sesión.
const DURACION_SESION_MS = 1000 * 60 * 60 * 8;
const ALGORITMO_JWT = 'HS256';

const OPCIONES_COOKIE_SESION = {
    httpOnly : true,
    secure   : process.env.COOKIE_SECURE === 'true',
    sameSite : 'strict',
};

const generarJwt = (id) => {
  return jwt.sign(
    { id },
    process.env.APP_PRIVATEKEY,
    { expiresIn: DURACION_SESION_MS / 1000, algorithm: ALGORITMO_JWT }
  );
};

/** Verifica un JWT de sesión aceptando SOLO el algoritmo con que se firma. */
const verificarJwt = (token) => jwt.verify(token, process.env.APP_PRIVATEKEY, { algorithms: [ALGORITMO_JWT] });

// Hash de relleno con el mismo costo que USUARIOS. Se genera una vez al arrancar; su
// contenido no importa, solo que comparar contra él tarde lo mismo que contra uno real.
const hashRelleno = bcrypt.hash('relleno-sin-uso', COSTO_BCRYPT);

/** Gasta el mismo tiempo que una comparación real, para un correo que no tiene cuenta. */
const igualarTiempoBcrypt = async (password) => {
    try { await bcrypt.compare(String(password || ''), await hashRelleno); } catch { /* sin efecto */ }
    return false;
};


export {
    generarJwt, verificarJwt, igualarTiempoBcrypt,
    OPCIONES_COOKIE_SESION, DURACION_SESION_MS
}
