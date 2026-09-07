import dotenv from 'dotenv';
import { COLORES_CORREO as C, LOGO_URL, PORTAL_URL, NOMBRE_EMPRESA, DIRECCION_EMPRESA } from '../config/marca.js';
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

    // El logo se toma del sitio público (LOGO_URL), no de este backend: un cliente de
    // correo tiene que poder resolver la URL desde afuera de la red del servidor.
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <style>
        /* Estilos base para clientes que soportan bloques de estilo */
        body { margin: 0; padding: 0; font-family: 'Helvetica', Arial, sans-serif; background-color: #f9fafb; color: #334155; }
        .btn-shadow { box-shadow: 0 4px 14px 0 rgba(255, 94, 170, 0.39); }
    </style>
</head>
<body style="background-color: #f9fafb; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; bg-color: #ffffff; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
        
        <div style="background-color: ${C.primarySoft}; padding: 30px; text-align: center;">
            <img src="${LOGO_URL}" alt="Grupo GH" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #ffffff;">
        </div>

        <div style="width: 100%; height: 200px; overflow: hidden;">
            <img src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&h=200" alt="Moda GH" style="width: 100%; height: 100%; object-fit: cover;">
        </div>

        <div style="padding: 40px;">
            <h1 style="color: ${C.primary}; font-size: 28px; margin-bottom: 10px; text-align: center;">¡Bienvenido a la familia Grupo GH!</h1>
            <p style="text-align: center; color: #64748b; font-size: 16px;">Estamos encantados de tenerte con nosotros.</p>
            
            <div style="margin-top: 30px; font-size: 16px; line-height: 1.6;">
                <p style="font-weight: bold; font-size: 18px;">Hola, ${PrimerNombre},</p>
                <p>Es un placer darte la bienvenida oficial a <strong>${NOMBRE_EMPRESA}</strong>. Te unes a un equipo apasionado por la moda y la innovación.</p>
            </div>

            <div style="background-color: ${C.primarySoft}; border: 1px solid #fce7f3; border-radius: 16px; padding: 25px; margin: 30px 0;">
                <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">🔒 Tus Credenciales de Acceso</h2>
                
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #fbcfe8; font-size: 14px; color: #64748b;">USUARIO</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #fbcfe8; text-align: right; font-weight: bold;">${emailEmpleado}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #fbcfe8; font-size: 14px; color: #64748b;">CONTRASEÑA</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #fbcfe8; text-align: right; font-weight: bold;">Tu número de identidad</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; font-size: 14px; color: #64748b;">CÓDIGO VENDEDOR</td>
                        <td style="padding: 10px 0; text-align: right; color: ${C.primary}; font-weight: bold; font-size: 18px;">${codigoEmpleado}</td>
                    </tr>
                </table>

                <div style="background-color: rgba(255,255,255,0.6); padding: 15px; border-radius: 10px; margin-top: 15px; font-size: 13px; color: #475569;">
                    <strong>Asignación: Ventas Online.</strong> Tu código es personal e intransferible para registrar tus ventas y traslados.
                </div>
            </div>

            <div style="text-align: center; margin-top: 40px;">
                <a href="${url}" style="background-color: ${C.primary}; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                    Acceder a mi Portal
                </a>
            </div>
        </div>

        <div style="background-color: #f8fafc; padding: 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            <p style="font-weight: bold; color: #1e293b; margin-bottom: 5px;">${NOMBRE_EMPRESA}</p>
            <p>${DIRECCION_EMPRESA}</p>
            <p style="margin-top: 20px; font-size: 10px; line-height: 1.5;">
                Este es un mensaje automático. La información contenida es confidencial para uso exclusivo de empleados de Grupo GH.
            </p>
        </div>
    </div>
</body>
</html>`;

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
