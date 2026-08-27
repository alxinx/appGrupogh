import jwt from "jsonwebtoken";

// Token de un solo propósito ("dar de baja este interés puntual"), nada que ver con la
// sesión — pero reutiliza jsonwebtoken + APP_PRIVATEKEY porque ya es el secreto de firma
// del proyecto (helpers/genToken.js lo usa igual para el login), no uno nuevo que
// gestionar. Vida larga: nadie hace clic en "date de baja" el mismo día que le llega el
// correo de "producto disponible".
export function generarTokenBaja(idInteres) {
    return jwt.sign({ idInteres, accion: 'baja-interesado' }, process.env.APP_PRIVATEKEY, { expiresIn: '1y' });
}

// Lanza si el token es inválido, expiró, o no es de este propósito — el controlador lo
// atrapa y responde el mismo mensaje genérico para cualquier caso.
export function idInteresDeTokenBaja(token) {
    const payload = jwt.verify(token, process.env.APP_PRIVATEKEY);
    if (payload.accion !== 'baja-interesado' || !payload.idInteres) throw new Error('Token no es de baja de interesado');
    return payload.idInteres;
}
