# Auth0 + ChatGPT Apps / MCP (diseño)

Fase P3 del plan agentes: OAuth de usuario para el MCP, sin PAT compartido. No bloquea P0/P1.

## Objetivo

1. **Brand Consult** — ChatGPT (u otro cliente MCP) lee voz, reglas y style board con el token del usuario/marca.
2. **Publish Workflow** — widget Apps SDK con preview composed + Approve + Schedule; la PWA sigue siendo fuente de verdad operativa.

## Auth0

| Pieza | Valor propuesto |
|-------|-----------------|
| API audience | `https://cms.escarlet.design/mcp` |
| Grant | Authorization Code + PKCE (OAuth 2.1) |
| App type | Regular Web / Native según Apps SDK |
| DCR / CIMD | Según requisitos del conector ChatGPT Developer Mode |
| Scopes | `brand:read`, `content:read`, `content:write`, `content:publish` (mapear a rol workspace) |

Claims útiles en el access token: `sub` (usuario Auth0), `https://escarlet.design/workspace_id`, `https://escarlet.design/site_ids`, scopes efectivos.

## MCP

1. Publicar `/.well-known/oauth-protected-resource` apuntando al issuer Auth0 y al audience del MCP.
2. En cada tool call: verificar JWT (issuer, audience, expiración, scopes).
3. Resolver workspace/marca desde claims; rechazar si el scope no cubre la tool (consult = read; upload/approve = write/publish).
4. Mantener PAT internos solo para automatización server-to-server; ChatGPT usa OAuth.

## ChatGPT Apps SDK

1. Connector MCP con OAuth (login una vez).
2. Widget embebido: muestra `composedPreviewUrl` + botones Approve / Schedule que llaman `content_approve` / `content_schedule`.
3. Consulta de marca sigue siendo tools de lectura (`brand_get_context`, `brand_get_style_board`); no obliga a publicar.

## Orden de implementación

1. Auth0 API + app + scopes.
2. Verificación JWT en el handler MCP + resource metadata.
3. Connector ChatGPT en staging.
4. Widget review/publish.
5. Retirar dependencia de PAT en documentación de agentes externos.

## Fuera de esta fase

- Autopublicar sin confirmación humana.
- Sustituir la PWA como panel operativo.
