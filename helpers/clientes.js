import { Clientes, ClientesTributario, ClientesUbicacion, Departamentos, Municipios } from '../models/index.js';

// Alta de un cliente: las TRES tablas que toca, en un solo lugar.
//
// Un cliente no es una fila: es CLIENTES + CLIENTES_TRIBUTARIO + CLIENTES_UBICACION. El
// formulario del panel (saveCliente) y la importación masiva de Excel crean exactamente lo
// mismo, así que el insert vive acá y cada uno aporta lo suyo — el formulario sus
// validaciones y sus documentos a R2, la importación su lectura del Excel y su informe.
//
// No valida: quien llama decide qué es una fila aceptable y con qué mensaje la rechaza.
// Acá se arma el registro y se escribe.

/** Todo el ENUM de CLIENTES.tipoDocumento. */
export const TIPOS_DOC_CLIENTE = ['CC', 'CE', 'TI', 'NIT', 'PP', 'PPT', 'PEP'];

/** Los que puede llevar una persona natural en el formulario del panel (sin NIT). */
export const TIPOS_DOC_CLIENTE_NATURAL = ['CC', 'CE', 'TI', 'PP', 'PPT', 'PEP'];

// Códigos DIAN de CLIENTES_TRIBUTARIO.regimen_fiscal. El 49 es el default histórico del
// formulario: la mayoría de los clientes de mostrador no son responsables de IVA.
export const REGIMEN_RESPONSABLE_IVA = '48';
export const REGIMEN_NO_RESPONSABLE_IVA = '49';

// Responsabilidades fiscales DIAN que puede declarar un cliente. R-99-PN significa "no
// aplica ninguna", así que no puede ir junto con las demás.
export const CODIGOS_RESPONSABILIDAD_FISCAL = ['O-13', 'O-15', 'O-23', 'O-47', 'R-99-PN'];

/**
 * Normaliza lo que llega del formulario (arreglo o "O-13,O-15") a la cadena que guarda
 * CLIENTES_TRIBUTARIO.responsabilidad_fiscal, descartando cualquier código que no esté en
 * la lista: un código inventado en el navegador no puede terminar en una factura.
 * Devuelve null si no queda ninguno — "no declarado" no es lo mismo que R-99-PN.
 */
export const normalizarResponsabilidades = (valor) => {
    const codigos = (Array.isArray(valor) ? valor : String(valor ?? '').split(','))
        .map(c => String(c).trim().toUpperCase())
        .filter(c => CODIGOS_RESPONSABILIDAD_FISCAL.includes(c));
    return codigos.length ? [...new Set(codigos)].join(',') : null;
};

/**
 * Dígito de verificación de un NIT, con el algoritmo de la DIAN (módulo 11 sobre los
 * pesos oficiales). Sirve para detectar un NIT mal digitado: el DV que trae el RUT tiene
 * que coincidir con el que sale del número. Devuelve null si el NIT no es numérico.
 */
const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
export const calcularDvNit = (nit) => {
    const limpio = String(nit ?? '').trim();
    if (!/^\d{1,15}$/.test(limpio)) return null;
    const suma = [...limpio].reverse()
        .reduce((acc, d, i) => acc + Number(d) * PESOS_DV[i], 0);
    const residuo = suma % 11;
    return String(residuo > 1 ? 11 - residuo : residuo);
};

/**
 * 'JUAN pérez' → 'Juan Pérez'. Los nombres se guardan así en todo el panel.
 *
 * Una sigla se deja en mayúsculas: 'S.A.S' no puede quedar 'S.a.s'. Se reconoce por el punto
 * (o los dos puntos de un 'S.A:S' mal tecleado) SEGUIDO de otra letra — un punto al final no
 * cuenta, para que 'Ltda.' no termine en 'LTDA.'.
 */
const ES_SIGLA = /[.:](?=[\p{L}])/u;

export const toPascal = (str) => (str
    ? str.trim().replace(/\S+/g, (w) => (ES_SIGLA.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    : null);

/**
 * Valida un par departamento + municipio contra el catálogo DANE y devuelve sus nombres.
 *
 * Los nombres salen SIEMPRE de la base, nunca del body: el navegador mandaba el texto de la
 * opción elegida, y con el select sin elegir eso era "Seleccionar..." / "— selecciona una
 * ciudad —", que quedaba guardado como si fuera un lugar. Los ids son los códigos DIVIPOLA
 * (strings con cero a la izquierda), así que se comparan como string.
 *
 * @returns `{ ok: true, idDepartamento, nombreDepartamento, idMunicipio, nombreMunicipio }`
 *          o `{ ok: false, mensaje }` con un texto listo para mostrarle al operador.
 */
export const resolverUbicacionDane = async (idDepartamento, idMunicipio, transaction) => {
    const idDep = String(idDepartamento ?? '').trim();
    const idMun = String(idMunicipio ?? '').trim();
    if (!idDep) return { ok: false, mensaje: 'Selecciona el departamento del cliente.' };
    if (!idMun) return { ok: false, mensaje: 'Selecciona la ciudad del cliente.' };

    const [deptoRow, munRow] = await Promise.all([
        Departamentos.findOne({ where: { id: idDep }, attributes: ['id', 'nombre'], raw: true, transaction }),
        Municipios.findOne({ where: { id: idMun }, attributes: ['id', 'nombre', 'departamento_id'], raw: true, transaction })
    ]);
    if (!deptoRow) return { ok: false, mensaje: 'El departamento seleccionado no existe.' };
    if (!munRow)   return { ok: false, mensaje: 'La ciudad seleccionada no existe.' };
    if (String(munRow.departamento_id) !== String(deptoRow.id)) {
        return { ok: false, mensaje: 'La ciudad seleccionada no pertenece a ese departamento.' };
    }

    return {
        ok: true,
        idDepartamento:     deptoRow.id,
        nombreDepartamento: deptoRow.nombre,
        idMunicipio:        munRow.id,
        nombreMunicipio:    munRow.nombre
    };
};

/**
 * Crea el cliente con su fila tributaria y, si hay datos, su ubicación principal.
 *
 * Los nombres de departamento y municipio se guardan desnormalizados en
 * CLIENTES_UBICACION (así los lee el resto del panel sin join). Si quien llama ya los tiene
 * —una importación que precargó el catálogo— los pasa y acá no se consulta nada: un
 * `findOne` por fila dentro de un for es justo el N+1 que no se hace (CLAUDE.md §7).
 *
 * @param datos  campos ya elegidos uno por uno por quien llama (nunca un `req.body`
 *               entero: CLAUDE.md §12)
 * @param transaction  la transacción en la que se escribe; obligatoria, son tres tablas
 * @returns el idCliente creado
 */
export const crearClienteCompleto = async (datos, transaction) => {
    const {
        tipo_persona, tipoDocumento, numero_doc, digito_verif,
        razon_social, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
        email, telefono, genero,
        regimen_fiscal, responsabilidad_fiscal,
        gran_contribuyente, autorretenedor, agente_retencion, obligado_aduanero,
        ciiu, descripcion_ciiu, fecha_rut,
        ubicacion, idCliente: idClienteFijo
    } = datos;

    const cliente = await Clientes.create({
        // Opcional: quien necesita el id antes del insert (para nombrar sus archivos en R2)
        // lo genera y lo pasa. Si no viene, lo genera Sequelize.
        ...(idClienteFijo && { idCliente: idClienteFijo }),
        tipo_persona: tipo_persona || 'N',
        tipoDocumento: tipoDocumento || 'CC',
        numero_doc,
        digito_verif: digito_verif || null,
        razon_social: razon_social || null,
        primer_nombre: primer_nombre || null,
        segundo_nombre: segundo_nombre || null,
        primer_apellido: primer_apellido || null,
        segundo_apellido: segundo_apellido || null,
        email: email || null,
        telefono: telefono || null,
        genero: genero || null,
        activo: true,
        credito: false
    }, { transaction });

    const idCliente = cliente.idCliente;

    await ClientesTributario.create({
        idCliente,
        regimen_fiscal: regimen_fiscal || REGIMEN_NO_RESPONSABLE_IVA,
        responsabilidad_fiscal: normalizarResponsabilidades(responsabilidad_fiscal),
        gran_contribuyente: Boolean(gran_contribuyente),
        autorretenedor: Boolean(autorretenedor),
        agente_retencion: Boolean(agente_retencion),
        obligado_aduanero: Boolean(obligado_aduanero),
        ciiu: ciiu || null,
        descripcion_ciiu: descripcion_ciiu || null,
        fecha_rut: fecha_rut || null
    }, { transaction });

    // Sin departamento ni dirección no hay ubicación que guardar: una fila con los tres
    // campos en null no dice nada y después aparece como "ubicación principal" vacía.
    if (ubicacion && (ubicacion.idDepartamento || ubicacion.direccion?.trim())) {
        let { nombreDepartamento, nombreMunicipio } = ubicacion;

        if (nombreDepartamento === undefined || nombreMunicipio === undefined) {
            const [deptoRow, munRow] = await Promise.all([
                ubicacion.idDepartamento
                    ? Departamentos.findOne({ where: { id: ubicacion.idDepartamento }, raw: true, transaction })
                    : null,
                ubicacion.idMunicipio
                    ? Municipios.findOne({ where: { id: ubicacion.idMunicipio }, raw: true, transaction })
                    : null
            ]);
            if (nombreDepartamento === undefined) nombreDepartamento = deptoRow?.nombre || null;
            if (nombreMunicipio === undefined) nombreMunicipio = munRow?.nombre || null;
        }

        await ClientesUbicacion.create({
            idCliente,
            idDepartamento: ubicacion.idDepartamento || null,
            nombreDepartamento: nombreDepartamento || null,
            idMunicipio: ubicacion.idMunicipio || null,
            nombreMunicipio: nombreMunicipio || null,
            direccion: ubicacion.direccion || null,
            codigo_postal: ubicacion.codigo_postal || null,
            es_principal: true
        }, { transaction });
    }

    return idCliente;
};
