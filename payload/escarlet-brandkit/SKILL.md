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

- La identidad fija es la paleta de `brand/brand-core.json`: cian `#12B8D6`, verde suave `#62B38A`, crema `#F3E7D0`, oro `#E8B73A`, carbón `#1E1E1E`, gris `#6D6D6D` y blanco `#FFFFFF`.
- `fondo-escarlet.jpg` y `05-tablero-visual.png` son referencias obligatorias para cualquier generación. El fondo conserva el flujo cian a la izquierda, verde suave en el centro y oro a la derecha.
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
4. Conserva `brandPreparation.preparationId`. Para post o social sube con `content_upload_media` y pasa ese valor. El CMS rechaza imágenes sin grounding o con snapshot vencido.
5. Si `generationBlocked` es `true`, no generes ni sustituyas referencias. Solicita que se restaure el activo indicado.
6. Para Instagram genera solo el fondo. El texto lo monta `content-system/instagram-renderer.mjs`.

## Al entregar

Comprueba contraste, safe areas, nombres SEO, JSON válido y consistencia con la versión `2.2.0`. Si el brand kit del CMS cambia, compara el `brandKitSnapshotHash` antes de sincronizar esta copia local y no reemplaces archivos a ciegas.
