# Auth0 + ChatGPT Apps / MCP

Integración opcional de un resource server Auth0 para MCP v3. No se activa por defecto y no inventa valores de tenant, client ID o secretos.

## Objetivo

1. **Brand Consult**: ChatGPT (u otro cliente MCP) lee voz, reglas y estilo visual con el token del usuario y la marca.
2. **Publish Workflow**: widget Apps SDK con preview de la pieza final, aprobación y agenda; la PWA sigue siendo fuente de verdad operativa.

## Auth0

| Pieza | Configuración |
|-------|-----------------|
| API audience | `AUTH0_AUDIENCE`, normalmente `https://cms.escarlet.design/mcp/v3` |
| Issuer | `AUTH0_ISSUER`, la URL HTTPS del tenant Auth0 |
| JWKS | `AUTH0_JWKS_URL`, o `AUTH0_ISSUER/.well-known/jwks.json` |
| Grant | Authorization Code + PKCE (OAuth 2.1) |
| App type | Regular Web / Native según Apps SDK |
| DCR / CIMD | Según requisitos del conector ChatGPT Developer Mode |
| Scopes | `brand:read`, `asset:read`, `asset:write`, `copy:validate`, `generation:prepare`, `generation:provenance`, `generation:run`, `production:motion`, `publication:read`, `publication:write`, `publication:publish` |

Claims requeridos y opcionales en el access token:

- `iss`, `aud`, `exp` y `sub` son obligatorios y se verifican contra la configuración desplegada.
- `https://escarlet.design/user_id` debe identificar al usuario local (`users.id`). Si se omite, se usa `sub`, por lo que el `sub` debe ser ese identificador local.
- `https://escarlet.design/workspace_id` identifica un único workspace. `workspace_ids` solo se acepta cuando contiene un único valor.
- `https://escarlet.design/site_ids` y `https://escarlet.design/sites` restringen las marcas. Pueden contener IDs de site o handles. La membresía PostgreSQL sigue siendo la fuente de verdad.
- `permissions` o `scope` se filtran al catálogo MCP v3. El rol y las marcas efectivas se obtienen de la membresía del workspace, no del rol recibido del token.

El namespace y los nombres anteriores se pueden cambiar con `AUTH0_CLAIM_NAMESPACE` y las variables `AUTH0_*_CLAIM`. La configuración parcial es inválida.

## MCP

1. Configurar todas las variables `AUTH0_*` en el despliegue. No copies valores de ejemplo.
2. Publicar `/.well-known/oauth-protected-resource`. Cuando Auth0 está activo, anuncia el issuer Auth0 y `AUTH0_AUDIENCE`.
3. En cada tool call, verificar firma RS256 contra JWKS, issuer, audience, expiración, `nbf`/`iat` y scopes.
4. Resolver usuario, workspace y marcas contra PostgreSQL. Si falta la identidad local, la membresía o el claim de workspace, se rechaza el bearer.
5. Mantener PAT y OAuth propio solo cuando Auth0 no esté configurado. Un JWT Auth0 inválido no cae en una autenticación de menor garantía.

El código de verificación vive en `lib/oauth-mcp.mjs` y `lib/auth.mjs`. Solo se aceptan claves RSA de firma y HTTPS para issuer y JWKS. El caché de JWKS dura diez minutos y se refresca una vez cuando cambia el `kid`.

## ChatGPT Apps SDK

1. Connector MCP con OAuth (login una vez).
2. Widget embebido: muestra `previewUrl` y acciones de aprobación y agenda sobre el run.
3. Consulta de marca usa `brand.context.get` y `brand.visual_style.get`; no obliga a publicar.

## Puesta en marcha

1. Crea el API y la aplicación Auth0 en el tenant de despliegue. Define los scopes anteriores y una Action que emita `user_id`, `workspace_id` y, si procede, `site_ids`.
2. Comprueba que cada `user_id` existe en `users.id` y que sus membresías están en `workspace_members` y `workspace_member_sites`.
3. Configura `.env` a partir de `.env.example` y reinicia el CMS. No pongas secretos Auth0 en el repositorio.
4. Verifica metadata y health antes de conectar ChatGPT:

```bash
curl -s https://cms.escarlet.design/.well-known/oauth-protected-resource | jq
curl -s https://cms.escarlet.design/api/health | jq '.mcp,.mcpContract'
```

5. Conecta ChatGPT usando `/mcp/v3` y OAuth. Revisa primero `capability.search`, después `brand.context.get` y, por último, una capability de escritura en staging.
6. Usa `publication.route` y `publication.schedule` solo después de la revisión humana exigida por la marca.

Hasta completar estos pasos, la ruta soportada para ChatGPT sigue siendo el OAuth propio del CMS o un PAT personal, según el entorno. Auth0 no se puede probar de forma real sin un issuer, audience, JWKS y claims emitidos por el tenant.

## Fuera de esta fase

- Autopublicar sin confirmación humana.
- Sustituir la PWA como panel operativo.
