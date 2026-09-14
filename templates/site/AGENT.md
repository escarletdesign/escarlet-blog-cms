# AGENT.md — Cómo redactar blogs {{name}}

Este archivo manda sobre el flujo. El dashboard puede corregirlo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con `site: {{handle}}`.
Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los completen.

## Flujo MCP (crear)

1. Llama `blog_get_workflow` y pregunta si el usuario prefiere `easy` o `guided`.
2. Genera el título, contenido, metadatos e imágenes en ChatGPT siguiendo el brand kit y sus referencias. Guarda el borrador con `blog_create_draft`, `blog_upload_media` y `blog_update_post`.
3. En `guided`, comparte únicamente `appPreviewUrl` (`/app/preview/{slug}`) y espera la revisión. En `easy`, muestra un resumen y pide confirmación.
4. Aplica correcciones con `blog_update_post` usando el mismo slug.
5. Tras confirmar, llama `blog_publish` o `blog_schedule_post` con `direct: true` según la decisión del usuario. Usa la revisión dentro de `/app`.
6. Guarda el Social Pack generado por ChatGPT con `blog_save_social_pack`. El CMS no genera copy ni carruseles desde MCP.

## Sistema visual

- Inspecciona los últimos seis posts y guarda un `visualBrief` antes de crear una portada.
- Elige un arquetipo del sistema del sitio y evita repetir el arquetipo consecutivo. La portada no lleva texto.
- Usa referencias aprobadas y registra `references`, `negativeRules` y `decision.recentPostsInspected`.
- Para Instagram, genera fondos sin texto y monta `headline` + `body` con un template controlado y la fuente declarada. El generador de imágenes no dibuja tipografía.
- Conserva `templateId`, `backgroundMediaId` y `renderedBy` en cada slide.

## Flujo MCP (editar)

1. `blog_get_brand_context`
2. `blog_get_post` con el slug existente
3. Nunca `blog_create_draft` para editar
4. `blog_update_post` con el mismo slug
5. Si renombras. `originalSlug` + `slug` nuevo
6. Comparte `appPreviewUrl` de `/app` solo cuando el usuario necesite revisar.

## Copy

- Sigue `voice.md`.
- Sin dos puntos ni punto y coma en textos visibles.
- socialPack con backlink `{{domain}}/blog/{slug}` (canales activos del site).
- Instagram. Caption + slides con imageUrl del CMS.

### Pasada humana StoryScope

- Usa StoryScope como guía editorial, no para intentar engañar detectores.
- Conserva hechos, intención, keywords y voz de marca. No inventes anécdotas, citas ni referencias.
- Sustituye abstracciones por detalles observables y muestra decisiones con costes o consecuencias cuando existan.
- No expliques la moraleja varias veces. Deja espacio para que el lector infiera y mantén matices cuando el tema lo necesite.
- Revisa agencia, linealidad, estructura temporal, subtramas y repeticiones sensoriales. Cambia solo lo que mejore claridad e interés.
- Haz una segunda pasada para eliminar frases intercambiables antes de resumir o publicar.

## Prohibido

- Commitear contenido editorial al git del frontend.
- Inventar tono o paleta si el brand kit está vacío.
