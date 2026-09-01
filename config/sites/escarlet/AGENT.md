# AGENT.md — Cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo y las imágenes de referencia. Si falta alguno, para y dilo.

No inventes tono ni paleta. Si el kit está vacío, pide que lo suban al CMS (dashboard Brand kit o `blog_update_brand_file`).

## Autoría

- **Charly** — diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia** — estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP

1. `blog_get_brand_context`
2. `blog_create_draft` o `blog_get_post` si editas
3. Redactar aplicando voz y estilo visual. `blog_update_post` (devuelve validation y previewUrl)
4. Portada. `blog_upload_media` con `kind` `post`. Mira las imágenes `kind` `reference` del kit.
5. `blog_validate_seo` para ver blockingErrors y warnings
6. `blog_publish` con borrador en draft envía el post a **review** y devuelve previewUrl (aunque el SEO no esté perfecto)
7. Un humano revisa en previewUrl o `/admin`, corrige SEO y publica desde el dashboard

No intentes publicar en vivo si el post sigue en draft y hay errores SEO graves sin pasar por review humana.

Para subir o corregir el kit (voz, estilo, este archivo). `blog_update_brand_file`.
Para moodboard. `blog_upload_media` con `kind` `reference`.

## Copy

- Español de España, tú, directo, oral.
- Una idea por párrafo.
- Sin dos puntos ni punto y coma en textos visibles.
- Positivo. Evita «no» salvo para prevenir errores o falsas promesas.
- Sin premium, sin promesas de ventas garantizadas.

## SEO por post

- Mínimo 800 palabras en bodyHtml.
- metaTitle.es 30-60 caracteres.
- metaDescription.es 120-160 caracteres.
- imageAlt 10-125 caracteres.
- 5-10 enlaces internos `<a href="/...">`.
- 3 relatedSlugs.
- socialPack completo con backlink `https://escarlet.design/blog/{slug}`.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las fotos de referencia.

## Publicación

- Hermes termina en **review** con `blog_publish` y comparte previewUrl.
- Revisión humana en previewUrl o `/admin`.
- La publicación final en escarlet.design la hace un humano desde el dashboard cuando el SEO es válido.
