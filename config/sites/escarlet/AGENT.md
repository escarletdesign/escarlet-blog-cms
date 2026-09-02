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
6. `blog_publish` con borrador en draft envía el post a **review** y devuelve previewUrl absoluto
7. Comparte siempre el `previewUrl` completo (https://...) con el humano. Es un link listo para hacer click.

Al terminar create/update/publish, pega en el chat el valor exacto de `previewUrl` (URL completa).

Para subir o corregir el kit (voz, estilo, este archivo). `blog_update_brand_file`.
Para moodboard. `blog_upload_media` con `kind` `reference`.

## Copy

- Español de España, tú, directo, oral.
- Una idea por párrafo.
- Sin dos puntos ni punto y coma en textos visibles.
- Positivo. Evita «no» salvo para prevenir errores o falsas promesas.
- Sin premium, sin promesas de ventas garantizadas.

## SEO por post

Bloquean publicar solo lo grave (texto vacío o muy corto, sin título/slug, autor inválido).

Recomendado (aviso, no bloquea):

- Alrededor de 400-800 palabras. Claro y útil, sin relleno.
- metaTitle.es 20-70 caracteres.
- metaDescription.es 70-180 caracteres.
- imageAlt descriptivo.
- Al menos 1 enlace interno.
- socialPack con backlink `https://escarlet.design/blog/{slug}`.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las fotos de referencia.
- Sube el archivo completo (PNG/JPG/WebP real, no truncado). Tras `blog_upload_media`, usa la `media.url` absoluta en `imageUrl`.
- Si una portada está rota, vuelve a generar y subir con el mismo filename o uno nuevo y actualiza el post.

## Publicación

- Hermes termina en **review** con `blog_publish` y comparte previewUrl.
- Revisión humana en previewUrl o `/admin`.
- La publicación final en escarlet.design la hace un humano desde el dashboard cuando el SEO es válido.
