import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentarCalificacion, CRITERIOS_CALIFICACION } from '../helpers/confeccionistas.js';

// Contrato entre el script de calificación de confeccionistas y la vista
// (helpers/confeccionistas.js, views/components/calificacionTaller.pug).

test('sin datos o con datos inválidos queda "Sin calificar" (null), nunca un puntaje inventado', () => {
    for (const cruda of [undefined, null, {}, { puntaje: null }, { puntaje: 'abc' }, { puntaje: '' }]) {
        assert.equal(presentarCalificacion(cruda), null);
    }
});

test('presenta puntaje, nivel y criterios en el formato de la vista', () => {
    const c = presentarCalificacion({
        puntaje: 4.66, criterios: { calidad: 4.9, cumplimiento: 4.4 }, trabajosEvaluados: 12, actualizadoEn: new Date('2026-11-20T12:00:00')
    });
    assert.equal(c.puntaje, 4.7);
    assert.equal(c.texto, '4,7');
    assert.equal(c.porcentaje, 94);
    assert.equal(c.nivel, 'excelente');
    assert.equal(c.trabajosTexto, '12 trabajos evaluados');
    assert.deepEqual(c.criterios.map(x => x.clave), CRITERIOS_CALIFICACION.map(x => x.clave));
    const insumos = c.criterios.find(x => x.clave === 'insumos');
    assert.equal(insumos.puntaje, null);
    assert.equal(insumos.texto, 'Sin datos');
});

test('topa el puntaje entre 0 y 5 y asigna el nivel por umbral', () => {
    assert.equal(presentarCalificacion({ puntaje: 9 }).puntaje, 5);
    assert.equal(presentarCalificacion({ puntaje: -2 }).nivel, 'bajo');
    assert.equal(presentarCalificacion({ puntaje: 3.5 }).nivel, 'bueno');
    assert.equal(presentarCalificacion({ puntaje: 3.4 }).nivel, 'regular');
    assert.equal(presentarCalificacion({ puntaje: 1, trabajosEvaluados: 1 }).trabajosTexto, '1 trabajo evaluado');
});
