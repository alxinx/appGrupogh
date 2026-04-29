// Map<idPuntoDeVenta, Set<Response>>
const clients = new Map();

export const addClient = (idPdv, res) => {
    if (!clients.has(idPdv)) clients.set(idPdv, new Set());
    clients.get(idPdv).add(res);
};

export const removeClient = (idPdv, res) => {
    clients.get(idPdv)?.delete(res);
};

export const sendEvent = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const broadcast = (idPdv, event, data) => {
    clients.get(idPdv)?.forEach(res => sendEvent(res, event, data));
};
