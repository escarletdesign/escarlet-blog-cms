# Sitemap de Escarlet V3

La PWA trabaja alrededor de un único objeto editorial: el Post y sus variantes por canal.

```text
/app
├── /                         Inicio
├── /apps                     Crear un Post borrador
├── /content                  Inbox editorial y búsqueda
├── /content/:postId          Espacio de Post, variantes, revisión y agenda
├── /campaigns/:campaignId    Release editorial opcional
├── /calendar                 Estado real de variantes programadas
├── /publication              Destinos y control de publicación
├── /brand                    Marcas y Brand Kit
├── /admin/team               Equipo y permisos
├── /admin/connections        Canales, destinos y proveedores técnicos
├── /admin/billing            Plan y uso
├── /settings                 Perfil y preferencias
└── /design-system            Catálogo interno de componentes
```

## Corte de rutas

`/plans`, `/posts`, `/preview`, `/social-pack`, `/manual`, `/schedule`, `/publish`, `/quick-create` y `/admin` ya no son pantallas funcionales. El servidor responde `410` a las rutas públicas y la PWA muestra una pantalla de flujo retirado cuando la navegación ocurre dentro de `/app`.

`/api/v2` es la API REST interna de la PWA. `/mcp/v3` es el único contrato externo para agentes. `/mcp`, `/api/admin/*`, `/api/ai/*` y `/api/v3/*` no son aliases: responden `410`.

## Regla de decisión

Usar el espacio de Post cuando cambia una variante, un asset, una revisión o un destino. Usar un release solo para coordinar varios Posts. No crear pantallas separadas para Blog, Social Pack, Preview o proveedores.
