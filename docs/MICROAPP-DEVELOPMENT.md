# Añadir una micro app a Escarlet OS

Este documento es el contrato operativo para añadir una capability o una recipe sin duplicar lógica entre MCP, API y PWA.

## Modelo

- Una capability es una acción atómica con manifest, permisos, inputs, outputs y efectos.
- Una recipe es una composición autorizada de capabilities. Su ID público usa el prefijo `recipe.`.
- Un artefacto se referencia por `assetId`; `role`, `kind` y `sha256` se incluyen cuando están disponibles. Las apps no intercambian blobs.
- La UI es una superficie de una capability. El MCP y la API siguen siendo la fuente de verdad.

## Dónde tocar

1. Añade el manifest en `lib/os/registry.mjs`.
2. Implementa el ejecutor en `mcp/v3/handlers.mjs` o registra un dispatcher en `getOsRegistry()`.
3. Publica el mismo contrato en `mcp/v3/catalog.mjs` si la capability necesita una entrada MCP específica.
4. Añade un test de permisos, inputs inválidos, resultado y reintento idempotente.
5. Si necesita UI, crea `apps/pwa/src/<MicroApp>.tsx` usando los componentes de `apps/pwa/src/ui/index.tsx` y los tokens de `apps/pwa/src/ui/tokens.css`.
6. Registra la ruta principal en `apps/pwa/src/App.tsx` y declara `metadata.uiRoute` en el manifest. El dashboard la mostrará automáticamente cuando el usuario tenga permiso.
7. Actualiza este documento o `docs/product-restructure-v3.md` con el flujo y los permisos.

## Flujo recomendado para un agente

```text
capability.guide
  -> capability.search o recipe.list
  -> capability.get o recipe.get
  -> brand.context.get
  -> brand.generation.prepare para cada pieza visual
  -> generar el PNG final en el host y subirlo con asset.upload
  -> ejecutar la recipe con referencias de assets
  -> revisar status y procedencia
  -> publication.destination.list
  -> publication.prepare
  -> aprobación humana
  -> publication.schedule o publication.publish
```

`capability.guide` está pensado para un agente que no conoce Escarlet. Devuelve los pasos, reglas y ejemplos que debe seguir. `capability.search` devuelve resúmenes sin schemas grandes. Se solicita el schema completo únicamente con `capability.get` o `recipe.get`.

## Superficie de la UI

Una recipe puede tener una app dedicada. Su manifest debe declarar:

```js
metadata: { uiRoute: '/production/example' }
```

Una capability que ofrece varias entradas puede declarar `metadata.uiApps` con objetos `{ id, title, description, route, tags }`. El dashboard `/apps` convierte esas entradas en tarjetas, por lo que una nueva app no necesita una lista paralela en React. El Publisher usa este mecanismo para ofrecer tanto la publicación general como `Publicar blog` con WordPress preseleccionado.

El menú del día reutiliza la misma recipe con dos perfiles de salida: `instagram_reel` e `instagram_story`. Reel y Story son formatos del motor `production.motion.compose`, no motores duplicados.

## Comprobación local

La simulación de agente está en `mcp/v3/agent-simulation.test.mjs`. Comprueba que un agente puede:

1. Descubrir la guía.
2. Buscar la recipe correcta.
3. Inspeccionar dependencias antes de ejecutar.
4. Fijar la marca y seguir la regla de referencias por `assetId`.
5. Recibir un error accionable si faltan inputs.

Las recetas y el Publisher tienen una prueba de integración aislada en
`mcp/v3/integration.test.mjs`. Usa assets y proveedores simulados, verifica
procedencia, revisión humana, permisos, idempotencia y el estado `unknown` para
una publicación que todavía no tiene un run persistido. No contacta canales
externos.

Ejecuta:

```bash
npm test
npm run ui:check
npm run build
```

La PWA consume el catálogo con `GET /api/v3/catalog?site=<handle>`. El endpoint usa la misma identidad, permisos y registro que `/mcp/v3`, por lo que una tarjeta nueva no puede mostrar una app que el usuario no puede usar.

## Despliegue

El cambio se publica en la rama `v3`. Coolify construye el mismo servicio y conserva Postgres y `/app/data`. Antes de cerrar una implementación, verifica:

- el commit está en `origin/v3`;
- health devuelve `deploymentTrack: v3`, migraciones listas y volumen escribible;
- MCP responde en `/mcp/v3` y rechaza `/mcp` con `410`;
- la tarjeta aparece en `/apps` con el mismo ID que el manifest.

No se crea un contenedor por capability hasta que una escala, dependencia, aislamiento o ciclo de despliegue distinto lo justifique.
