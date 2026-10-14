# Escarlet V3: handoff para agentes

## Regla principal

No reintroducir rutas, tablas, herramientas MCP ni componentes legacy. El Post y sus variantes son la única unidad editorial.

## Comandos

```text
npm test
npm run ui:check
npm run build
```

Para el modo canónico local se necesita Postgres mediante `docker compose up -d --build` y `DATABASE_URL`.

Variables habituales: `DATABASE_URL` para Postgres, `CMS_PUBLIC_URL` para publicar el MCP, y los secretos cifrados de los destinos Buffer, Coolify o WordPress. La PWA no necesita una API key de IA: las generaciones se preparan con MCP y se ejecutan en el agente externo.

## Fuentes de verdad

- Modelo: `docs/ESCARLET-V3-OPERATING-MODEL.md`.
- Contrato: `docs/MCP-V3-CONTRACT.md`.
- Migración: `docs/MIGRATION-LEGACY-TO-V3.md`.
- UX: `docs/PWA-UX-V3.md`.
- API de PWA: `/api/v2`.
- MCP externo: `/mcp/v3`.

## Restricciones

- IA exclusivamente externa mediante MCP.
- Publicación exclusivamente mediante `publication_runs`.
- UI nueva con componentes de `apps/pwa/src/ui` y tokens `--ui-*`.
- No usar `/api/admin/posts`, Social Pack, Preview legacy, editor manual ni aliases MCP.

## Rutas canónicas de la PWA

- `/app/content` y `/app/content/:postId` para Inbox y espacio de Post.
- `/app/campaigns/:campaignId` para un release opcional.
- `/app/calendar` para estados programados.
- `/app/publication` para el control plane de publicación.
- `/app/brand`, `/app/admin/team`, `/app/admin/connections` y `/app/admin/billing` para administración.

Las rutas antiguas no redirigen: devuelven `410` o una pantalla explícita de flujo retirado.

## Operación MCP V3

El agente debe pedir `brand.context.get`, crear o actualizar un Post, subir o asociar media, validar copy, solicitar revisión y usar `publication.destination.*` más `publication.*` para publicar. No se permite generar copy, imágenes o vídeo en el servidor. Buffer, Coolify y WordPress son adaptadores detrás de `PublicationRun`.

## Migración y aceptación

Ejecuta una sola vez `npm run db:migrate:v3`. Revisa el informe generado y confirma que no quedan assets publicables huérfanos. La aceptación mínima cubre crear un Post con Blog e Instagram, editar una variante, aprobar, programar, publicar por Coolify y Buffer, consultar desde `/app/content` y comprobar que un asset sin Post crea un borrador en Inbox editorial.

## Estado de corte

Las rutas `/mcp`, `/api/admin/*`, `/api/ai/*` y los antiguos recorridos de Posts, Preview, Social Pack y editor manual devuelven `410`. No se deben reactivar como alias ni añadir nuevas escrituras contra sus servicios. El código histórico que todavía aparece en módulos no alcanzables queda únicamente para soporte de la migración y no forma parte del runtime público.
