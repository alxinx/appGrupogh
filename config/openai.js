import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Cliente de la API de imágenes de OpenAI (admin/procesos/fichas-confeccion, generación de
// la vista previa del molde — helpers/moldeIa.js). Sin OPENAI_API_KEY no se puede instanciar
// el cliente real: `OPENAI_CONFIGURADO` lo marca para que helpers/moldeIa.js caiga al modo
// simulado en vez de reventar al primer uso, mismo criterio que REDIS_CONFIGURADO en
// helpers/colaEmailProducto.js.
export const OPENAI_CONFIGURADO = !!process.env.OPENAI_API_KEY;

const openaiClient = OPENAI_CONFIGURADO ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export default openaiClient;
