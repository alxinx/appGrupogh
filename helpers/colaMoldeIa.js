import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import { procesarIntentoMoldeIa } from './moldeIa.js';

dotenv.config();

// Cola para la generación de imagen con IA (admin/procesos/fichas-confeccion, "Carga el
// molde"): una llamada a la API de OpenAI tarda 20-60s (helpers/moldeIa.js) — demasiado
// para dejarla en un `await` suelto del proceso de Express como hace helpers/dxf.js con el
// parseo del DXF, que es liviano. Es la SEGUNDA cola del proyecto (la primera es
// notificaciones-producto-disponible, helpers/colaEmailProducto.js) — se discutió con el
// usuario antes de agregarla, como pide CLAUDE.md.
//
// Mismo criterio de Redis opcional que la cola de email, pero con una diferencia: sin
// Redis, la cola de email simplemente no manda nada (perder un aviso no es grave). Acá
// "no generar nada" dejaría al usuario esperando una imagen que nunca llega, así que sin
// REDIS_HOST el job corre igual, directo en el proceso de Express (mismo resultado, sin
// reintentos automáticos ni aislamiento real de proceso) — la función que hace el trabajo
// de verdad (procesarIntentoMoldeIa) es la misma en los dos casos, así que activar la cola
// de verdad más adelante es solo configurar REDIS_HOST, nada de código cambia.
const NOMBRE_COLA = 'fichas-confeccion-molde-ia';
const REDIS_CONFIGURADO = !!process.env.REDIS_HOST;

const conexionRedis = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined
};

const colaMoldeIa = REDIS_CONFIGURADO ? new Queue(NOMBRE_COLA, { connection: conexionRedis }) : null;

if (REDIS_CONFIGURADO) {
    // El worker vive en el mismo proceso Express — este proyecto no tiene infraestructura
    // de workers separada (mismo criterio que colaEmailProducto.js y el setInterval de
    // traslados expirados en index.js). Sin `limiter`: a diferencia de SES, la API de
    // OpenAI no tiene un rate limit tan ajustado que haga falta throttlear job por job acá.
    const worker = new Worker(NOMBRE_COLA, async (job) => {
        await procesarIntentoMoldeIa(job.data.idIntento);
    }, { connection: conexionRedis, concurrency: 2 });

    worker.on('failed', (job, err) => {
        console.error(`[cola-molde-ia] job ${job?.id} (intento ${job?.data?.idIntento}) falló: ${err.message}`);
    });
} else {
    console.warn(
        '[cola-molde-ia] REDIS_HOST no configurado — la generación de imagen con IA corre ' +
        'directo en el proceso de Express, sin cola real. Definí REDIS_HOST/REDIS_PORT en ' +
        '.env para aislarla en su propio worker.'
    );
}

// Punto de entrada único: encola si hay Redis, corre directo si no. El controlador nunca
// decide esto — siempre llama acá.
export async function encolarGeneracionMoldeIa(idIntento) {
    if (colaMoldeIa) {
        await colaMoldeIa.add('generar-molde-ia', { idIntento }, { attempts: 1 });
        return;
    }
    // Sin await: el controlador ya respondió 202 al navegador, esto sigue en segundo plano.
    procesarIntentoMoldeIa(idIntento).catch((e) => {
        console.error(`[cola-molde-ia] intento ${idIntento} (sin cola) falló:`, e);
    });
}
