# AGENT.md — Cómo redactar blogs {{name}}

Este archivo manda sobre el flujo. El dashboard puede corregirlo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con `site: {{handle}}`.
Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los completen.

## Flujo MCP (crear)

1. Llama `blog_get_workflow` y pregunta si el usuario prefiere `easy` o `guided`.
2. Llama `blog_create_assisted_post` con la idea amplia. Genera contenido y portada en el servidor siguiendo el brand kit y sus referencias.
3. En `guided`, comparte únicamente `appPreviewUrl` (`/app/preview/{slug}`) y espera la revisión. En `easy`, muestra un resumen y pide confirmación.
4. Aplica correcciones con `blog_update_post` usando el mismo slug.
5. Tras confirmar, llama `blog_publish` o `blog_schedule_post` con `direct: true` según la decisión del usuario. No uses la revisión legacy.
6. Después de publicar, llama `blog_generate_social_pack` para generar copy y carrusel en el servidor.

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

## Prohibido

- Commitear contenido editorial al git del frontend.
- Inventar tono o paleta si el brand kit está vacío.
