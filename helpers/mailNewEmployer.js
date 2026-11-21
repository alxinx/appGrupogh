import dotenv from 'dotenv';
import { PORTAL_URL, NOMBRE_EMPRESA } from '../config/marca.js';
import { plantillaMarca, ICONO_CORREO, filaCorreo, tarjetaCorreo, datosCorreo, parrafoCorreo, botonCorreo } from './plantillaCorreo.js';
import { escaparHtml } from '../src/js/escaparHtml.js';
import { enviarCorreoSes, REMITENTE_EMPLEADOS } from './emailSes.js';
dotenv.config();

// Bienvenida a un empleado nuevo: sus credenciales de acceso y su código de vendedor.
// Sale por SES como el resto del correo del proyecto (helpers/emailSes.js) — antes abría
// su propio transporte SMTP con nodemailer.
//
// Devuelve true/false y nunca lanza: en adminControllers.js se llama sin await (el alta
// del empleado ya está confirmada cuando esto corre), y una promesa rechazada ahí era una
// unhandled rejection.
const mailWelcomeEmployer = async (datos) => {
    const { emailEmpleado, PrimerNombre, codigoEmpleado } = datos;

    const url = `${PORTAL_URL}/`;

    const texto = `Hola ${PrimerNombre}, te damos la bienvenida a ${NOMBRE_EMPRESA}.\n\n`
        + `Usuario: ${emailEmpleado}\n`
        + `Contraseña: tu número de identidad\n`
        + `Código de vendedor: ${codigoEmpleado}\n\n`
        + `Tu código es personal e intransferible: con él se registran tus ventas y traslados.\n`
        + `Ingresa en ${url}`;

    // Diseño de marca (plantillaMarca, el de la confirmación de pedido). El logo lo pone la
    // plantilla desde el sitio público: un cliente de correo tiene que poder resolverlo.
    const filasHtml = [
        filaCorreo(tarjetaCorreo({
            titulo: '&#128274; Tus credenciales de acceso',
            html: datosCorreo([
                ['Usuario', escaparHtml(emailEmpleado)],
                ['Contraseña', 'Tu número de identidad'],
                ['Código de vendedor', `<span style="color:#E24C95;font-size:16px;">${escaparHtml(codigoEmpleado)}</span>`]
            ])
        })),
        filaCorreo(parrafoCorreo('Tu código es <strong>personal e intransferible</strong>: con él se registran tus ventas y traslados. Cuando entres, cambia tu contraseña en el menú → <strong>Cambiar contraseña</strong>.')),
        filaCorreo(botonCorreo(url, 'Acceder a mi portal'), { arriba: 24 })
    ].join('');

    const html = plantillaMarca({
        icono: { simbolo: '&#127881;', ...ICONO_CORREO.marca },
        titulo: "¡Bienvenido a la familia Grupo GH!",
        saludo: `Hola ${escaparHtml(PrimerNombre)} &#128075;`,
        intro: 'Estamos encantados de tenerte con nosotros. Aquí tienes cómo entrar al sistema.',
        filasHtml,
        despedida: 'Bienvenido al equipo &#128156;'
    });

    return enviarCorreoSes({
        remitente: REMITENTE_EMPLEADOS,
        destinatario: emailEmpleado,
        asunto: `Bienvenido ${PrimerNombre} a nuestra familia`,
        texto,
        html,
        contexto: 'bienvenida-empleado'
    });
};

export { mailWelcomeEmployer };
