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

La pantalla tiene una única acción primaria según el estado. El envío a revisión se aplica a la variante activa, por lo que un Post puede avanzar con Blog, Instagram o Story sin obligar a completar todos los formatos. En móvil, el rail de revisión se abre como `Drawer` y la acción primaria permanece visible en una barra inferior.

## Lenguaje visual

La dirección es editorial calmada: jerarquía clara, pocas decisiones por pantalla, densidad moderada, estados comprensibles y proveedores ocultos detrás de destinos amigables.

Toda pantalla debe implementar carga, vacío, error y éxito. Los controles deben salir de `src/ui`, usar tokens `--ui-*`, pasar por i18n y funcionar con teclado.

## Calendario y publicación

Calendario muestra únicamente la vista mensual. La búsqueda combina título y campaña, por lo que no depende de un selector que crece con el número de campañas. Cada entrada abre el Post o su detalle de ejecución.

Publicación selecciona Posts mediante búsqueda y lista acotada, no mediante un `select` con todos los registros. Los canales se activan con `Switch`; variantes programadas, publicadas o en sincronización quedan visibles pero no se pueden volver a enviar. Esta pantalla no mezcla medios ni crea Posts desde assets. La ruta `/media` es la biblioteca independiente de la marca: permite buscar, previsualizar y seleccionar imágenes y vídeos, incluidos los que todavía no tienen Post.

La eliminación desde `/media` es administrativa y requiere confirmación explícita. La biblioteca funciona como una galería: cada tarjeta se selecciona con clic, Shift amplía un rango, Ctrl o ⌘ suma elementos, arrastrar recorre tarjetas contiguas y los atajos permiten seleccionar visibles, limpiar o abrir el borrado. La barra de selección permanece visible mientras se desplaza la página.

Un administrador puede eliminar también medios vinculados: “Usado en contenido” indica una referencia activa desde un Post, vídeo, Brand Kit o procedencia de generación. El sistema quita sus referencias internas, revoca su procedencia y deja constancia en auditoría. La confirmación advierte que un Post o un vídeo puede quedar sin ese recurso y dejar de estar listo para publicar.

Las referencias canónicas retiradas no se vuelven a importar al Brand Kit. La biblioteca visual se actualiza localmente después de editar o eliminar para que la siguiente operación no dependa de recargar la página.
