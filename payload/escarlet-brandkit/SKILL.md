---
name: escarlet-brandkit
description: Aplica la identidad verbal, visual y editorial de Escarlet en contenido, imágenes y operaciones del Blog CMS.
---

# Brandkit local de Escarlet

Esta skill es la copia operativa del brand kit canónico preparado para el handle `escarlet`. Usa los archivos de esta carpeta como documentación y el MCP como fuente de decisión para imágenes. La petición actual del usuario prevalece, pero nunca puede saltarse los bloqueos de referencias ni los permisos del MCP.

## Qué leer según el encargo

- **Copy, narrativa o SEO:** lee `voice.md`, `keywords.md` y, si necesitas el razonamiento estratégico completo, `docs/01-identidad-verbal-adn-marca.md`.
- **Diseño o imágenes:** lee `brand/brand-core.json`, `brand/visual-system.json`, `visual-style.md`, `image-guide.md`, `brand/image-archetypes.json` y `brand/reference-library.json`. Después llama `brand_prepare_image_generation` con el `site`, `assetType` y el contexto de la pieza. Usa únicamente los `resolvedReferences` que devuelve el MCP.
- **Social/Instagram:** añade `brand/social-templates.json` e `image-spec.json`. Genera fondos sin texto y monta el texto después con el renderer del CMS.
- **Operación en el Blog CMS:** lee `AGENT.md` y respeta su flujo, permisos y contrato de subida. No publiques ni subas contenido por el mero hecho de usar esta skill.

## Precedencia visual

- La identidad fija es la paleta de `brand/brand-core.json`: papel `#F4F1EA`, papel cálido `#E8E0D3`, verde bosque `#1F4D3A`, verde profundo `#15352A`, tinta `#1B211D`, gris `#6C746F`, terracota `#C8674B` y blanco `#FFFFFF`.
- `reference-abstract-editorial.jpg` es la autoridad de paleta, materia y luz. La ruta añade `reference-human-work.jpg`, `reference-introspective.jpg` o `reference-positive.jpg` cuando corresponde.
- No uses cian, turquesa, amarillo brillante, degradados oro ni montañas abstractas.
- Las imágenes incluidas muestran personas anónimas. No son referencias de identidad facial y no se copian literalmente.
- La selección es determinista. No es válido escoger, sustituir, reordenar ni reinterpretar referencias.
- Nunca redibujes el logo. Usa los SVG oficiales de `assets/`.

## Invariantes de marca

- Marca: Escarlet. Handle CMS: `escarlet`.
- Categoría: agencia de lanzamiento para profesionales con experiencia.
- Firma verbal: «Tu experiencia, en marcha».
- Método: «Escuchamos → Definimos → Construimos → Lanzamos → Mejoramos».
- Voz: español de España, tú, directa, humana y clara. Beneficio antes que herramienta.
- No inventes clientes, cifras, testimonios, credenciales, precios fuera de los documentados ni resultados garantizados.
- Portadas y fondos generados sin palabras, logos, marcas de agua ni UI legible. El texto de Instagram lo monta la plantilla.

## Contrato obligatorio de imágenes

1. Consulta `brand_get_context` para leer el contexto general y las políticas.
2. Llama `brand_prepare_image_generation` antes de generar cualquier imagen.
3. Entrega al generador exactamente sus `resolvedReferences` como `ImageContent`, respetando `attachmentIndex`.
4. Los múltiples `ImageContent` son referencias, no salidas. Genera exactamente una imagen final cuando la petición sea singular.
5. Conserva `brandPreparation.preparationId`. Para post o social sube con `content_upload_media` y pasa ese valor. El CMS rechaza imágenes sin grounding o con snapshot vencido.
6. Si `generationBlocked` es `true`, no generes ni sustituyas referencias. Solicita que se restaure el activo indicado.
7. Para Instagram genera solo el fondo. El texto lo monta `content-system/instagram-renderer.mjs`.

## Al entregar

Comprueba contraste, safe areas, nombres SEO, JSON válido y consistencia con la versión `2.3.0`. Si el brand kit del CMS cambia, compara el `brandKitSnapshotHash` antes de sincronizar esta copia local y no reemplaces archivos a ciegas.
