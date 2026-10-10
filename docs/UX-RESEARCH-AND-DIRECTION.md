# Investigación UX y dirección de producto

Primera pasada: octubre de 2026.

## Contrato de esta investigación

La persona que usa Escarlet quiere convertir una idea, un asset o una campaña en contenido publicable para una marca, entender qué se ha generado y decidir si se revisa, se programa o se publica. El cambio que debe producir la interfaz es pasar de "¿en qué aplicación estoy?" a "¿qué contenido estoy preparando y cuál es el siguiente paso?".

Este documento separa la evidencia del repositorio, los patrones externos y las decisiones de diseño propuestas. No es todavía un rediseño visual ni una implementación.

## 1. Lo que existe hoy

### Superficies visibles

La navegación de `apps/pwa/src/App.tsx` expone actualmente:

- Resumen.
- Apps.
- Contenido, que concentra campañas, biblioteca de activos y la vista completa de un item.
- Food to Reel.
- Publisher.
- Calendario.
- Marcas.
- Equipo y acceso.
- Plan y uso.
- Asistente.
- Administración.
- Ajustes del perfil.

Además, se conservan rutas históricas o alias como `/posts`, `/preview/:slug`, `/social-pack/:slug`, `/review` y `/batches`. El sitemap del proyecto reconoce que hay dos implementaciones de preview y recomienda consolidarlas.

### Apps de usuario actuales

| Superficie | Entrada principal | Resultado actual | Problema de comprensión |
| --- | --- | --- | --- |
| Food to Reel | Imagen de plato, explicación y formato | Job de vídeo con estados de cola, proceso y revisión | El usuario recibe un estado de job, no una pieza editorial completa |
| Imagen y guion a Reel | Imagen y guion | Reel o Story genérico | Comparte motor con Food to Reel, pero se presenta como otra app |
| Menú del día a Reel o Story | Imagen, menú y audio opcional | Vídeo para revisar y publicar | La diferencia Reel/Story está dentro de la app, aunque conceptualmente es un perfil de salida |
| Producto a publicación social | Asset, formato e instrucciones | Variante derivada y acceso al Publisher | El resultado se muestra como una respuesta breve, sin comparación original/derivado |
| Publisher | Canal, proveedor, asset y copy | Bundle listo para revisión | Se siente como una app independiente, aunque es la última etapa de cualquier resultado |
| Contenido | Campaña, item, variantes, biblioteca y preview | Lista, filtros, preview, social pack, grabador y publicación | Es la superficie más cercana a un workspace, pero convive con rutas antiguas |
| Calendario | Publicaciones programadas | Lista o mes | Muestra fechas y canales, pero no es la vista de planificación de la campaña completa |
| Asistente | Conversación y memoria de marca | Borradores y acciones | Está separado del resto del flujo aunque crea los mismos items |
| Administración | Marcas, equipo, conexiones y billing | Pestañas más rutas de detalle de marca | Mezcla gobierno del espacio con configuración operativa de cada marca |

### Capabilities que no deberían ser apps

El catálogo también contiene primitives como contexto de marca, voz, estilo visual, referencias, validación de copy, registro de assets, transformación de producto, motion, destinos y estados de publicación. Son buenas fronteras del sistema, pero no deberían aparecer como destinos principales para una persona no técnica.

La distinción útil es:

```text
capability = pieza interna reutilizable
recipe = composición de producción
workspace de contenido = lugar donde se revisa el resultado
```

El dashboard `/apps` hoy mezcla recipes, capabilities, IDs técnicos y la etiqueta `MCP v3`. Es correcto para descubrimiento técnico, pero no es un buen menú de producto.

## 2. Diagnóstico de experiencia

### A. La navegación está organizada por implementación, no por trabajo

La persona tiene que decidir si quiere ir a Food to Reel, Contenido, Publisher o Calendario. En realidad está intentando hacer una de estas cosas:

1. Crear algo.
2. Revisar lo que se ha generado.
3. Preparar una publicación.
4. Entender qué está pendiente.
5. Configurar el espacio y la marca.

La arquitectura actual distribuye una misma tarea entre varias rutas. El resultado es más cambio de contexto, más nombres que aprender y más posibilidades de que el usuario pierda una pieza generada.

### B. El resultado no tiene una forma común

Food to Reel devuelve un estado de proceso, Product to Social devuelve una tarjeta de resultado y ContentPackPreview devuelve una composición de tarjetas por canal. Los tres deberían ser variaciones de un mismo objeto: un `Content Run` o `Production Run` que contiene artefactos, validaciones, procedencia y acciones.

### C. La arquitectura se filtra en el lenguaje

`Recipe`, `Capability`, `MCP v3`, `job`, `provider`, `bundle` y `runId` son conceptos valiosos para el sistema. En la UI de cliente deberían vivir dentro de un panel de detalles, no en el primer nivel de decisión.

### D. Administración mezcla dos escalas

El panel de Administración agrupa marcas, miembros, conexiones y billing. A la vez, el detalle de marca ofrece identidad, canales y conexiones. La solución no es añadir otra pestaña, sino separar:

- Gobierno del espacio: miembros, roles, plan y límites.
- Operación de una marca: identidad, canales, conexiones y reglas editoriales.

### E. El sistema ya tiene el modelo de datos para unificar la experiencia

El dominio actual ya distingue campaña, item de contenido, variante, asset, procedencia, aprobación, agenda y publicación. La oportunidad principal es reflejar ese modelo en la interfaz, no crear otro modelo paralelo.

## 3. Dirección propuesta

### Idea de producto

Escarlet debería sentirse como un estudio de contenido con una bandeja de revisión, no como un lanzador de microapps.

### Navegación propuesta

```text
Marca activa
  ├── Inicio
  ├── Crear
  │   ├── Desde una idea
  │   ├── Desde una imagen
  │   ├── Desde un menú
  │   ├── Desde un producto
  │   └── Reutilizar contenido existente
  ├── Contenido
  │   ├── Pendiente de revisión
  │   ├── Campañas
  │   └── Biblioteca
  ├── Calendario
  └── Publicación

Administración
  ├── Marca
  ├── Equipo y permisos
  ├── Canales y conexiones
  └── Plan y uso
```

La decisión importante es que `Crear` sea una entrada única. Las recipes siguen existiendo, pero se eligen por intención y no por ID. `Asistente` puede ser uno de los modos de Crear, no una isla de navegación.

### Resultado unificado: Content Run

Cada ejecución de una app debería abrir el mismo tipo de workspace:

```text
┌─────────────────────────────────────────────────────────────┐
│ Título del resultado · marca · estado · última actualización │
├───────────────────────────────┬─────────────────────────────┤
│ Artefacto principal            │ Revisión y siguiente paso   │
│                               │                             │
│ Vídeo, imagen, artículo o pack │ Estado de marca y copy      │
│ Vista adaptada al canal        │ Advertencias y procedencia  │
│                               │ Destinos y calendario       │
├───────────────────────────────┴─────────────────────────────┤
│ Variantes por canal · original · derivados · historial       │
├─────────────────────────────────────────────────────────────┤
│ Editar · Pedir cambios · Aprobar · Programar · Publicar       │
└─────────────────────────────────────────────────────────────┘
```

#### Cabecera

- Nombre humano del contenido.
- Marca activa.
- Recipe resumida, por ejemplo "Menú del día".
- Estado de alto nivel.
- Fecha y persona que inició la ejecución.

#### Artefacto principal

- Vídeo: reproductor, portada, formato y guion.
- Imagen: comparación original/derivada y selector de formato.
- Blog: artículo con título, extracto, cuerpo y SEO.
- Pack: vista por canales con preview específico de cada plataforma.

#### Rail de revisión

- Validación de voz y reglas de marca.
- Advertencias concretas y cómo resolverlas.
- Procedencia: asset de entrada, versión de Brand Kit y referencias.
- Comentarios o motivo de cambios.
- Destinos compatibles y estado de conexión.

#### Acciones

Una acción primaria por estado. El sistema no debe mostrar a la vez cinco botones equivalentes.

```text
generando       -> Ver progreso
listo           -> Revisar resultado
cambios         -> Editar o regenerar
aprobado        -> Programar o publicar
programado      -> Ver en calendario
publicado       -> Ver publicación
fallido         -> Reintentar o ver causa
```

## 4. Cómo mostrar cada app actual

### Food to Reel

Entrada en dos pasos: elegir imagen y escribir contexto. El resultado debe aterrizar directamente en el Content Run, no quedarse en el estado del job.

Mostrar:

- vídeo y portada;
- guion editable;
- formato de salida;
- imagen de origen;
- validación de copy;
- estado de render;
- acción siguiente: revisar, grabar versión propia, programar o publicar.

### Imagen y guion a Reel

Usar exactamente el mismo workspace que Food to Reel. Cambia la recipe y el texto de ayuda, no la estructura visual.

### Menú del día

Usar el mismo flujo con un selector de salida `Reel` o `Story` y un bloque opcional de audio. El resultado debe enseñar la diferencia de formato en la preview, no en una segunda aplicación.

### Producto a publicación social

La primera vista del resultado debe ser una comparación:

```text
Original              Variante para el canal
imagen subida         imagen adaptada + copy
```

Después, mostrar formatos derivados, copy por canal, validación de marca y botón `Enviar a revisión`. El Publisher se abre desde el rail de revisión con el asset ya seleccionado.

### Publisher

Convertirlo en una etapa común del Content Run. Puede conservar una ruta directa para casos avanzados, pero su lenguaje debe ser `Destino`, `Canal`, `Vista previa` y `Revisión`, no `bundle` o `adapter` en primer plano.

### Contenido y campañas

Usar `Contenido` como bandeja principal:

- Pendiente de revisión como vista inicial.
- Campañas como agrupación de trabajo.
- Biblioteca como vista secundaria de assets.
- Preview como detalle profundo del Content Run.

La tarjeta de campaña debe mostrar progreso real, canales, próxima fecha y bloqueos. La tarjeta de item debe mostrar una miniatura, estado, próxima acción y canales, no una lista de estados técnicos.

### Calendario

Mantener lista y mes, pero hacer que cada entrada abra el mismo detalle lateral del Content Run. Añadir filtros por campaña, canal, estado y responsable. El calendario debe responder a "qué sale y qué está bloqueado", no solo a "qué fecha tiene".

### Administración

Mantener una shell de administración, pero dividirla en dos ámbitos:

- `Espacio`: equipo, roles, plan, uso y políticas.
- `Marca`: identidad, reglas, canales, conexiones y assets de referencia.

Las rutas profundas de una marca deben reutilizar esa shell y no crear una segunda navegación de administración.

## 5. Nuevas apps que sí tienen sentido

Se proponen por valor de usuario, no por cada primitive técnica.

### 1. Idea a campaña

Recibe objetivo, audiencia y temas. Devuelve una campaña con items, canales, calendario sugerido y criterios de revisión. Es la evolución natural del modal `Nueva campaña`.

### 2. Reutilizar contenido

Recibe un artículo, vídeo o publicación existente y crea nuevas variantes para canales concretos. Reduce la necesidad de volver a entrar por una recipe especializada.

### 3. Fábrica visual por lote

Permite generar varias variantes desde una lista de productos, menús o assets, con una cola y revisión por lote. La revisión individual sigue disponible.

### 4. Control de marca

Una vista de QA que agrupe copy, legibilidad, dimensiones, alt text, claims y procedencia. No genera contenido: explica por qué una pieza está lista o bloqueada.

### 5. Aprendizaje de contenido

Relaciona publicaciones realizadas con rendimiento y propone qué repetir, variar o retirar. Debe llegar después de estabilizar la revisión y el calendario.

No propondría ahora una app independiente de assets, audio, motion o proveedores. Son capacidades reutilizables dentro de estas experiencias.

## 6. Patrones externos que conviene tomar prestados

- [Buffer Calendar](https://buffer.com/features/social-media-calendar): una vista global de canales, filtros por canal/tipo/etiqueta, escala semana/mes y creación desde un hueco del calendario.
- [Adobe Express Content Scheduler](https://helpx.adobe.com/express/web/publish-and-share/schedule-manage-posts/content-scheduler-overview.html): ciclo continuo de planificar, previsualizar, programar y publicar, con preview de grid para Instagram.
- [Canva Content Planner](https://www.canva.com/help/content-planner/): integración entre creación y planificación, control de cuentas visibles para el equipo y restricciones explícitas por plataforma.
- [Later Visual Planner](https://later.com/social-media-content-calendar/): planificación visual y preview del feed antes de publicar.
- [Planable approvals](https://help.planable.io/en/articles/21715469772188-approve-a-post): aprobación explícita, comentarios y posibilidad de automatizar el paso de aprobado a programado.
- [Hootsuite approvals](https://www.hootsuite.com/whats-new/document-external-approvals): historial de aprobación, notas de contexto y registro incluso cuando la aprobación ocurrió fuera de la herramienta.
- [Jasper Content Pipelines](https://www.jasper.ai/platform): ciclo de planificar, crear, activar y optimizar con una capa transversal de contexto de marca.

La lección común no es copiar la estética. Es unir creación, revisión, calendario y publicación alrededor del mismo objeto de contenido.

## 7. Principios de diseño para la siguiente iteración

1. La unidad principal es el contenido en revisión, no la capability.
2. Las apps son entradas especializadas a un mismo workspace de resultado.
3. Cada pantalla debe responder qué se generó, qué falta y quién puede actuar.
4. La arquitectura técnica aparece bajo demanda, dentro de procedencia y diagnóstico.
5. La preview debe respetar el canal final: blog, feed, story, reel o LinkedIn.
6. Aprobar, pedir cambios, programar y publicar son estados visibles, no botones escondidos.
7. El original y los derivados deben estar relacionados visualmente.
8. Una marca activa debe ser contexto persistente, no otro destino de menú.
9. La interfaz móvil necesita una acción primaria fija y un rail que se convierta en panel inferior.
10. Las métricas de producto deben medir claridad y avance, no solo clics.

## 8. Proceso creativo y de validación

### Fase 0: vocabulario

Decidir con el equipo si los nombres de producto serán `Crear`, `Contenido`, `Revisión`, `Calendario` y `Administración`. No tocar todavía la implementación.

### Fase 1: mapa de journeys

Dibujar tres recorridos de principio a fin:

1. Menú o producto a pieza social publicada.
2. Idea a campaña multicanal.
3. Contenido existente a variantes y calendario.

### Fase 2: prototipo de baja fidelidad

Prototipar solo cuatro pantallas: shell, Crear, bandeja de revisión y Content Run. Si esas cuatro funcionan, las recipes concretas pueden entrar como configuraciones.

### Fase 3: consolidación técnica

Extraer componentes compartidos para `RunHeader`, `ArtifactPreview`, `ReviewRail`, `ChannelPreview`, `ProvenanceSummary` y `NextAction`. Adaptar Food to Reel y Product to Social primero. Publisher pasa a ser una etapa dentro del resultado.

### Fase 4: administración

Separar navegación de espacio y marca. Migrar primero la superficie visible y conservar las rutas antiguas como alias.

### Fase 5: validación con usuarios

Probar cinco tareas con una persona que no haya visto el código:

- encontrar lo generado hace cinco minutos;
- saber si una pieza está lista para publicar;
- comparar original y variante;
- cambiar el canal de una pieza;
- invitar a otra persona sin entrar en una configuración equivocada.

## 9. Métricas que decidirán si mejora

- Tiempo desde que termina una generación hasta que la persona abre el resultado.
- Porcentaje de ejecuciones que terminan en una acción de revisión.
- Tiempo desde `listo para revisar` hasta `aprobado`.
- Número de retrocesos entre Crear, Contenido, Publisher y Calendario.
- Porcentaje de publicaciones fallidas por configuración de canal.
- Porcentaje de resultados abandonados sin una acción siguiente.
- Tiempo necesario para encontrar una conexión o una regla de marca.

## Decisión recomendada

La primera iteración no debería añadir más apps. Debería hacer tres cambios coordinados:

1. Reemplazar el menú de recipes por una entrada `Crear` orientada a intención.
2. Convertir Contenido en la bandeja de revisión central.
3. Hacer que Food to Reel, Product to Social y Publisher terminen en un mismo Content Run.

Eso permite probar la dirección con el mínimo cambio de dominio y sin romper los contratos MCP ni las rutas históricas.
