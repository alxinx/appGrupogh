import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Cliente de la API de imágenes de OpenAI (admin/procesos/fichas-confeccion, generación de
// la vista previa del molde — helpers/moldeIa.js). Sin OPENAI_API_KEY no se puede instanciar
// el cliente real: `OPENAI_CONFIGURADO` lo marca para que helpers/moldeIa.js caiga al modo
// simulado en vez de reventar al primer uso, mismo criterio que REDIS_CONFIGURADO en
// helpers/colaEmailProducto.js.
export const OPENAI_CONFIGURADO = !!process.env.OPENAI_API_KEY;

// El modo simulado (devolver el propio molde como "resultado") existe para probar el flujo en
// local sin gastar, y SOLO se activa a propósito con IA_SIMULADA=true. Sin clave y sin esa
// variable, la IA no está disponible y se dice así: antes, a producción le faltaba la clave
// y devolvía el molde en silencio como si fuera la imagen generada (2026-11-20).
export const IA_SIMULADA = !OPENAI_CONFIGURADO && process.env.IA_SIMULADA === 'true';
export const IA_DISPONIBLE = OPENAI_CONFIGURADO || IA_SIMULADA;
export const MENSAJE_IA_NO_DISPONIBLE = 'La generación con IA no está disponible en este momento. Avísale al administrador del sistema.';

const openaiClient = OPENAI_CONFIGURADO ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export default openaiClient;
