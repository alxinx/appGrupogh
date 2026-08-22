import { Dosificaciones, Pack, DetallesPack, Productos, Traslados, Usuarios, Stock, DetalleTraslados, Empleados, PuntosDeVenta, InsidenciaTraslado } from '../models/index.js';
import jwt from "jsonwebtoken";
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { formatearFecha } from '../helpers/helpers.js';
import db from '../config/bd.js';
import { v4 as uuidv4 } from 'uuid'; // Para generar los códigos de etiqueta únicos
import { Op } from 'sequelize';
import dotenv from "dotenv"
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { broadcast } from '../helpers/sseManager.js';
import { crearConCodigo } from '../helpers/secuencias.js';
import { calcularKitting } from '../src/js/dosificador.js';

dotenv.config()




//DASHBOARD DOSIDI
const homeDose = async (req, res) => {
    return res.status(201).render('./administrador/dose/homeDose', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificaciones',
    })
}

//DASHBOARD DOSIDI
const newDose = async (req, res) => {
    return res.status(201).render('./administrador/dose/new', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificar',
        btnName: "Guardar Dosificación"
    })
}










const guardarDosificacion = async (req, res) => {
    // 1. Extraer ID del JWT (Estructura: usuario { id: { id: "..." } })
    const idUsuarioSesion = req.usuario.idUsuario;
    const t = await db.transaction();

    try {
        const { productos, capacidadBolsa } = req.body; // idUsuario ya no viene del body por seguridad

        // 2. Crear el Maestro (Dosificación)
        const totalUnidades = productos.reduce((acc, p) => acc + parseInt(p.cantidad), 0);
        const dosificacion = await Dosificaciones.create({
            capacidadBolsa,
            totalUnidades,
            idUsuario: idUsuarioSesion,
            estado: 'COMPLETADA'
        }, { transaction: t });

        // 3. Ejecutar Algoritmo de Kitting en el Servidor
        const resultadoKitting = ejecutarAlgoritmoKittingBackend(productos, capacidadBolsa);

        // 4. Guardar Packs y Detalles
        // Procesamos los lotes calculados (resultadoKitting.packs)
        let contadorGlobalPacks = 1;
        const prefijoDose = dosificacion.idDosificacion.substring(0, 4).toUpperCase();

        const mapaPrecios = {};
        productos.forEach(p => {
            mapaPrecios[p.idProducto] = p.valorUnidad;
        });


        for (const [index, grupo] of resultadoKitting.packs.entries()) {

            // El contador debe moverse dentro del map para que cada pack sea único
            const packsData = Array.from({ length: grupo.cantidad }).map(() => {
                const correlativo = String(contadorGlobalPacks).padStart(3, '0');
                const codigo = `D${prefijoDose}-P${correlativo}`;

                contadorGlobalPacks++; // Incrementamos para el siguiente bulto

                return {
                    idDosificacion: dosificacion.idDosificacion,
                    codigoEtiqueta: codigo,
                    numLote: index + 1,
                    tipo: 'ESTANDAR',
                    estado: 'EMPACADO'
                };
            }); ''

            const packsCreados = await Pack.bulkCreate(packsData, {
                transaction: t,
                returning: true
            });




            // Preparar los detalles para este grupo de bultos
            const detallesBulk = [];
            packsCreados.forEach(p => {
                Object.entries(grupo.detalle).forEach(([idProducto, cant]) => {
                    detallesBulk.push({
                        idPack: p.idPack,
                        idProducto: idProducto,
                        cantidad: cant,
                        valorUnidad: mapaPrecios[idProducto] // <--- ASIGNAMOS EL PRECIO AQUÍ
                    });
                });
            });
            await DetallesPack.bulkCreate(detallesBulk, { transaction: t });
        }

        // 5. Manejar el Pack de Residuo (Saldo) si existe
        if (Object.keys(resultadoKitting.residuo).length > 0) {
            const packResiduo = await Pack.create({
                idDosificacion: dosificacion.idDosificacion,
                codigoEtiqueta: `RES-${Date.now()}`,
                numLote: resultadoKitting.packs.length + 1,
                tipo: 'RESIDUO',
                estado: 'EMPACADO'
            }, { transaction: t });

            const detallesResiduo = Object.entries(resultadoKitting.residuo).map(([idProducto, cant]) => ({
                idPack: packResiduo.idPack,
                idProducto: idProducto,
                cantidad: cant,
                valorUnidad: mapaPrecios[idProducto] ?? 0
            }));
            await DetallesPack.bulkCreate(detallesResiduo, { transaction: t });
        }

        await t.commit();
        res.json({ mensaje: 'ok', idDosificacion: dosificacion.idDosificacion });

    } catch (error) {
        await t.rollback();
        console.error("Error en Dosificación:", error);
        res.status(500).json({ mensaje: 'error', detalle: error.message });
    }
};

/* ==========================================
   LÓGICA DEL ALGORITMO — delega en el mismo módulo que usa la vista previa del
   formulario (src/js/dosificador.js), para que lo que el usuario ve antes de guardar
   sea exactamente lo que se persiste. Acá solo se adapta el array del body a un mapa
   idProducto -> cantidad, sumando si el mismo producto viene repetido en dos filas del
   formulario: pisar la cantidad en vez de sumarla hacía desaparecer unidades del plan
   de empaque sin ningún aviso.
   ========================================== */
function ejecutarAlgoritmoKittingBackend(productosArray, capacidad) {
    const stock = {};
    productosArray.forEach((p) => {
        stock[p.idProducto] = (stock[p.idProducto] || 0) + Number(p.cantidad);
    });
    return calcularKitting(stock, capacidad);
}




const obtenerDosificacionesPaginadas = async (req, res) => {
    try {
        const { query } = req.params;

        const { pagina = 1, estado = '' } = req.query;
        const limite = parseInt(process.env.LIMIT_PER_PAGE)
        const offset = (pagina - 1) * limite;

        let whereCondition = {};
        // if (query && query !== 'all') {
        //     const busquedaLimpia = query.startsWith('D') ? query.substring(1) : query;
        //     whereCondition.idDosificacion = { [Op.like]: `${busquedaLimpia}%` };
        // }
        // La tabla NO tiene columna 'codigo': el código que se ve (D1A2B) se arma con los
        // primeros 4 del UUID. Buscar por 'codigo' lanzaba un error de SQL y la lista
        // quedaba vacía, que es lo que se veía como "no filtra nada".
        let idsPorLote = null;
        if (query && query !== 'all') {
            const limpio = query.trim();
            // "LT-2" o "2" -> lotes. Se resuelve a qué dosificaciones pertenecen.
            const mLote = limpio.match(/^(?:LT-?)?(\d+)$/i);
            if (mLote) {
                const packs = await Pack.findAll({
                    where: { numLote: parseInt(mLote[1]) },
                    attributes: ['idDosificacion'],
                    group: ['idDosificacion'],
                    raw: true
                });
                idsPorLote = packs.map(p => p.idDosificacion);
            }

            // "D1A2B" o el UUID: el código visible son los primeros 4 caracteres.
            const sinPrefijo = limpio.replace(/^D/i, '');
            const condiciones = [{ idDosificacion: { [Op.like]: `${sinPrefijo}%` } }];
            if (idsPorLote?.length) condiciones.push({ idDosificacion: { [Op.in]: idsPorLote } });
            // Sin coincidencias por lote, la búsqueda numérica no debe traer todo.
            if (mLote && !idsPorLote?.length) condiciones.length = 0;

            whereCondition[Op.or] = condiciones.length ? condiciones : [{ idDosificacion: null }];
        }
        // if (estado) whereCondition.estado = estado.toUpperCase();
        if (estado !== '') {
            whereCondition.estado = estado;
        }

        // Solo traemos Dosificación y contamos los Packs (mucho más rápido)
        const { count, rows } = await Dosificaciones.findAndCountAll({
            where: whereCondition,
            include: [{
                model: Pack,
                attributes: ['idPack'] // Solo traemos el ID para contar, nada más
            }],
            limit: limite,
            offset: offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        const dosificaciones = rows.map(d => ({
            id: d.idDosificacion,
            fecha: new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d.createdAt),
            codigo: `D${d.idDosificacion.substring(0, 4).toUpperCase()}`,
            nroPaquetes: (d.PACKs || d.packs || []).length, // Mantenemos el dato de cantidad
            estado: d.estado
        }));

        res.json({ total: count, dosificaciones, paginas: Math.ceil(count / limite) });
    } catch (error) {
        res.status(500).json({ error: 'Error optimizado' });
    }
};





//VISUAL DE LA DOSIFICACION
const verDosificacion = async (req, res) => {
    try {
        const { idDosificacion, codigo } = req.params;

        const dose = await Dosificaciones.findByPk(idDosificacion, {
            include: [{
                model: Pack,
                as: 'PACKs',
                include: [{
                    model: DetallesPack,
                    as: 'DETALLES_PACKs',
                    include: [{ model: Productos, as: 'producto' }]
                }]
            }],
            // De LT-1 en adelante. Esta consulta alimenta `packs`, la lista plana de la
            // tabla; sin orden explícito MySQL devolvía los bultos como le convenía.
            // El idPack desempata: numLote se repite entre bultos del mismo lote y sin un
            // criterio único el orden no es estable entre consultas.
            order: [[{ model: Pack, as: 'PACKs' }, 'numLote', 'ASC'],
                    [{ model: Pack, as: 'PACKs' }, 'idPack', 'ASC']]
        });

        if (!dose) {
            return res.redirect('/dosificaciones');
        }

        // Agrupar por numLote
        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
            const lote = pack.numLote;
            if (!acc[lote]) acc[lote] = [];
            acc[lote].push(pack);
            return acc;
        }, {});

        const lotesOrdenados = Object.keys(gruposLotes).sort((a, b) => a - b).map(numLote => {
            const bultos = gruposLotes[numLote];
            const primerPack = bultos[0];
            return {
                numLote,
                esResiduo: primerPack.tipo === 'RESIDUO',
                cantidadBultos: bultos.length,
                detalles: primerPack.DETALLES_PACKs,
                codigoEtiqueta: primerPack.codigoEtiqueta,
                numTipos: primerPack.DETALLES_PACKs.length
            };
        });

        const totalColumnas = lotesOrdenados.length;
        // Si son 3 columnas -> span 4, si 4 -> span 3. Maximo 4 columnas por fila (span 3)
        const colSpan = totalColumnas > 0 ? Math.floor(12 / Math.min(totalColumnas, 4)) : 12;

        return res.status(201).render('./administrador/dose/ver', {
            pagina: "Dosificacion de productos",
            subPagina: `Ver dosificacion de ${codigo}`,
            idDosificacion,
            codigoDose: codigo,
            csrfToken: req.csrfToken(),
            currentPath: '/dosificaciones',
            subPath: 'dosificaciones',
            lotes: lotesOrdenados,
            packs: dose.PACKs, // Lista plana para la tabla de abajo
            colSpan
        });
    } catch (error) {
        console.error("Error al ver dosificación:", error);
        res.status(500).send('Error interno del servidor');
    }
}



const verDosificacionDetalle = async (req, res) => {
    try {
        const { idDosificacion } = req.params;
        const dose = await Dosificacion.findByPk(idDosificacion, {
            include: [{
                model: Pack,
                as: 'PACKs',
                include: [{
                    model: DetallesPack,
                    as: 'DETALLES_PACKs',
                    include: [{ model: Producto, as: 'producto' }]
                }]
            }]
        });




    } catch (error) {
        res.status(500).send('Error');
    }
};


//formatearFecha

const obtenerMetadataDose = async (req, res) => {
    try {
        const { id } = req.params;

        const dose = await Dosificaciones.findByPk(id, {
            include: [{
                model: Pack,
                as: 'PACKs',
                include: [{
                    model: DetallesPack,
                    as: 'DETALLES_PACKs',
                    include: [{ model: Productos, as: 'producto' }]
                }]
            }],
            // Lotes de menor a mayor. El idPack cierra el orden porque numLote se repite
            // entre bultos del mismo lote, y sin un criterio único MySQL no garantiza
            // el mismo orden entre consultas.
            order: [[{ model: Pack, as: 'PACKs' }, 'numLote', 'ASC'],
                    [{ model: Pack, as: 'PACKs' }, 'idPack', 'ASC']]
        });

        if (!dose) return res.status(404).json({ error: 'No encontrada' });

        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
            const lote = pack.numLote;
            if (!acc[lote]) acc[lote] = [];
            acc[lote].push(pack);
            return acc;
        }, {});

        // DEBUG: Verifica si aquí los valores vienen en 0 o con datos

        const totalBultos = dose.PACKs ? dose.PACKs.length : 0;

        const totalPrendas = (dose.PACKs || []).reduce((accPack, pack) => {
            const sumaDetalles = (pack.DETALLES_PACKs || []).reduce((accDet, det) => {
                return accDet + (parseInt(det.cantidad) || 0);
            }, 0);
            return accPack + sumaDetalles;
        }, 0);

        const calculoSobrantes = dose.capacidadBolsa > 0 ? (totalPrendas % dose.capacidadBolsa) : 0;


        res.json({
            fechaFormateada: formatearFecha(dose.createdAt),
            // Forzamos la conversión a número por si vienen como String de la DB
            unidadesPorPaquete: Number(dose.capacidadBolsa) || 0,
            sobrantes: Number(calculoSobrantes) || 0,
            totalUnidades: totalPrendas,
            totalBultos: totalBultos
        });

    } catch (error) {
        console.error("Error Sequelize:", error);
        res.status(500).json({ error: 'Error interno' });
    }
};



const obtenerProductosPorDose = async (req, res) => {
    try {
        const { id } = req.params;
        const dose = await Dosificaciones.findByPk(id, {
            include: [{
                model: Pack,
                // Quitamos el limit para ver todos los bultos
                include: [{
                    model: DetallesPack,
                    include: [{
                        model: Productos,
                        as: 'producto',
                        attributes: ['nombreProducto']
                    }]
                }]
            }]
        });

        if (!dose) return res.status(404).json({ error: 'Dosificación no encontrada' });

        const packs = dose.PACKs || dose.Packs || [];

        // Recorremos todos los bultos y todos sus detalles
        const todosLosProductos = packs.flatMap(p => {
            const detalles = p.DETALLES_PACKs || p.DetallesPacks || [];
            return detalles.map(dp => dp.producto ? dp.producto.nombreProducto : null);
        }).filter(n => n !== null); // Limpiamos nulos

        // aqui me aseguro que  el nombre solo salga una vez en el modal (dios bendiga a set)
        const productosUnicos = [...new Set(todosLosProductos)];

        res.json({ productos: productosUnicos });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
};




//STATS



const widgetGlobales = async (req, res) => {
    const [totalDose, totalP] = await Promise.all([
        Dosificaciones.count(),
        Pack.count({ where: { estado: { [Op.notIn]: ['DESEMPACADO', 'ANULADO'] } } })
    ]);
    // Respuesta plana y directa
    res.json({
        totalDosificaciones: totalDose,
        totalPacks: totalP
    });
};



const nroPacks = async (req, res) => {
    try {
        const total = await Dosificaciones.count();
        res.json({ total })

    } catch (error) {
        res.status(500).json({ error: 'Error Al Contar' })
    }
}



const trasladarPacks = async (req, res) => {
    const { packs, idDestino, idEmpleadoDespacha, notas } = req.body;

    if (!idEmpleadoDespacha) {
        return res.status(400).json({ success: false, mensaje: 'El código del empleado responsable es obligatorio.' });
    }
    const t = await db.transaction();
    // Se declara afuera porque el bloque post-commit (abajo) lo necesita.
    let traslado;

    try {
        // 1. Obtener los packs con sus detalles
        const recordsPacks = await Pack.findAll({
            where: { idPack: packs },
            include: [{
                model: DetallesPack,
                as: 'DETALLES_PACKs',
                include: [{ model: Productos, as: 'producto' }]
            }],
            transaction: t
        });

        // 2. Generar Código de Traslado Único
        // 3. Crear el Registro del Traslado (Encabezado)
        // Usamos req.usuario que ya viene inyectado por tu middleware de autenticación
        traslado = await crearConCodigo(Traslados, 'codigoTraslado', 'TR-', 'traslado', {
            idOrigen: 'PRODUCCION',
            idDestino: idDestino,
            idUsuarioDespacha: idEmpleadoDespacha,
            notas: notas || null,
            estado: 'EN_TRANSITO'
        }, t);

        // 4. Procesar cada Pack seleccionado en la tabla
        for (const pack of recordsPacks) {

            await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack: pack.idPack,
                cantidad: 1
            }, { transaction: t });

            // Actualizar estado del Pack a TRASLADADO
            await pack.update({ estado: 'TRASLADADO' }, { transaction: t });
        }

        await t.commit();

    } catch (error) {
        // Solo se revierte si la transacción sigue viva: intentar hacer rollback sobre una ya
        // confirmada lanza otro error dentro del catch y deja la petición sin respuesta.
        if (!t.finished) await t.rollback().catch(() => {});
        console.error("Error en traslado:", error);
        return res.status(500).json({ success: false, mensaje: 'Error interno' });
    }

    // ── Post-commit ───────────────────────────────────────────────────────────
    // El traslado YA está guardado. Nada de acá abajo puede impedir que el cliente
    // reciba su respuesta: sin ella el POS se queda esperando y no abre el comprobante.
    try {
        const pendientes = await Traslados.count({
            where: { idDestino, estado: { [Op.in]: ['EN_TRANSITO', 'PENDIENTE'] } }
        });
        broadcast(idDestino, 'new_traslado', {
            codigo: traslado.codigoTraslado,
            idTraslado: traslado.idTraslado,
            pendientes
        });
    } catch (error) {
        console.error('trasladarPacks [notificación post-commit]:', error);
    }

    return res.json({
        success: true,
        mensaje: 'Traslado exitoso',
        codigo: traslado.codigoTraslado,
        idTraslado: traslado.idTraslado
    });
};

const imprimirEtiquetasLote = async (req, res) => {
    try {
        const { idDosificacion, numLote } = req.params;

        const packs = await Pack.findAll({
            where: {
                idDosificacion,
                numLote
            },
            order: [['codigoEtiqueta', 'ASC']]
        });

        if (!packs || packs.length === 0) {
            return res.status(404).send('No se encontraron paquetes para este lote');
        }

        // Crear PDF - Tamaño 10x5 cm (aprox 283x142 puntos)
        const doc = new PDFDocument({
            size: [283.46, 141.73],
            margins: { top: 10, bottom: 10, left: 10, right: 10 }
        });

        // Configurar pipe a la respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=etiquetas_lote_${numLote}.pdf`);
        doc.pipe(res);

        for (let i = 0; i < packs.length; i++) {
            const pack = packs[i];

            if (i > 0) doc.addPage();

            // Título/Info superior
            doc.fontSize(10).font('Helvetica-Bold').text(`LOTE: ${numLote}`, 10, 15);
            //doc.fontSize(8).font('Helvetica').text(`ID: ${pack.codigoEtiqueta}`, 10, 28);

            try {
                // Generar Código de Barras
                const buffer = await bwipjs.toBuffer({
                    bcid: 'code128',       // Tipo de código
                    text: pack.codigoEtiqueta,    // Texto
                    scale: 3,               // Escala
                    height: 15,              // Altura en mm
                    includetext: true,      // Incluir texto debajo
                    textxalign: 'center',   // Alinear texto al centro
                });

                // Insertar imagen del código de barras
                doc.image(buffer, 10, 45, { width: 263 });
            } catch (err) {
                console.error('Error generando barcode:', err);
                doc.text('Error al generar código de barras', 10, 60);
            }
        }

        doc.end();

    } catch (error) {
        console.error('Error generando PDF etiquetas:', error);
        res.status(500).send('Error interno al generar etiquetas');
    }
};





const imprimirEtiquetasPorPack = async (req, res) => {
    try {
        const { idPack } = req.params;
        
        // 1. Buscamos el pack específico
        const pack = await Pack.findOne({
            where: { idPack },
            attributes: ['codigoEtiqueta', 'numLote']
        });

        if (!pack) {
            return res.status(404).send('No se encontró el paquete solicitado');
        }

        // 2. Configuración del PDF (10x5 cm)
        const doc = new PDFDocument({
            size: [283.46, 141.73], // 10cm x 5cm en puntos postscript
            margins: { top: 5, bottom: 5, left: 10, right: 10 }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=etiqueta_${pack.codigoEtiqueta}.pdf`);
        doc.pipe(res);

        // 3. Diseño de la Etiqueta
        doc.fontSize(10).font('Helvetica-Bold').text(`GRUPO GH - LOTE ${pack.numLote}`, 10, 15, { align: 'center' });
        
        try {
            // Generar Código de Barras dinámico
            const buffer = await bwipjs.toBuffer({
                bcid: 'code128',
                text: pack.codigoEtiqueta,
                scale: 3,
                height: 12, // Altura ajustada para el formato 10x5
                includetext: true,
                textxalign: 'center',
                textsize: 10
            });

            // Insertar Barcode centrado
            doc.image(buffer, 10, 40, { width: 263 });
            
            // Texto adicional de seguridad
            doc.fontSize(7).font('Helvetica').text('Verifique el sello de seguridad antes de recibir.', 10, 115, { align: 'center' });

        } catch (err) {
            console.error('Error generando barcode:', err);
            doc.fontSize(10).text('ERROR BARCODE', 10, 60, { align: 'center' });
        }

        doc.end();

    } catch (error) {
        console.error('Error generando PDF etiquetas:', error);
        res.status(500).send('Error interno al generar etiquetas');
    }
};

const imprimirComprobanteTraslado = async (req, res) => {
    try {
        const { idTraslado } = req.params;
        const __dirname = path.dirname(fileURLToPath(import.meta.url));

        const fmtFechaHora = (raw) => {
            if (!raw) return '________________________________';
            return new Intl.DateTimeFormat('es-CO', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).format(new Date(raw));
        };

        const idPdv = req.idPuntoDeVenta;
        const traslado = await Traslados.findOne({
            where: {
                idTraslado,
                ...(idPdv && { [Op.or]: [{ idOrigen: idPdv }, { idDestino: idPdv }] })
            },
            include: [
                {
                    model: PuntosDeVenta,
                    as: 'origen',
                    attributes: ['nombreComercial', 'razonSocial']
                },
                {
                    model: PuntosDeVenta,
                    as: 'destino',
                    attributes: ['nombreComercial', 'razonSocial']
                },
                {
                    model: DetalleTraslados,
                    as: 'items',
                    include: [
                        { model: Pack, as: 'pack', attributes: ['codigoEtiqueta', 'estado'] },
                        { model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }
                    ]
                }
            ]
        });

        if (!traslado) return res.status(404).send('Traslado no encontrado');

        const empleadoDespacha = await Empleados.findOne({
            where: { idEmpleado: traslado.idUsuarioDespacha },
            attributes: ['PrimerNombre', 'PrimerApellido']
        });

        const nombreDespachador = empleadoDespacha
            ? `${empleadoDespacha.PrimerNombre} ${empleadoDespacha.PrimerApellido}`
            : 'N/A';

        let nombreReceptor = null;
        if (traslado.idUsuarioRecibe) {
            const empleadoRecibe = await Empleados.findOne({
                where: { idEmpleado: traslado.idUsuarioRecibe },
                attributes: ['PrimerNombre', 'PrimerApellido']
            });
            if (empleadoRecibe) {
                nombreReceptor = `${empleadoRecibe.PrimerNombre} ${empleadoRecibe.PrimerApellido}`;
            }
        }

        const destinoNombre = traslado.destino?.nombreComercial || traslado.destino?.razonSocial || 'N/A';

        // Incidencias del traslado
        const insidencias = await InsidenciaTraslado.findAll({
            where: { idTraslado },
            include: [
                { model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'] },
                {
                    model: DetalleTraslados, as: 'detalle',
                    include: [
                        { model: Pack,     as: 'pack',     attributes: ['codigoEtiqueta'] },
                        { model: Productos, as: 'producto', attributes: ['nombreProducto'] }
                    ]
                }
            ]
        });

        // URL pública del comprobante (usada para el QR)
        const baseUrl = `${process.env.APP_URL}:${process.env.APP_PORT}`;
        const comprobanteUrl = `${baseUrl}/admin/dosificaciones/comprobante/${idTraslado}`;
        const qrBuffer = await QRCode.toBuffer(comprobanteUrl, { type: 'png', width: 200, margin: 1 });

        // Dimensiones: 80mm = 226.77pt
        const PAGE_W = 226.77;
        const MARGIN = 10;
        const CW = PAGE_W - MARGIN * 2; // 206.77
        const numItems      = traslado.items.length;
        const numInsidencias = insidencias.length;
        const PAGE_H = Math.max(500, 210 + numItems * 12 + 200 + (numInsidencias > 0 ? 30 + numInsidencias * 156 : 0));

        const doc = new PDFDocument({
            size: [PAGE_W, PAGE_H],
            margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            autoFirstPage: true
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=comprobante_${traslado.codigoTraslado}.pdf`);
        doc.pipe(res);

        let y = MARGIN;

        // --- LOGO ---
        const logoPath = path.join(__dirname, '../public/img/logo.png');
        try {
            const logoW = 45;
            doc.image(logoPath, (PAGE_W - logoW) / 2, y, { width: logoW });
            y += 52;
        } catch (_) {
            y += 5;
        }

        // --- TÍTULO ---
        doc.fontSize(9).font('Helvetica-Bold')
            .text('COMPROBANTE DE TRASLADO', MARGIN, y, { width: CW, align: 'center' });
        y += 14;

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
        y += 7;

        // --- DATOS DEL TRASLADO ---
        const campo = (label, valor) => {
            doc.fontSize(7).font('Helvetica-Bold').text(label, MARGIN, y, { width: 55, lineBreak: false });
            doc.font('Helvetica').text(String(valor), MARGIN + 55, y, { width: CW - 55, lineBreak: false, ellipsis: true });
            y += 11;
        };

        campo('Código:', traslado.codigoTraslado);
        campo('Fecha envío:', fmtFechaHora(traslado.fechaEnvio));
        campo('Fecha recibido:', fmtFechaHora(traslado.fechaRecepcion));
        const origenNombre = traslado.origen?.nombreComercial || traslado.origen?.razonSocial || traslado.idOrigen;
        campo('Origen:', origenNombre);
        campo('Destino:', destinoNombre);
        campo('Estado:', traslado.estado);
        campo('Despachado por:', nombreDespachador);
        if (nombreReceptor) campo('Recibido por:', nombreReceptor);

        y += 4;
        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
        y += 7;

        // --- TABLA DE ITEMS ---
        // Columnas: NOMBRE(80) | SKU(42) | CANT(18) | ESTADO(66.77)
        const C = {
            nombre: { x: MARGIN,      w: 80 },
            sku:    { x: MARGIN + 80,  w: 42 },
            cant:   { x: MARGIN + 122, w: 18 },
            estado: { x: MARGIN + 140, w: CW - 130 }
        };

        doc.fontSize(6.5).font('Helvetica-Bold');
        doc.text('PRODUCTO',  C.nombre.x, y, { width: C.nombre.w, lineBreak: false });
        doc.text('SKU',       C.sku.x,    y, { width: C.sku.w,    lineBreak: false });
        doc.text('CANT',      C.cant.x,   y, { width: C.cant.w,   lineBreak: false });
        doc.text('ESTADO',    C.estado.x, y, { width: C.estado.w, lineBreak: false });
        y += 10;

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.3).strokeColor('#aaaaaa').stroke().strokeColor('black');
        y += 4;

        doc.fontSize(6.5).font('Helvetica');
        for (const item of traslado.items) {
            let nombre, sku, estado;

            if (!item.idProducto && item.pack) {
                nombre = item.pack.codigoEtiqueta;
                sku    = '';
                estado = item.estado;
            } else if (item.producto) {
                nombre = item.producto.nombreProducto;
                sku    = item.producto.sku;
                estado = '';
            } else {
                nombre = 'N/A';
                sku    = '';
                estado = '';
            }

            doc.text(nombre, C.nombre.x, y, { width: C.nombre.w, lineBreak: false, ellipsis: true });
            doc.text(sku,    C.sku.x,    y, { width: C.sku.w,    lineBreak: false, ellipsis: true });
            doc.text(String(item.cantidad), C.cant.x, y, { width: C.cant.w, lineBreak: false });
            doc.text(estado, C.estado.x, y, { width: C.estado.w, lineBreak: false, ellipsis: true });
            y += 11;
        }

        y += 4;
        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor('black').stroke();
        y += 7;

        // --- NOTAS ---
        if (traslado.notas) {
            doc.fontSize(7).font('Helvetica-Bold').text('Notas:', MARGIN, y, { width: CW, lineBreak: false });
            y += 11;
            doc.fontSize(6.5).font('Helvetica').text(traslado.notas, MARGIN, y, { width: CW });
            y = doc.y + 6;
        }

        // --- INCIDENCIAS REPORTADAS ---
        if (insidencias.length > 0) {
            y += 6;
            doc.fontSize(8).font('Helvetica-Bold')
                .text('INCIDENCIAS REPORTADAS', MARGIN, y, { width: CW, align: 'center' });
            y += 14;

            const ROW_H  = 14;
            const COL_L  = 110;
            const COL_R  = CW - COL_L;

            const fillaCompleta = (texto, bgHex, negrita = false) => {
                if (bgHex) {
                    doc.rect(MARGIN, y, CW, ROW_H).fillAndStroke(bgHex, '#bbbbbb');
                } else {
                    doc.rect(MARGIN, y, CW, ROW_H).stroke('#bbbbbb');
                }
                doc.fillColor('black')
                    .fontSize(6.5)
                    .font(negrita ? 'Helvetica-Bold' : 'Helvetica')
                    .text(texto, MARGIN + 3, y + 3.5, { width: CW - 6, lineBreak: false, ellipsis: true });
                y += ROW_H;
            };

            const fillaDosCols = (izq, der) => {
                doc.rect(MARGIN,        y, COL_L, ROW_H).stroke('#bbbbbb');
                doc.rect(MARGIN + COL_L, y, COL_R, ROW_H).stroke('#bbbbbb');
                doc.fillColor('black').fontSize(6.5).font('Helvetica')
                    .text(izq, MARGIN + 3,         y + 3.5, { width: COL_L - 6, lineBreak: false, ellipsis: true })
                    .text(der, MARGIN + COL_L + 3, y + 3.5, { width: COL_R - 6, lineBreak: false, ellipsis: true });
                y += ROW_H;
            };

            for (const ins of insidencias) {
                let itemLabel = `Ítem #${ins.idDetalleTraslado}`;
                if (ins.detalle?.pack?.codigoEtiqueta)      itemLabel = ins.detalle.pack.codigoEtiqueta;
                else if (ins.detalle?.producto?.nombreProducto) itemLabel = ins.detalle.producto.nombreProducto;

                const empNombre = ins.empleado
                    ? `${ins.empleado.PrimerNombre} ${ins.empleado.PrimerApellido}`
                    : 'N/A';

                const diferencia = ins.cantidadOriginal - ins.cantidadAceptada;

                fillaCompleta('FECHA',                    '#e0e0e0', true);
                fillaCompleta(fmtFechaHora(ins.fechaInsidencia), null,      false);
                fillaCompleta('REPORTADO POR:',           '#e0e0e0', true);
                fillaCompleta(empNombre,                  null,      false);
                fillaCompleta('RAZÓN DE LA INSIDENCIA',  '#e0e0e0', true);
                fillaCompleta(ins.razonInsidencia || 'Sin descripción', '#fffde7', false);
                fillaDosCols('Producto:',        itemLabel);
                fillaDosCols('Cant. original',   String(ins.cantidadOriginal));
                fillaDosCols('Cant. aceptada',   String(ins.cantidadAceptada));
                fillaDosCols('Diferencia',       String(diferencia));

                y += 8;
            }
        }

        y += 4;
        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
        y += 8;

        // --- QR DE VERIFICACIÓN ---
        const QR_SIZE = 70;
        const qrX = (PAGE_W - QR_SIZE) / 2;
        doc.image(qrBuffer, qrX, y, { width: QR_SIZE });
        y += QR_SIZE + 5;

        doc.fontSize(5.5).font('Helvetica-Oblique')
            .text('Para más seguridad escanea el código y verifica el traslado', MARGIN, y, { width: CW, align: 'center' });
        y += 14;

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
        y += 7;

        // --- PIE DE PÁGINA ---
        const footer = 'EL TRASLADO DEBE SER ACEPTADO ANTES DE 72 HORAS, EN CASO QUE NO HAYAN CAMBIOS, LOS PRODUCTOS SE CARGARÁN DE NUEVO AL DESTINATARIO Y SE ENVIARÁ LA INSIDENCIA AL ADMINISTRADOR';
        doc.fontSize(5.5).font('Helvetica').text(footer, MARGIN, y, { width: CW, align: 'center' });

        doc.end();

    } catch (error) {
        console.error('Error generando comprobante de traslado:', error);
        res.status(500).send('Error interno al generar el comprobante');
    }
};

// Guía de empaque en PDF: el documento que se entrega en físico a quien arma los bultos.
// Por cada lote explica cuántas bolsas idénticas armar y con qué mezcla exacta de producto,
// y las conecta con el código de etiqueta ya impreso en cada bulto (imprimirEtiquetasLote)
// para que el empacador pueda ubicar sus bultos en la mesa sin adivinar.
const imprimirGuiaEmpaque = async (req, res) => {
    try {
        const { idDosificacion } = req.params;
        const __dirname = path.dirname(fileURLToPath(import.meta.url));

        // Mismo include/orden que verDosificacion: agrupar por numLote depende de que
        // los bultos lleguen ya ordenados por codigoEtiqueta.
        const dose = await Dosificaciones.findByPk(idDosificacion, {
            include: [{
                model: Pack,
                as: 'PACKs',
                include: [{
                    model: DetallesPack,
                    as: 'DETALLES_PACKs',
                    include: [{ model: Productos, as: 'producto', attributes: ['nombreProducto', 'sku'] }]
                }]
            }],
            order: [[{ model: Pack, as: 'PACKs' }, 'numLote', 'ASC'],
                    [{ model: Pack, as: 'PACKs' }, 'idPack', 'ASC']]
        });

        if (!dose) return res.status(404).send('Dosificación no encontrada');

        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
            if (!acc[pack.numLote]) acc[pack.numLote] = [];
            acc[pack.numLote].push(pack);
            return acc;
        }, {});

        const lotes = Object.keys(gruposLotes).sort((a, b) => a - b).map((numLote) => {
            const bultos = gruposLotes[numLote];
            const primerPack = bultos[0];
            // El include ordena por idPack (UUID), que no guarda relación con el correlativo
            // impreso en la etiqueta — para el rango hay que ordenar por el código en sí.
            const codigosOrdenados = bultos.map((p) => p.codigoEtiqueta).sort();
            return {
                numLote: Number(numLote),
                esResiduo: primerPack.tipo === 'RESIDUO',
                cantidadBultos: bultos.length,
                codigoInicio: codigosOrdenados[0],
                codigoFin: codigosOrdenados[codigosOrdenados.length - 1],
                // Cantidad 0 significa "este producto no entra en esta bolsa": el algoritmo de
                // kitting igual la deja en el detalle (asigna un piso proporcional a cada
                // referencia). Mostrarla en la guía confundiría al empacador.
                detalles: primerPack.DETALLES_PACKs
                    .filter((d) => d.cantidad > 0)
                    .map((d) => ({
                        nombreProducto: d.producto?.nombreProducto || 'Producto eliminado',
                        sku: d.producto?.sku || '—',
                        cantidad: d.cantidad
                    }))
            };
        });

        const prefijoDose = dose.idDosificacion.substring(0, 4).toUpperCase();
        const totalBultos = dose.PACKs.length;

        const PAGE_W = 595.28; // A4
        const PAGE_H = 841.89;
        const MARGIN = 40;
        const CW = PAGE_W - MARGIN * 2;

        const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=guia-empaque-D${prefijoDose}.pdf`);
        doc.pipe(res);

        let y = MARGIN;

        // --- ENCABEZADO ---
        try {
            doc.image(path.join(__dirname, '../public/img/logo.png'), MARGIN, y, { width: 55 });
        } catch (_) { /* sin logo, seguimos sin bloquear el documento */ }

        doc.fillColor('#111827').fontSize(18).font('Helvetica-Bold')
            .text('Guía de Empaque', MARGIN + 68, y + 4, { width: CW - 68 });
        doc.fillColor('#6b7280').fontSize(10).font('Helvetica')
            .text(`Dosificación D${prefijoDose} · ${formatearFecha(dose.fecha)}`, MARGIN + 68, y + 26, { width: CW - 68 });
        y += 65;

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(1).strokeColor('#e5e7eb').stroke();
        y += 16;

        // --- RESUMEN ---
        const colW = CW / 4;
        const resumen = [
            ['Unid. por bolsa', dose.capacidadBolsa],
            ['Total unidades', Number(dose.totalUnidades).toLocaleString('es-CO')],
            ['Total bultos', totalBultos],
            ['Lotes', lotes.length]
        ];
        resumen.forEach(([label, valor], i) => {
            const x = MARGIN + colW * i;
            doc.fillColor('#9ca3af').fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x, y, { width: colW - 10 });
            doc.fillColor('#111827').fontSize(16).font('Helvetica-Bold').text(String(valor), x, y + 12, { width: colW - 10 });
        });
        doc.fillColor('#000');
        y += 50;

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(1).strokeColor('#e5e7eb').stroke();
        y += 20;

        // --- UNA SECCIÓN POR LOTE ---
        const ROW_H = 18;
        // El SKU necesita bastante más ancho que el resto: los códigos de este catálogo
        // llegan a 17 caracteres y con poco espacio pdfkit los partía en dos líneas,
        // pisando la fila de abajo. Se define una vez: la usan tanto cada tabla de lote
        // como el resumen final, para que las columnas queden alineadas entre secciones.
        const col = {
            producto: { x: MARGIN + 10, w: 190 },
            sku:      { x: MARGIN + 210, w: 175 },
            cantidad: { x: MARGIN + CW - 90, w: 80 }
        };
        for (const lote of lotes) {
            const alturaLote = 36 + ROW_H * (lote.detalles.length + 1 + (lote.esResiduo ? 1 : 0)) + 16;
            if (y + alturaLote > PAGE_H - MARGIN) {
                doc.addPage();
                y = MARGIN;
            }

            const colorFondo = lote.esResiduo ? '#FDE7F2' : '#F3F4F6';
            const colorTexto = lote.esResiduo ? '#E24C95' : '#111827';
            const plural = lote.cantidadBultos > 1;
            const titulo = lote.esResiduo
                ? `Pack de saldo — arma ${lote.cantidadBultos} bolsa${plural ? 's' : ''} así`
                : `Lote ${lote.numLote} — arma ${lote.cantidadBultos} bolsa${plural ? 's idénticas' : ''} así`;
            const rangoEtiquetas = lote.codigoInicio === lote.codigoFin
                ? `Etiqueta ${lote.codigoInicio}`
                : `Etiquetas ${lote.codigoInicio} a ${lote.codigoFin}`;

            const BAND_H = 28;
            const tituloW = CW * 0.55;
            doc.rect(MARGIN, y, CW, BAND_H).fill(colorFondo);
            doc.fillColor(colorTexto).fontSize(11).font('Helvetica-Bold')
                .text(titulo, MARGIN + 10, y + 8, { width: tituloW - 10, lineBreak: false, ellipsis: true });
            doc.fillColor(colorTexto).fontSize(8).font('Helvetica')
                .text(rangoEtiquetas, MARGIN + tituloW, y + 10, { width: CW - tituloW - 10, align: 'right', lineBreak: false });
            doc.fillColor('#000');
            y += BAND_H + 8;

            // Encabezado de tabla del lote.
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#9ca3af');
            doc.text('PRODUCTO', col.producto.x, y, { width: col.producto.w, lineBreak: false });
            doc.text('SKU', col.sku.x, y, { width: col.sku.w, lineBreak: false });
            doc.text('CANT. / BOLSA', col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
            y += 14;
            doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
            y += 6;

            doc.fillColor('#111827').font('Helvetica').fontSize(10);
            lote.detalles.forEach((d) => {
                doc.font('Helvetica').fontSize(10).fillColor('#111827')
                    .text(d.nombreProducto, col.producto.x, y, { width: col.producto.w, lineBreak: false, ellipsis: true });
                doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
                    .text(d.sku, col.sku.x, y, { width: col.sku.w, lineBreak: false, ellipsis: true });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
                    .text(String(d.cantidad), col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
                y += ROW_H;
            });

            // El saldo es la única bolsa que no repite capacidad completa — vale la pena
            // marcar cuánto suma en total, para que quede claro que es un remanente chico.
            if (lote.esResiduo) {
                const totalSaldo = lote.detalles.reduce((acc, d) => acc + d.cantidad, 0);
                doc.moveTo(col.cantidad.x - 10, y).lineTo(MARGIN + CW, y).lineWidth(0.5).strokeColor('#f4c9de').stroke();
                y += 4;
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#E24C95')
                    .text('TOTAL SALDO', col.producto.x, y, { width: col.producto.w + col.sku.w, lineBreak: false });
                doc.text(String(totalSaldo), col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
                y += ROW_H - 4;
            }

            y += 16;
        }

        // --- TOTAL GENERAL POR PRODUCTO ---
        // Suma cada línea (cantidad por bolsa × cantidad de bultos de ese lote) para dar
        // el total real que debe salir de esta dosificación, sin importar en cuántos
        // lotes distintos haya quedado repartido el mismo producto.
        const totalesPorSku = new Map();
        lotes.forEach((lote) => {
            lote.detalles.forEach((d) => {
                const acumulado = totalesPorSku.get(d.sku) || { nombreProducto: d.nombreProducto, sku: d.sku, total: 0 };
                acumulado.total += d.cantidad * lote.cantidadBultos;
                totalesPorSku.set(d.sku, acumulado);
            });
        });
        const totalesOrdenados = [...totalesPorSku.values()].sort((a, b) => a.nombreProducto.localeCompare(b.nombreProducto));
        const granTotal = totalesOrdenados.reduce((acc, t) => acc + t.total, 0);

        const alturaResumen = 40 + ROW_H * (totalesOrdenados.length + 1) + 20;
        if (y + alturaResumen > PAGE_H - MARGIN) {
            doc.addPage();
            y = MARGIN;
        }

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(1).strokeColor('#e5e7eb').stroke();
        y += 16;

        doc.fillColor('#111827').fontSize(13).font('Helvetica-Bold').text('Total General por Producto', MARGIN, y);
        y += 22;

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#9ca3af');
        doc.text('PRODUCTO', col.producto.x, y, { width: col.producto.w, lineBreak: false });
        doc.text('SKU', col.sku.x, y, { width: col.sku.w, lineBreak: false });
        doc.text('TOTAL GLOBAL', col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
        y += 14;
        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
        y += 6;

        totalesOrdenados.forEach((t) => {
            doc.font('Helvetica').fontSize(10).fillColor('#111827')
                .text(t.nombreProducto, col.producto.x, y, { width: col.producto.w, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
                .text(t.sku, col.sku.x, y, { width: col.sku.w, lineBreak: false, ellipsis: true });
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
                .text(String(t.total), col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
            y += ROW_H;
        });

        doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor('#111827').stroke();
        y += 6;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
            .text('TOTAL GENERAL', col.producto.x, y, { width: col.producto.w + col.sku.w, lineBreak: false });
        doc.text(String(granTotal), col.cantidad.x, y, { width: col.cantidad.w, align: 'right', lineBreak: false });
        y += ROW_H;

        // --- PIE ---
        doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#9ca3af')
            .text('Verifica cada bolsa contra esta guía antes de sellarla y etiquetarla.', MARGIN, PAGE_H - MARGIN - 12, { width: CW, align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Error generando guía de empaque:', error);
        res.status(500).send('Error interno al generar la guía de empaque');
    }
};

const historialPack = async (req, res) => {
    try {
        const { idPack } = req.params;

        const pack = await Pack.findByPk(idPack, {
            attributes: ['idPack', 'codigoEtiqueta', 'numLote', 'tipo', 'estado', 'contadorReimpresiones', 'createdAt'],
        });
        if (!pack) return res.status(404).json({ error: 'Pack no encontrado' });

        // Traslados en los que participó este pack
        const detalles = await DetalleTraslados.findAll({
            where: { idPack },
            include: [{
                model: Traslados,
                include: [
                    { model: PuntosDeVenta, as: 'origen', attributes: ['nombreComercial'] },
                    { model: PuntosDeVenta, as: 'destino', attributes: ['nombreComercial'] },
                    { model: InsidenciaTraslado, as: 'insidencias', attributes: ['idInsidencia', 'razonInsidencia', 'cantidadOriginal', 'cantidadAceptada', 'resuelta', 'fechaInsidencia'] },
                ]
            }]
        });

        const traslados = detalles.map(d => {
            const t = d.TRASLADO || d.Traslado || d.traslado || {};
            return {
                idTraslado:    t.idTraslado,
                estado:        t.estado,
                origen:        t.origen?.nombreComercial || '—',
                destino:       t.destino?.nombreComercial || '—',
                fecha:         t.createdAt,
                controversias: (t.insidencias || []).map(i => ({
                    razon:             i.razonInsidencia,
                    cantidadOriginal:  i.cantidadOriginal,
                    cantidadAceptada:  i.cantidadAceptada,
                    resuelta:          i.resuelta,
                    fecha:             i.fechaInsidencia,
                })),
            };
        });

        res.json({
            pack: pack.toJSON(),
            traslados,
            desempacado: pack.estado === 'DESEMPACADO',
            tieneControversias: traslados.some(t => t.controversias.length > 0),
        });
    } catch (e) {
        console.error('historialPack:', e);
        res.status(500).json({ error: 'Error interno' });
    }
};

export {
    guardarDosificacion, homeDose, verDosificacionDetalle, obtenerMetadataDose,
    newDose, obtenerDosificacionesPaginadas, nroPacks, verDosificacion, widgetGlobales,
    obtenerProductosPorDose, trasladarPacks, imprimirEtiquetasLote, imprimirEtiquetasPorPack,
    imprimirComprobanteTraslado, historialPack, imprimirGuiaEmpaque
};