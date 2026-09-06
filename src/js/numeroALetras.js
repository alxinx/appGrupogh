// Puente al navegador de helpers/numeroALetras.js — mismo patrón que helpers.js: un script
// de utilidades globales (window.X), no un módulo importado por cada bundle. Una sola
// implementación de las reglas de español (ver el comentario de ese archivo sobre por qué
// está escrita a mano), reusada acá y en el backend en vez de duplicarla.
import { numeroCardinal, valorEnLetras } from '../../helpers/numeroALetras.js';

window.numeroCardinal = numeroCardinal;
window.valorEnLetras  = valorEnLetras;
