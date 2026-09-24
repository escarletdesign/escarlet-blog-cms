# Sitemap de Escarlet CMS

Documento de referencia para distinguir navegación principal, pestañas y flujos secundarios.

## Entrada y navegación principal

```text
/app
├── /                         Resumen y KPIs de la marca activa
├── /plans                    Contenido, filtros, lista y calendario
├── /chat                     Asistente, si está habilitado
├── /quick-create             Creación guiada, si está habilitada
├── /manual/:slug?            Editor manual
├── /preview/:slug            Vista del artículo y acceso al pack social
├── /schedule/:slug           Programación del artículo
├── /publish/:slug            Publicación social
├── /posts                    Listado histórico de posts
├── /admin?tab=brands         Administración unificada
│   ├── ?tab=brands           Marcas y creación de marca
│   ├── ?tab=team             Equipo y acceso
│   ├── ?tab=connections      Conexiones de la marca activa
│   └── ?tab=billing          Plan y uso, si la IA del CMS está habilitada
├── /brands/:brandId          Detalle de marca
│   ├── /identity             Brand kit e identidad
│   ├── /channels             Canales
│   └── /connections          Conexiones de esa marca
├── /settings                 Perfil, PAT y preferencias
├── /author-invite            Invitación de autor para flujos históricos
└── /design-system            Catálogo y contrato visual
```

## Alias y compatibilidad

- `/calendar`, `/review` y `/batches` redirigen a `/plans`.
- `/social-pack` sin slug redirige a `/plans`.
- `/team`, `/team/invite`, `/connections`, `/billing` y `/brands` redirigen al panel de Administración cuando el usuario es administrador. Se conserva la pantalla directa para roles que no tienen ese panel.
- `/social-pack/:slug` sigue siendo una ruta histórica del pack social. La vista de contenido de `/plans` es el punto recomendado para revisar, grabar, guardar, programar y publicar el contenido.

## Flujos normalizados

1. El selector de marca del shell define la marca activa en escritorio y móvil.
2. Administración mantiene una sola pantalla con pestañas persistidas en `?tab=`.
3. Invitar y editar miembros usan modal. La invitación selecciona marcas con pills y define el rol dentro de cada marca, sin rol predeterminado global.
4. Contenido es la bandeja principal. Cada item abre su vista completa, donde vive el Social Pack y el grabador de vídeo.
5. Las acciones de conexión y las pruebas informan con toast. El error de carga queda además visible dentro de la pantalla.
6. La navegación POP restaura el scroll guardado para la entrada anterior del historial.

## Candidatos huérfanos o históricos

- `TeamInviteView` era la pantalla duplicada de invitación. El flujo activo es el modal de `TeamView`; la URL antigua se conserva como redirección.
- `SocialPack` y `Preview` todavía son implementaciones separadas. La siguiente consolidación recomendada es extraer un único workspace de contenido con pestañas `Artículo` y `Social Pack`, manteniendo `/social-pack/:slug` como alias temporal.
- `/author-invite` no forma parte de la navegación principal. Mantenerlo solo si existe un flujo de autor externo; si no, moverlo a Administración o retirarlo.
- `/design-system` es una herramienta interna y no debe aparecer en la navegación de producto.

## Regla de decisión

Usar pestañas cuando las secciones comparten contexto, selección de marca y acciones, como Administración. Usar páginas cuando cambia el objeto de trabajo o se necesita una URL profunda, como el detalle de marca, el editor y el contenido individual. Un alias puede conservar compatibilidad, pero no debe crear una segunda pantalla funcional.
