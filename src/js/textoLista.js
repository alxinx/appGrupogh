// Expone el formateador de listados al navegador para las tablas que se pintan con JS.
// La implementación vive en helpers/textoLista.js — la misma que usa el servidor, para
// que una fila recién agregada se vea igual que las que llegan renderizadas.
import { tituloLista } from '../../helpers/textoLista.js';

window.tc = tituloLista;
