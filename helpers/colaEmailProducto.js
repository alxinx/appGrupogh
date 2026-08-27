import { Queue, Worker } from "bullmq";
import dotenv from "dotenv";
import { sendProductAvailableNotification } from "./emailSes.js";
import { generarTokenBaja } from "./bajaInteresados.js";
dotenv.config();

// Mismo patrón que helpers/mailNewEmployer.js para armar una URL absoluta hacia este
// mismo backend (acá el endpoint de baja vive en la API, no en el sitio público).
const API_BASE_URL = `${process.env.APP_URL}:${process.env.APP_PORT}`;

// Único caso de los tres que puede disparar MUCHOS envíos a la vez (todos los que
// pidieron el mismo producto agotado) — por eso es el único que pasa por una cola en
// vez de mandar los SendEmailCommand en paralelo sin control, cosa que un sendEmail
// masivo dispararía por encima del rate limit de SES (throttling / posible suspensión
// de la identidad de envío).
const NOMBRE_COLA = "notificaciones-producto-disponible";

// SES cobra por segundo, no por lote. Default en 1/seg porque la identidad todavía está
// en modo sandbox de AWS (acceso de producción sin aprobar) — el límite real ahí es 1
// mensaje/seg. Cuando AWS apruebe el acceso de producción, subir SES_RATE_LIMIT_PER_SEC
// en .env al límite que asigne la consola de SES (columna "Rate" en Sending statistics) —
// no hace falta tocar este archivo.
const SES_RATE_LIMIT_PER_SEC = parseInt(process.env.SES_RATE_LIMIT_PER_SEC) || 1;

// Redis no está instalado/provisto hoy en el proyecto (ver CLAUDE.md) — esta es la
// primera pieza que lo necesita. Sin REDIS_HOST configurado, la cola queda desactivada
// y encolarNotificacionesProducto() solo loguea, en vez de tirar `ioredis` en un loop
// de reconexión contra un host que no existe.
const REDIS_CONFIGURADO = !!process.env.REDIS_HOST;

const conexionRedis = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
};

export const colaEmailProducto = REDIS_CONFIGURADO ? new Queue(NOMBRE_COLA, { connection: conexionRedis }) : null;

if (REDIS_CONFIGURADO) {
    // El worker vive en el mismo proceso Express — este proyecto no tiene infraestructura
    // de workers separada (mismo criterio que el setInterval de traslados expirados en
    // index.js). `limiter` es lo que hace respetar el rate limit de SES: como mucho
    // SES_RATE_LIMIT_PER_SEC jobs por segundo, sin importar cuántos haya encolados.
    const worker = new Worker(NOMBRE_COLA, async (job) => {
        const { to, nombreProducto, urlProducto, urlBaja } = job.data;
        const enviado = await sendProductAvailableNotification({ to, nombreProducto, urlProducto, urlBaja });
        // sendProductAvailableNotification nunca lanza (ver helpers/emailSes.js) — acá SÍ
        // se relanza el fallo para que BullMQ lo cuente como job fallido y lo reintente
        // con backoff, en vez de darlo por enviado silenciosamente.
        if (!enviado) throw new Error(`No se pudo enviar la notificación a ${to}`);
    }, {
        connection: conexionRedis,
        limiter: { max: SES_RATE_LIMIT_PER_SEC, duration: 1000 }
    });

    worker.on("failed", (job, err) => {
        console.error(`[cola-email-producto] job ${job?.id} (${job?.data?.to}) falló: ${err.message}`);
    });
} else {
    console.warn(
        "[cola-email-producto] REDIS_HOST no configurado — la cola de notificaciones de " +
        "producto disponible está desactivada. Definí REDIS_HOST/REDIS_PORT en .env para activarla."
    );
}

// Punto de entrada: uno o varios destinatarios que pidieron el mismo producto agotado.
// destinatarios es [{ to, idInteres }] — idInteres es la fila de INTERESADOS que originó
// el aviso (helpers/bajaInteresados.js la necesita para armar el link de baja de ESE
// interés puntual, no de todos los productos que la persona haya pedido).
// No manda nada directo — encola un job por destinatario y el worker de arriba los va
// procesando al ritmo que el rate limit permite.
export async function encolarNotificacionesProducto(destinatarios, { nombreProducto, urlProducto }) {
    if (!colaEmailProducto) {
        console.warn(`[cola-email-producto] Redis no configurado; no se encolaron ${destinatarios.length} notificaciones de "${nombreProducto}".`);
        return;
    }
    if (!destinatarios?.length) return;

    const jobs = destinatarios.map(({ to, idInteres }) => ({
        name: "notificar-producto-disponible",
        data: {
            to,
            nombreProducto,
            urlProducto,
            urlBaja: `${API_BASE_URL}/api/web/interesado/baja?token=${generarTokenBaja(idInteres)}`
        },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    }));
    await colaEmailProducto.addBulk(jobs);
}
