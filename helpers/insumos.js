import { Op } from 'sequelize';
import { toPascal } from './clientes.js';
import { DetallesOrdenCompra, OrdenesCompra, Provedores } from '../models/index.js';

// Catálogo de Insumos y Materias Primas (admin/insumos). Una sola fuente para las opciones
// del formulario, los límites y la validación del alta: la vista recibe estas listas por
// locals y el navegador copia los límites desde los atributos del formulario, así que no
// hay una segunda lista escrita a mano en pug ni en JS (CLAUDE.md §2).
//
// Los valores de `tipo` y `unidadCompra` son los del ENUM de la tabla MATERIAL.

// `etiquetaNombre` es el rótulo del campo Nombre cuando se elige el tipo ("Nombre Insumo").
export const TIPOS_INSUMO = [
    { valor: 'materia_prima', etiqueta: 'Materia prima', etiquetaNombre: 'Materia Prima', detalle: 'Telas e hilos que se transforman en producto', icono: '/img/avatars/telita.webp' },
    { valor: 'insumo',        etiqueta: 'Insumo',        etiquetaNombre: 'Insumo',        detalle: 'Avíos y empaques que se consumen en el proceso', icono: '/img/avatars/insumos.webp' }
];

export const UNIDADES_COMPRA = [
    { valor: 'kg',     etiqueta: 'Kilogramo (kg)' },
    { valor: 'metro',  etiqueta: 'Metro' },
    { valor: 'rollo',  etiqueta: 'Rollo' },
    { valor: 'unidad', etiqueta: 'Unidad' }
];

// codigoMaterial es INT en MySQL: el tope es el máximo de un INT con signo.
export const LIMITES_INSUMO = { codigoMin: 1, codigoMax: 2147483647, nombreMax: 100 };

// Carpeta en el bucket público (`grupo-gh`, config/r2.js) donde vive la foto de un material.
// Sin espacios ni mayúsculas, a diferencia de como se nombró de palabra: el resto de
// carpetas del proyecto (`productos/`, `documentacion/`, `provedores/`...) tampoco llevan
// espacio, y `urlDocumento`/`${R2_PUBLIC_URL}/${key}` no codifican la URL — un espacio
// literal ahí queda a merced de que cada consumidor lo encodee bien.
export const CARPETA_IMAGENES_INSUMOS = 'materiales-e-insumos';

// MATERIAL.imagen guarda solo el nombre de archivo (igual que IMAGENES.nombreImagen para
// productos): la carpeta es fija para todo el catálogo, así que no hace falta repetirla en
// cada fila. La URL se arma una sola vez, acá, en vez de en cada vista/controlador.
export const urlImagenMaterial = (nombreArchivo) =>
    nombreArchivo ? `${process.env.R2_PUBLIC_URL}/${CARPETA_IMAGENES_INSUMOS}/${nombreArchivo}` : null;

const ETIQUETA_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.etiqueta]));
const ICONO_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.icono]));
const ETIQUETA_UNIDAD = Object.fromEntries(UNIDADES_COMPRA.map(u => [u.valor, u.etiqueta]));

// PENDIENTE: todavía no hay stock real de materiales (eso llega con el módulo de
// Producción que consume estos insumos). Mientras tanto la columna "Cantidad" del
// catálogo, y todo el perfil de un material (helpers de más abajo), muestran números de
// relleno — determinísticos por `idMaterial`, nunca `Math.random()`, para que no cambien
// en cada recarga y parezcan un bug. Un solo hash para todos: `hashIdMaterial` abajo.
const hashIdMaterial = (idMaterial) => {
    let hash = 0;
    for (const c of String(idMaterial)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return hash;
};

const cantidadFicticia = (idMaterial) => (hashIdMaterial(idMaterial) % 500) + 1;

// Lo que la vista necesita de una fila: nada del modelo que no se pinte.
export const presentarMaterial = (m) => ({
    idMaterial:     m.idMaterial,
    codigoMaterial: m.codigoMaterial,
    nombre:         m.nombre,
    tipo:           m.tipo,
    tipoEtiqueta:   ETIQUETA_TIPO[m.tipo] ?? m.tipo,
    unidadCompra:   m.unidadCompra,
    unidadEtiqueta: ETIQUETA_UNIDAD[m.unidadCompra] ?? '—',
    activo:         Boolean(m.activo),
    icono:          ICONO_TIPO[m.tipo] ?? ICONO_TIPO.insumo,
    // Foto real del material si se subió una; si no, la vista cae al ícono genérico del tipo.
    imagenUrl:      urlImagenMaterial(m.imagen),
    cantidadFicticia: cantidadFicticia(m.idMaterial)
});

// ── Perfil de un material (admin/insumos/:id) — datos de relleno ─────────────────────
// PENDIENTE: no hay todavía tablas de stock, costos de compra ni proveedores por insumo
// (llegan con el módulo de Producción que consume el catálogo). Mientras tanto el perfil
// arma esta data de relleno, determinística por idMaterial con el mismo `hashIdMaterial` de
// `cantidadFicticia` — nunca azar real, para que la pantalla no "cambie sola" al recargar.
// Reemplazar el resto de `datosFicticiosInsumo` por consultas reales en cuanto existan esas
// tablas: la vista (insumoPerfil.pug) ya consume estos mismos nombres de campo, así que el
// día que haya datos reales el cambio es acá y no en el pug.
//
// La tarjeta "Historial de compras" YA es real — ver `historialComprasInsumo` más abajo.
// `datosFicticiosInsumo` sigue generando un `historialCompras` de relleno puertas adentro
// (lo sigue necesitando `resumenCompras`, la dona, que todavía no se pidió hacer real), pero
// produccionController.js pisa ese campo con el real antes de llegar a la vista.
const UNIDAD_CORTA = { kg: 'kg', metro: 'm', rollo: 'rollos', unidad: 'uds' };

const DESCRIPCIONES_FICTICIAS = {
    materia_prima: 'Material base que se transforma en la prenda. Confirma composición y cuidados exactos en la ficha técnica del proveedor.',
    insumo:        'Avío o empaque que se consume durante la confección. Confirma especificaciones exactas en la ficha técnica del proveedor.'
};

const COMPOSICION_POOL = ['Algodón', 'Poliéster', 'Elastano', 'Lycra', 'Viscosa', 'Nylon', 'Poliamida'];

// Mismos colores por proveedor en la leyenda (server, inline style) y en la dona
// (src/js/insumoPerfil.js, Chart.js): una sola paleta para que no haga falta mantenerla
// sincronizada en dos archivos. Igual a la de src/js/adminProductoView.js.
export const PALETTE_RESUMEN_COMPRAS = ['#EC5FA3', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'];

const PROCESOS_POOL = [
    { nombre: 'Corte',      icono: 'fi-rr-scissors' },
    { nombre: 'Confección', icono: 'fi-rr-shirt' },
    { nombre: 'Lavandería', icono: 'fi-rr-washer' },
    { nombre: 'Estampado',  icono: 'fi-rr-spray-can' },
    { nombre: 'Acabados',   icono: 'fi-rr-sparkles' },
    { nombre: 'Empaque',    icono: 'fi-rr-box' }
];

const PROVEEDORES_POOL = [
    { nombre: 'Textiles Caldas',      ciudad: 'Medellín, Antioquia' },
    { nombre: 'Maquilas del Sur',     ciudad: 'Itagüí, Antioquia' },
    { nombre: 'Textilera Éxito',      ciudad: 'Bogotá, Cundinamarca' },
    { nombre: 'Insumos del Valle',    ciudad: 'Cali, Valle del Cauca' },
    { nombre: 'Distribuidora Andina', ciudad: 'Pereira, Risaralda' }
];

// Elige `n` elementos de `pool` sin repetir, en un orden que varía con `hash` — mismo
// mecanismo que el resto de este módulo: determinístico, nunca Math.random().
const elegirSinRepetir = (pool, hash, n) => {
    const disponibles = [...pool];
    const elegidos = [];
    let h = hash;
    for (let i = 0; i < n && disponibles.length; i++) {
        h = (h * 31 + 7) >>> 0;
        elegidos.push(disponibles.splice(h % disponibles.length, 1)[0]);
    }
    return elegidos;
};

const inicialesProveedor = (nombre) =>
    nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

// "02 oct 2026", sin el "de" que mete Intl por defecto en es-CO — mismo formato corto que
// ya usan las tirillas y el resto del panel.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (f) => `${String(f.getDate()).padStart(2, '0')} ${MESES_CORTOS[f.getMonth()]} ${f.getFullYear()}`;

const diaFicticioAtras = (hash, minDias, maxDias) => {
    const f = new Date();
    f.setDate(f.getDate() - (minDias + (hash % (maxDias - minDias + 1))));
    return f;
};

export const datosFicticiosInsumo = (material) => {
    const hash = hashIdMaterial(material.idMaterial);
    const unidadCorta = UNIDAD_CORTA[material.unidadCompra] ?? 'uds';

    // Misma cantidad que ya se ve en el catálogo (presentarMaterial): un solo número de
    // relleno para la existencia de un material, no dos que puedan desentonar entre sí.
    const existencia = material.cantidadFicticia ?? cantidadFicticia(material.idMaterial);
    const stockMinimo = Math.max(10, Math.round(existencia * 0.18));

    const costoPromedio = Math.round((8000 + (hash % 25) * 700) / 100) * 100;
    const ultimaCompraCosto = Math.round((costoPromedio * (0.92 + (hash % 10) / 100)) / 100) * 100;
    const tiempoEntregaDias = 2 + (hash % 8);

    const composicion = elegirSinRepetir(COMPOSICION_POOL, hash, 2 + (hash % 2));
    const procesos = elegirSinRepetir(PROCESOS_POOL, hash >>> 3, 2 + (hash % 3));

    const proveedoresCrudos = elegirSinRepetir(PROVEEDORES_POOL, hash >>> 5, 3).map((p, i) => {
        const hp = (hash + i * 97) >>> 0;
        return {
            ...p,
            iniciales:      inicialesProveedor(p.nombre),
            precioPromedio: Math.round((costoPromedio * (0.95 + (hp % 15) / 100)) / 100) * 100,
            calificacion:   (4.3 + (hp % 7) / 10).toFixed(1),
            ultimaCompraFecha: diaFicticioAtras(hp, 5 + i * 25, 20 + i * 30)
        };
    });

    // 4 compras repartidas entre los 3 proveedores (el primero se repite, como en una
    // relación real donde no se compra la misma cantidad a cada uno), más recientes primero.
    const historialCrudo = [0, 1, 2, 0].map((idxProveedor, i) => {
        const p = proveedoresCrudos[idxProveedor];
        const hp = (hash + i * 53) >>> 0;
        const cantidad = 150 + (hp % 400);
        const precioUnit = Math.round((p.precioPromedio * (0.97 + (hp % 6) / 100)) / 100) * 100;
        const fecha = i === 0 ? p.ultimaCompraFecha : diaFicticioAtras(hp, 30 + i * 35, 60 + i * 35);
        return { fecha, proveedor: p.nombre, iniciales: p.iniciales, cantidad, precioUnit, total: cantidad * precioUnit };
    }).sort((a, b) => b.fecha - a.fecha);

    const totalComprado = historialCrudo.reduce((acc, h) => acc + h.total, 0);
    const resumenCompras = proveedoresCrudos
        .map(p => {
            const total = historialCrudo.filter(h => h.proveedor === p.nombre).reduce((acc, h) => acc + h.total, 0);
            return { nombre: p.nombre, iniciales: p.iniciales, total, pct: totalComprado ? Math.round((total / totalComprado) * 100) : 0 };
        })
        .sort((a, b) => b.total - a.total)
        .map((p, i) => ({ ...p, color: PALETTE_RESUMEN_COMPRAS[i % PALETTE_RESUMEN_COMPRAS.length] }));

    const mejorProveedor = [...proveedoresCrudos].sort((a, b) => a.precioPromedio - b.precioPromedio)[0];

    return {
        unidadCorta,
        existencia,
        stockMinimo,
        costoPromedio,
        ultimaCompraCosto,
        tiempoEntregaDias,
        descripcion:  DESCRIPCIONES_FICTICIAS[material.tipo] ?? DESCRIPCIONES_FICTICIAS.insumo,
        composicion,
        procesos,
        proveedores: proveedoresCrudos.map(({ ultimaCompraFecha, ...p }) => ({ ...p, ultimaCompra: fechaCorta(ultimaCompraFecha) })),
        historialCompras: historialCrudo.map(({ fecha, ...h }) => ({ ...h, fecha: fechaCorta(fecha) })),
        resumenCompras,
        totalComprado,
        mejorProveedor: { nombre: mejorProveedor.nombre, precioPromedio: mejorProveedor.precioPromedio },
        datoUtil: material.tipo === 'materia_prima'
            ? 'Verifica el lote antes de cortar: dos rollos del mismo color pueden variar levemente de tono.'
            : 'Guarda este insumo en un lugar seco — la humedad puede afectar el empaque o el adhesivo.'
    };
};

// ── Historial de compras REAL de un material (admin/insumos/:id) ─────────────────────
// Solo cuenta como "comprada" una línea cuya orden llegó al menos a 'confirmada' — antes de
// eso (borrador/enviada) todavía puede cambiar o no concretarse nunca, y 'cancelada' nunca
// se concretó aunque haya pasado por 'confirmada'. Mismo principio que FacturaClientes.estado
// (CLAUDE.md §6): nada se da por comprado hasta el estado que lo confirma de verdad.
const ESTADOS_COMPRA_CONFIRMADA = ['confirmada', 'en_transito', 'recibida'];
const LIMITE_HISTORIAL_COMPRAS_INSUMO = 10;

// Mismo rótulo y color que la columna Estado del historial de compras
// (src/js/historialCompras.js, ESTADO) — acá solo pueden salir estos tres valores, nunca
// borrador/enviada/cancelada (ya los filtra la consulta de abajo), pero se define el mapa
// completo para no tener dos copias parciales del mismo mapeo en el proyecto.
const ESTADO_ORDEN_BADGE = {
    borrador:    ['Borrador',    'bg-slate-100 text-slate-500'],
    enviada:     ['Enviada',     'bg-blue-100 text-blue-600'],
    confirmada:  ['Confirmada',  'bg-indigo-100 text-indigo-600'],
    en_transito: ['En tránsito', 'bg-amber-100 text-amber-600'],
    recibida:    ['Recibida',    'bg-emerald-100 text-emerald-600'],
    cancelada:   ['Cancelada',   'bg-rose-100 text-rose-600']
};

export const historialComprasInsumo = async (idMaterial) => {
    const lineas = await DetallesOrdenCompra.findAll({
        where: { idMaterial },
        include: [{
            model: OrdenesCompra, as: 'orden',
            where: { estado: { [Op.in]: ESTADOS_COMPRA_CONFIRMADA } },
            attributes: ['idOrdenCompra', 'numeroOrden', 'fechaOrden', 'estado'],
            include: [{ model: Provedores, as: 'proveedor', attributes: ['razonSocial'] }]
        }],
        order: [[{ model: OrdenesCompra, as: 'orden' }, 'fechaOrden', 'DESC'], ['idDetalleOrdenCompra', 'DESC']],
        limit: LIMITE_HISTORIAL_COMPRAS_INSUMO
    });

    return lineas.map(l => {
        const [estadoEtiqueta, estadoClase] = ESTADO_ORDEN_BADGE[l.orden.estado] || [l.orden.estado, 'bg-slate-100 text-slate-500'];
        return {
            idOrdenCompra: l.orden.idOrdenCompra,
            numeroOrden:   l.orden.numeroOrden,
            proveedor:     l.orden.proveedor?.razonSocial || '—',
            fecha:         fechaCorta(new Date(`${l.orden.fechaOrden}T00:00:00`)),
            cantidad:      Number(l.cantidad),
            precioUnit:    Number(l.valorUnitario),
            total:         Number(l.valorTotal),
            estadoEtiqueta,
            estadoClase
        };
    });
};

// Devuelve el código DXF como número, o null si no es un entero dentro de los límites. Lo usan
// la validación del alta y la consulta de duplicados, para que las dos digan lo mismo.
export const codigoDxfValido = (texto) => {
    const t = String(texto ?? '').trim();
    if (!/^\d{1,10}$/.test(t)) return null;
    const n = Number(t);
    return n >= LIMITES_INSUMO.codigoMin && n <= LIMITES_INSUMO.codigoMax ? n : null;
};

// Validación del alta. Devuelve `{ errores }` con un mensaje por campo, o `{ datos }` con
// solo los campos permitidos (whitelist: nada del body llega al modelo tal cual, §12).
export const validarInsumo = (body = {}) => {
    const errores = {};
    const { codigoMin, codigoMax, nombreMax } = LIMITES_INSUMO;

    const codigoTxt = String(body.codigoMaterial ?? '').trim();
    const codigoMaterial = codigoDxfValido(codigoTxt);
    if (!codigoTxt) {
        errores.codigoMaterial = 'Escribe el código del material, el número que trae el DXF.';
    } else if (codigoMaterial === null) {
        errores.codigoMaterial = `El código debe ser un número entero entre ${codigoMin} y ${codigoMax}.`;
    }

    const nombre = String(body.nombre ?? '').trim();
    if (!nombre) errores.nombre = 'Escribe el nombre del material.';
    else if (nombre.length > nombreMax) errores.nombre = `El nombre no puede pasar de ${nombreMax} caracteres.`;

    const tipo = String(body.tipo ?? '');
    if (!TIPOS_INSUMO.some(t => t.valor === tipo)) errores.tipo = 'Elige si es materia prima o insumo.';

    const unidadTxt = String(body.unidadCompra ?? '').trim();
    const unidadCompra = unidadTxt || null;
    if (unidadCompra && !UNIDADES_COMPRA.some(u => u.valor === unidadCompra)) {
        errores.unidadCompra = 'Elige una unidad de compra de la lista.';
    }

    if (Object.keys(errores).length) return { errores };
    // El nombre se guarda en formato de título (POLILICRA -> Polilicra) con el mismo helper que
    // usan clientes y proveedores, para que el catálogo no mezcle mayúsculas.
    return { datos: { codigoMaterial, nombre: toPascal(nombre), tipo, unidadCompra } };
};
