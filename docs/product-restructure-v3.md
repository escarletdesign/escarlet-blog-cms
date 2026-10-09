# Escarlet v3: MCP central y micro apps de producción

## Decisión resumida

La idea es válida si `micro app` significa una capacidad de producción con contrato, estado y resultado propios. No conviene convertir cada canal, proveedor o formato en un microservicio independiente.

La arquitectura objetivo para v3 es:

```text
Agente / MCP
    |
    v
Control plane del CMS
  auth, workspace, marca, Brand Kit, assets, jobs,
  revisión, aprobación, agenda y publicación
    |
    v
Registro de capabilities y recetas
    |
    +--> image.brand.generate
    +--> image.product.transform
    +--> motion.compose
    +--> audio.transcribe o audio.voice
    +--> adaptadores de publicación
```

El MCP coordina el trabajo. Las micro apps producen artefactos. El CMS conserva la fuente de verdad, la procedencia y la revisión humana. La publicación ocurre después de la aprobación y fuera de los motores creativos.

## Estado implementado en la rama v3

La primera vertical ya está integrada en el monolito modular:

- `lib/os/` registra manifests versionados, permisos, recetas y búsqueda de primitives.
- `mcp/v3/` expone `/mcp/v3`, recursos del índice, Brand Kernel y tools namespaced.
- `mcp/v3/handlers.mjs` conecta lectura de marca, preparación visual, receipts, jobs de vídeo y Publisher sin ejecutar IA ni proveedores externos.
- `lib/publication/` separa canales de proveedores y aplica compatibilidad, permisos, aprobación e idempotencia.
- La PWA incluye la micro app `production/food-to-reel`: consulta assets canónicos, acepta una imagen y texto, y envía la receta por la misma frontera MCP v3.
- `/api/v2/assets` y `/api/v2/assets/upload` mantienen los inputs de producción en `media_assets`; `/api/v3/recipes/run` no crea una ruta creativa paralela.
- `/mcp` responde `410 mcp_v3_required`; el health check, OAuth, favicon y onboarding apuntan a `/mcp/v3`.
- `production.motion.compose` ya crea un `video_job` idempotente en estado `queued`; el proveedor `local` usa FFmpeg para producir un MP4 vertical con copy, fundidos y asset fuente, mientras los proveedores externos siguen en handoff explícito.
- `production.image.product.transform` conserva el original y puede crear una composición local determinista con procedencia y receipt; si se necesita una edición generativa, deja el envelope en `awaiting_provider` hasta conectar un ejecutor autorizado.
- `recipe.run` ejecuta `food-to-reel` y `menu-to-reel` con texto y audio opcional hasta la cola, validación de copy, destinos y revisión humana. No publica automáticamente.
- `recipe.run` también ejecuta `product-to-social`: transforma el asset original, conserva procedencia y devuelve destinos compatibles sin publicar.
- La PWA incluye `/publication/publisher`: muestra solo combinaciones de canal y proveedor conectadas, prepara un bundle revisable y no envía credenciales ni contenido a un proveedor antes de la aprobación.
- La PWA incluye `/apps`, un dashboard alimentado por `GET /api/v3/catalog`; cada tarjeta usa el mismo manifest que MCP y solo ofrece una acción directa cuando existe una UI autorizada. El Publisher se puede abrir como distribución general o como `Publicar blog` con WordPress preseleccionado.
- `capability.guide` explica el protocolo a un agente nuevo y está cubierto por una simulación que descubre, inspecciona y valida errores antes de ejecutar. El menú del día reutiliza la recipe con perfiles `instagram_reel` e `instagram_story`.

## Qué existe hoy

El repositorio no parte de cero:

- `mcp/create-mcp-server.mjs` ya es el gateway de autenticación, selección de marca, tools, compatibilidad y parte de la orquestación.
- `lib/workspace-domain.mjs` concentra workspace, marcas, Brand Kits, campañas, variantes, assets, aprobaciones, agenda, uso y conexiones.
- `lib/generation-provenance.mjs` y las migraciones de procedencia fijan versión del Brand Kit, referencias, hashes y receipts.
- `lib/video-jobs.mjs` y `migrations/013_video_jobs.sql` ya modelan un ciclo asíncrono de vídeo con estados, media fuente, resultado y portada.
- `jobs` y `outbox_events` ya proporcionan cola persistente, idempotencia, reintentos y entrega de eventos.
- `content-system/` contiene schemas y renderizado determinista para piezas visuales.
- `worker.mjs` ejecuta publicación de Blog, Buffer, Postiz, Planable y Metricool.

El problema principal es de frontera. El MCP, `video_jobs` y el worker todavía mezclan coordinación con ejecución, y algunos jobs de vídeo escriben directamente en el dominio editorial. La v3 debe separar esas responsabilidades sin crear otra fuente de verdad.

## Límites de responsabilidad

### MCP y control plane

Debe conservar:

- autenticación, tenancy y permisos;
- resolución de workspace, marca y Brand Kit versionado;
- validación de argumentos y límites de seguridad;
- catálogo de capabilities y recetas permitidas;
- creación, consulta, cancelación y reintento de jobs;
- registro de assets y procedencia;
- revisión humana, aprobación, agenda y publicación;
- auditoría, uso, cuotas y outbox;
- contrato MCP v3 namespaced y rechazo explícito de nombres legacy.

No debe renderizar vídeo, editar píxeles ni conocer las credenciales de Buffer, Postiz, Planable o Metricool.

### Micro apps ejecutoras

#### `image.brand.generate`

Genera una imagen para blog, post, story o LinkedIn a partir de un brief, una especificación de formato y un snapshot inmutable del Brand Kit. El canal es un parámetro de salida, no una aplicación diferente.

Debe reutilizar `brand_prepare_image_generation`, la política vigente de generación externa y los receipts existentes. No debe elegir referencias arbitrarias ni mutar el Brand Kit.

#### `image.product.transform`

Recibe un `sourceAssetId` y genera una o varias variantes con el estilo de la marca. Conserva el original, registra la transformación y exige una regla explícita para preservar el producto.

No debe aceptar URLs remotas sin pasar por el gateway de media. No publica ni actualiza campañas por su cuenta.

#### `motion.compose`

Compone reels, stories animadas y otros vídeos cortos a partir de assets, texto, audio, guion y un perfil de formato. Reel y Story son perfiles de salida del mismo motor, no dos servicios.

Devuelve vídeo, portada y manifest de composición. No aprueba, agenda ni publica.

#### Audio y recetas de menú

Transcripción, voz y audio pueden ser nodos de una receta. “Menú del día” debe ser una receta compuesta, no una micro app de primer nivel:

```text
imagen y texto
  -> adaptación de producto opcional
  -> audio o transcripción opcional
  -> motion.compose
  -> revisión
  -> publicación
```

#### Adaptadores de publicación

WordPress, Buffer, Postiz, Planable y Metricool siguen siendo distribución. Reciben un bundle aprobado y devuelven un estado externo. No pertenecen al renderer de imagen o vídeo.

## Contrato común de una micro app

La primera versión debe ser pequeña y estable. No hace falta crear todavía un lenguaje general de workflows.

```json
{
  "contractVersion": "production.v1",
  "runId": "run_123",
  "idempotencyKey": "workspace:site:capability:request",
  "correlationId": "trace_123",
  "workspaceId": "workspace_123",
  "siteId": "site_123",
  "capability": "motion.compose",
  "brandKitVersionId": "brand_version_4",
  "inputs": [
    { "assetId": "media_1", "role": "product", "sha256": "..." }
  ],
  "spec": {
    "formatProfile": "instagram_reel_9_16",
    "width": 1080,
    "height": 1920,
    "durationMaxMs": 30000
  },
  "params": {}
}
```

Toda respuesta debe incluir:

- `runId`, estado y progreso;
- `assetId` de cada resultado, nunca blobs entre apps;
- MIME, dimensiones, duración y hashes;
- versión de la capability, renderer y receta;
- `brandKitVersionId` y hashes de inputs;
- coste o consumo si aplica;
- error estable con `code`, `retryable` y mensaje accionable.

### Descubrimiento progresivo

El agente no necesita cargar todos los schemas ni conocer todas las recetas desde el primer mensaje. MCP v3 expone tres pasos pequeños:

1. `capability.search` devuelve un resumen filtrable por propósito, tipo y etiqueta, con las claves de entrada y salida.
2. `capability.get` devuelve el manifest completo de una capability autorizada, incluidos schemas, permisos, efectos y política de revisión.
3. `recipe.list` y `recipe.get` permiten descubrir composiciones reutilizables sin ejecutar ningún paso.

Los resultados se expresan como referencias de artefacto (`assetId`, `role`, `kind`, `sha256`) y nunca como blobs. Así una micro app puede consumir la salida de otra sin acoplarse al almacenamiento, y el control plane conserva procedencia, estado e idempotencia.
Las recipes se publican con IDs canónicos `recipe.*`; las consultas antiguas sin ese prefijo se aceptan como alias de compatibilidad, pero no se duplican en el catálogo.

Estados mínimos:

```text
queued -> running -> ready_for_review -> approved -> scheduled -> published
                 \-> failed
```

La idempotencia debe cubrir workspace, marca, capability y operación. Si la misma clave llega con otro payload, se responde `409`. Los artefactos se deduplican por hash y los resultados parciales se conservan durante una ventana de limpieza.

## Plan de migración

### Fase 0. Inventario y vocabulario

**Objetivo:** fijar el modelo sin romper el contrato público.

Acciones:

1. Mapear cada tool MCP, ruta REST, job, tabla y proveedor a un dueño futuro.
2. Documentar `Brand`, `Campaign`, `Editorial item`, `Asset`, `Production job`, `Workflow`, `Recipe` y `Destination`.
3. Definir schemas de request, response, error, asset reference y manifest.
4. Medir latencia, edad de cola, reintentos, fallos, coste y artefactos huérfanos.
5. Mantener `CMS_AI_DISABLED`: la generación generativa continúa en el agente/MCP hasta que exista una decisión explícita para reabrirla.

**Salida:** todos los flujos tienen dueño, entradas, salidas, rollback y métrica base.

### Fase 1. Modular monolith

**Objetivo:** introducir la frontera sin desplegar servicios nuevos.

Acciones:

1. Añadir un registro interno de capabilities y adaptadores.
2. Reutilizar `jobs`, `outbox_events`, `media_assets` y `video_jobs`.
3. Añadir al job solo los metadatos que falten: capability, versión de contrato, `runId`, `correlationId` y `providerRequestId`.
4. Mantener las tools MCP actuales como fachadas compatibles.
5. Separar el resultado de una micro app del cambio editorial mediante un comando o evento explícito.

**Salida:** el cliente no percibe cambios, una repetición idempotente no duplica resultados y un worker perdido recupera el job.

### Fase 2. Primera extracción técnica: vídeo

**Objetivo:** demostrar el contrato con la frontera que ya tiene modelo propio.

1. Mantener `video_jobs` y `video_*` como API compatible.
2. Extraer el ejecutor de renderizado a un worker separado, inicialmente con el adaptador local FFmpeg y el flujo manual existente.
3. Emitir `video.render.requested`, `video.render.completed` y `video.render.failed` en la auditoría del job.
4. Hacer que el worker registre vídeo y portada como `media_assets`.
5. Dejar en el control plane la asociación al `content_item`, la revisión, la agenda y la publicación.
6. Activar por workspace o marca y conservar fallback al procesador anterior.

**Salida:** no hay duplicados, los errores de validación no se reintentan, los fallos transitorios sí y el resultado no puede publicarse sin aprobación.

### Fase 3. Imagen y edición de producto

**Objetivo:** reutilizar el gobierno actual de Brand Kit y procedencia.

1. Convertir `brand_prepare_image_generation` en la preparación de entrada de `image.brand.generate`.
2. Crear `image.product.transform` como operación separada sobre assets.
3. Validar pertenencia a workspace y marca, MIME real, dimensiones, hash y versión del Brand Kit.
4. Registrar cada resultado como un nuevo asset con procedencia del original.
5. Usar perfiles de formato para blog, post, story y LinkedIn, evitando duplicar motores por canal.

**Salida:** el original permanece intacto, cada resultado es trazable y el mismo input puede reutilizarse en más de una receta.

### Fase 4. Recetas compuestas

**Objetivo:** concatenar capabilities sin permitir pipelines arbitrarios.

1. Implementar recetas predefinidas y parametrizadas.
2. Guardar dependencias, inputs, outputs y versión de cada nodo.
3. Permitir reintentar solo el nodo fallido.
4. Crear la receta `menu-to-reel` como segundo caso de composición.
5. Mantener revisión humana antes de cualquier publicación. `food-to-reel` ya funciona con el renderer local; `menu-to-reel` conserva además el asset de audio como input opcional.

**Salida:** una receta puede reanudarse desde el último artefacto válido y su estado completo se consulta desde el control plane.

### Fase 5. Separación física selectiva

Extraer a contenedores o procesos independientes solo una capability que cumpla al menos dos de estas condiciones:

- escala distinta;
- dependencia pesada o incompatible;
- aislamiento de seguridad;
- ciclo de despliegue propio;
- fallos que deban aislarse;
- necesidad de hardware o límites de CPU/memoria diferentes.

El almacenamiento y Postgres siguen siendo centrales hasta que exista una migración de media con copia, verificación SHA-256, fallback y rollback probado.

## Primer alcance recomendado

Para no convertir v3 en una reescritura, el primer alcance es:

1. Rama `v3` y contrato `production.v1` documentado.
2. Registro interno de capabilities sobre la cola existente.
3. Extracción del renderer de vídeo como worker, con una composición vertical determinista y fundidos, sin construir aún animación libre.
4. Una receta de imagen o producto a Feed/Story para validar el flujo de artefactos y revisión.
5. `menu-to-reel` después de demostrar idempotencia, trazabilidad y revisión.

No entran en el primer corte: base de datos por micro app, marketplace de plugins, broker nuevo, servicio por canal, publicación autónoma, reactivación de la IA server-side antigua o reescritura de `App.tsx`.

## Métricas de salida

La métrica principal no es el número de micro apps. Es el porcentaje de trabajos que llegan desde un input hasta un artefacto aprobado y publicado con una receta.

Medir por capability y receta:

- tiempo hasta el primer artefacto;
- p50 y p95 por etapa;
- jobs completados, fallidos, reintentados y en dead letter;
- coste por artefacto aprobado;
- cache hit y duplicados evitados;
- porcentaje de aprobación sin regeneración;
- errores de formato y de Brand Kit;
- edad máxima de la cola;
- porcentaje de jobs sin estado final;
- tiempo de publicación y errores por proveedor.

## Riesgos que deben quedar explícitos

- Separar servicios antes de estabilizar contratos produciría un monolito distribuido.
- Una base de datos por app rompería la trazabilidad y complicaría permisos sin aportar valor inicial.
- Cada app podría interpretar el Brand Kit de forma distinta si no recibe un snapshot versionado.
- Un reintento sin idempotencia puede duplicar assets o publicaciones externas.
- Pasar blobs o URLs privadas entre apps amplía el riesgo de exposición y SSRF.
- Mezclar generación con publicación hace difícil revisar, reintentar y revocar.
- Un workflow genérico prematuro añade infraestructura antes de validar una receta real.
- La política actual mantiene la IA server-side desactivada. Cualquier cambio debe ser una decisión separada, con coste, seguridad y permisos propios.

## Publisher y distribución

La publicación será una capability separada de la generación. El sistema distinguirá siempre entre:

- **Canal:** Instagram Reel, Instagram Story, LinkedIn, WordPress u otro destino.
- **Proveedor:** Buffer, Metricool, Postiz, Planable, WordPress/Coolify u otro adaptador.
- **Operación:** validar, enrutar, programar, publicar y consultar estado.

Capabilities previstas:

```text
publication.destination.list
publication.validate
publication.route
publication.schedule
publication.publish
publication.status.get
```

Cuando el identificador no corresponde a un run persistido, la respuesta usa
`status: "unknown"` y `terminal: false`. Significa que el control plane no ha
confirmado el estado; no equivale a publicado, fallido ni cancelado.

El agente podrá pedir una recomendación o elegir explícitamente. La UI mostrará únicamente las combinaciones habilitadas para la marca y compatibles con el asset. Ninguna capability creativa recibirá credenciales de proveedores ni publicará por su cuenta.

La aprobación humana seguirá siendo obligatoria antes de `publication.schedule` o `publication.publish`, salvo una política explícita de la marca que se implemente más adelante.

## UI, Auth0 y agentes externos

ChatGPT y la UI serán dos puertas de entrada al mismo control plane. La UI no llamará directamente al proveedor de IA.

```text
Usuario -> Auth0 -> UI de Escarlet OS -> run autorizado
                                      -> agente externo vía MCP v3
                                      -> Brand Kernel y micro apps
                                      -> revisión y Publisher
```

Auth0 autentica al usuario frente a Escarlet OS. El control plane resuelve workspace, marca, rol, Brand Kit y capabilities permitidas, y crea un `runId` limitado. El agente recibe referencias de assets y URLs temporales, nunca credenciales ni acceso general al almacenamiento.

En esta rama el punto de integración existente sigue siendo el OAuth/PAT propio del CMS. Hay un verificador Auth0 opt-in para JWT RS256 en `lib/oauth-mcp.mjs`: requiere issuer, audience, JWKS por HTTPS y claims de identidad. La resolución final cruza `user_id`, workspace y marcas con las membresías PostgreSQL. La sustitución por Auth0 requiere configurar esos valores y el callback en el entorno de despliegue; no se inventan credenciales ni se activa un proveedor externo por defecto.

La primera receta de ejemplo será `food-to-reel`:

```text
imagen de plato + texto
  -> copy.validate
  -> motion.compose
  -> revisión humana
  -> publication.destination.list
  -> publication.route
  -> publication.schedule o publication.publish
```

El mismo flujo puede iniciarse desde una conversación MCP o desde las UIs de `food-to-reel` y Publisher. Ambas reutilizan manifests y el mismo endpoint MCP v3; las superficies especializadas pueden crecer sin mover el control plane.

## Política fijada para v3

La generación de copy, imagen, audio o vídeo generativo seguirá en ChatGPT u otro agente externo autorizado. Escarlet OS proporciona Brand Kernel, preparación visual, validación, transformación, composición determinista local cuando procede, almacenamiento, revisión y publicación.

El MCP v3 se publicará en `/mcp/v3` con namespaced tools. No conservará aliases de las tools anteriores. `/mcp` dejará de ser el endpoint canónico y todos los clientes deberán actualizar su configuración antes del corte.
