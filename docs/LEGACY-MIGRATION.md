# Migración de legacy a `/app`

Objetivo: que toda la experiencia de usuario viva en `/app` y retirar la interfaz `/admin` cuando la paridad operativa esté verificada.

## Decisiones de producto

- El wizard de creación de sitios no se migra: los sitios los crea un administrador de plataforma fuera del flujo de usuario.
- No se migra una biblioteca global de medios: las imágenes se administran desde el post, Brand Kit y Social Pack.
- El índice global de Social Pack no se migra: el pack vive junto a cada post.
- El flujo de revisión humana queda deshabilitado para `/app`; publicar y programar son directos.
- Magic link y token son los únicos accesos de `/app`. El correo se entrega mediante Resend cuando `RESEND_API_KEY` está configurada.
- Las vistas alternativas de legacy quedan marcadas como pendientes de eliminación, no como requisito de paridad.

## Inventario de legacy que eliminaremos

| Área legacy | Estado en `/app` | Acción antes de borrar `/admin` |
| --- | --- | --- |
| Wizard de creación de sitios | No se migra por decisión | Eliminar junto con la vista legacy cuando no haya enlaces internos |
| Biblioteca global de medios | No se migra por decisión | Eliminar solo si no quedan integraciones que llamen `/api/admin/media` |
| Social Pack global separado | Sustituido por Social Pack por post | Verificar enlaces externos a `/admin/blog-packs` |
| Revisión humana, `review` y `changes_requested` | Bypass directo en `/app` | Retirar del frontend legacy; conservar backend temporalmente para compatibilidad |
| Vistas alternativas/listado legacy | Pendiente | Eliminar tras validar el listado y filtros de `/app` |
| Login con contraseña legacy | Sustituido por magic link/token | Eliminar cuando todos los usuarios tengan email verificable |

## Paridad que todavía debemos cerrar

- Confirmar programación directa y que todos los posts programados aparezcan como `scheduled` en listado y calendario.
- Mantener selector de fecha propio, navegación atrás y mensajes toast en todas las acciones mutables.
- Completar recuperación y descarte de borradores locales.
- Completar importación ZIP de Brand Kit y refresco de referencias.
- Validar permisos de `admin`, `agency_admin` y `client` en cada pantalla de `/app`.
- Verificar envío real de magic links con Resend en staging.

## Criterio de retiro

No redirigir `/admin` todavía. Se podrá retirar la interfaz cuando este documento no tenga pendientes P0/P1, las pruebas de permisos y los flujos de publicar/programar pasen en staging, y se confirme que no existen enlaces externos a las superficies legacy.
