# PWA V3: experiencia editorial

## Navegación

La navegación principal es:

- Inicio
- Crear
- Contenido
- Calendario
- Publicación

Administración contiene Marca, Brand Kit, Equipo y permisos, Canales y conexiones, y Plan y uso.

## Pantalla Post

`/app/content/:postId` es la pantalla principal. Presenta título, marca, campaña opcional, estado, variantes por canal, editor, preview, validación de Brand Kit, assets, historial y destino de publicación.

La pantalla tiene una única acción primaria según el estado. En móvil, el rail de revisión se abre como `Drawer` y la acción primaria permanece visible en una barra inferior.

## Lenguaje visual

La dirección es editorial calmada: jerarquía clara, pocas decisiones por pantalla, densidad moderada, estados comprensibles y proveedores ocultos detrás de destinos amigables.

Toda pantalla debe implementar carga, vacío, error y éxito. Los controles deben salir de `src/ui`, usar tokens `--ui-*`, pasar por i18n y funcionar con teclado.

## Calendario y publicación

Calendario muestra únicamente la vista mensual. La búsqueda combina título y campaña, por lo que no depende de un selector que crece con el número de campañas. Cada entrada abre el Post o su detalle de ejecución.

Publicación selecciona Posts mediante búsqueda y lista acotada, no mediante un `select` con todos los registros. Los canales se activan con `Switch`; variantes programadas, publicadas o en sincronización quedan visibles pero no se pueden volver a enviar. Los assets huérfanos se agrupan por `generationRunId` o `preparationId`, muestran miniaturas y permiten crear un único Post por grupo o combinar grupos manualmente.

Las referencias canónicas retiradas no se vuelven a importar al Brand Kit. La biblioteca visual se actualiza localmente después de editar o eliminar para que la siguiente operación no dependa de recargar la página.
