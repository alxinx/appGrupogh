-- ═══ DIAGNÓSTICO: "Mis Clientes" no aparece en /store ═══════════════════════
-- Solo lectura. Ejecutar contra la base de RDS.

-- 1. ¿EXISTE el recurso de tienda? Si la fila 'vendedor' no sale, ésa es la causa.
SELECT '1-RECURSO' AS paso, nombreRecurso, tipo, folder, idRecurso
FROM PERMISOS_RECURSOS
WHERE folder = '/clientes' OR nombreRecurso IN ('Mis Clientes','Clientes');

-- 2. Todas las carpetas 'vendedor' que el menú de tienda puede mostrar.
SELECT '2-CARPETAS' AS paso, nombreRecurso, folder
FROM PERMISOS_RECURSOS
WHERE tipo = 'vendedor' AND folder IS NOT NULL
ORDER BY folder;

-- 3. Qué carpetas recibe cada usuario (esto es exactamente `carpetasPermitidas`).
SELECT '3-USUARIO' AS paso, u.emailUsuario,
       GROUP_CONCAT(DISTINCT r.folder ORDER BY r.folder SEPARATOR ' ') AS carpetas,
       IF(SUM(r.folder = '/clientes') > 0, 'SI', 'NO') AS ve_clientes
FROM USUARIOS u
JOIN USER_PERMISOS up      ON up.idUsuario = u.idUsuario
JOIN PERMISOS_RECURSOS r   ON r.idRecurso  = up.idRecurso
WHERE r.tipo = 'vendedor' AND r.folder IS NOT NULL
GROUP BY u.idUsuario, u.emailUsuario
ORDER BY u.emailUsuario;
