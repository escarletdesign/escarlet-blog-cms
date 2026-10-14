# Escarlet V3: modelo operativo

Este documento es la fuente de verdad para el producto. La aplicación tiene una única unidad editorial: `Post`.

```text
Workspace
└── Marca
    ├── Brand Kit versionado
    ├── Canales y conexiones
    └── Campaña opcional
        └── Post
            └── Variantes por canal
                └── Publicación externa
```

## Decisiones cerradas

- El único contrato MCP público es `/mcp/v3`.
- La PWA y el MCP usan el mismo dominio y la misma persistencia Postgres.
- `content_items` es la persistencia interna de `Post`.
- `content_variants` es la persistencia interna de `PostVariant`.
- `content_batches` es una agrupación editorial. La campaña es opcional en la experiencia de usuario.
- Un Post sin campaña visible pertenece a `Inbox editorial`.
- La generación de copy, imágenes y vídeo ocurre fuera del servidor mediante MCP.
- Los proveedores de publicación iniciales son Buffer, Coolify y WordPress.
- No se permiten nuevas escrituras JSON ni rutas `/api/admin/posts`.
- La exportación legacy se conserva solo como respaldo de migración, nunca como runtime.

## Entidades

| Producto | Persistencia | Responsabilidad |
| --- | --- | --- |
| Marca | `sites` | Identidad, canales y acceso |
| Brand Kit | `brand_kits`, `brand_kit_versions`, `brand_assets` | Voz, reglas, visuales y procedencia |
| Campaña | `content_batches` | Objetivo, periodo, agrupación y release |
| Post | `content_items` | Unidad editorial revisable |
| Variante | `content_variants` | Adaptación a un canal |
| Asset | `media_assets` | Media reutilizable o asociada a una variante |
| Publicación | `publication_runs` | Route, prepare, schedule, publish y estado remoto |

## Estados

La UI traduce los estados técnicos a estos estados editoriales:

`draft`, `generating`, `ready_for_review`, `changes_requested`, `approved`, `scheduled`, `publishing`, `published`, `failed`, `archived`.

La normalización vive en el dominio y no en cada pantalla.

## Roles

- `editor`: crea y edita Posts, variantes y assets.
- `approver`: revisa, solicita cambios, aprueba, programa y publica.
- `admin`: administra Brand Kit, conexiones, destinos, miembros y facturación.

Los roles técnicos existentes (`owner`, `admin`, `editor`, `author`, `viewer`) se proyectan a este lenguaje en la PWA y en las respuestas MCP.

## Flujo externo de IA

```text
brand.context.get
→ preparación de generación
→ IA externa
→ content.post.create
→ content.post.variant.upsert
→ content.media.attach
→ copy.validate
→ revisión humana
→ publication.*
```

Cada resultado conserva `brandKitVersionId`, `brandKitSnapshotHash`, `generationRunId` y su procedencia.

## Flujo de publicación

```text
Canal → Destino → Proveedor → Operación → PublicationRun
```

La UI nunca llama directamente a Buffer, Coolify o WordPress. Todos los proveedores pasan por el control plane de `publication_runs`.
