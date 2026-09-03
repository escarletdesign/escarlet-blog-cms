# AGENT.md — Cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los suban (dashboard Brand kit o `blog_update_brand_file`).

Lee cada `postFields[].askHuman`. Pregunta al humano lo que aún no sepas antes de redactar.

No inventes tono ni paleta.

## Autoría

- **Charly** — diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia** — estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP (crear)

1. `blog_get_brand_context`
2. Pregunta lo que falte según `postFields`
3. `blog_create_draft` solo si el slug es nuevo
4. Redactar. `blog_update_post` (devuelve validation y previewUrl)
5. Portada. Genera la imagen. `blog_upload_media` (`kind` `post`). Preferido `imageUrl` https pública. Si ChatGPT solo tiene el archivo en sandbox (`/mnt/data/...`), usa `contentBase64`. Nunca pases rutas sandbox como `imageUrl`.
6. Si `socialPackChannels.instagramCarousel` está activo. Genera 4–7 slides (1080×1350), súbelas todas con `blog_upload_media` (`kind` `social`, filename `{slug}-ig-01.webp` …) y guarda `socialPack.instagramSlides` + `instagramCaption` con canónico. Misma regla de sandbox.
7. Completa `socialPack` solo para canales activos en `socialPackChannels`
8. `blog_validate_seo`
9. `blog_publish` con borrador en draft envía a **review** y devuelve previewUrl absoluto
10. Comparte siempre el `previewUrl` completo (https://...) con el humano

## Flujo MCP (editar)

1. `blog_get_brand_context`
2. `blog_list_posts` y `blog_get_post` con el slug existente
3. **Nunca** `blog_create_draft` para editar. Eso duplica el post.
4. `blog_update_post` con el **mismo slug**
5. Si renombras el slug. pasa `originalSlug` (actual) y `slug` (nuevo)
6. Con aprobación humana, un post `published` baja a `review` al actualizarlo. Un humano debe volver a publicar en vivo
7. Comparte el `previewUrl`

## Despublicar y eliminar

- Despublicar (sale del blog, queda el contenido). `blog_unpublish`
- Eliminar permanente. `blog_delete_post` con `confirm: true`

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
- socialPack con backlink `https://escarlet.design/blog/{slug}` (solo canales activos en `socialPackChannels`).
- Carrusel Instagram. Caption con canónico. Slides con `imageUrl` absoluta del CMS + alt.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las fotos de referencia.
- Cómo subir (orden preferido):
  1. Genera o elige la imagen.
  2. Si tienes URL http(s) pública temporal, pásala en `imageUrl` a `blog_upload_media`.
  3. Si solo tienes el archivo en sandbox de ChatGPT (`/mnt/data/...`, `sandbox:`, `file://`), lee el archivo y pasa `contentBase64` completo a `blog_upload_media`. Nunca uses esas rutas como `imageUrl`.
  4. Usa la `media.url` absoluta que devuelve el CMS en el `imageUrl` del post (o en cada slide de Instagram).
- Carrusel Instagram (`kind` `social`). 4–7 slides. Formato 1080×1350 (o 1080×1080). Filename `{slug}-ig-01.webp` … `{slug}-ig-07.webp`. Sube cada slide al CMS y guarda el array en `socialPack.instagramSlides`.
- En portadas grandes prefiere `imageUrl` https. Usa `contentBase64` cuando el sandbox sea la única copia del archivo.

## Publicación

- Hermes termina en **review** con `blog_publish` y comparte previewUrl.
- Revisión humana en previewUrl o `/admin`.
- La publicación final en escarlet.design la hace un humano desde el dashboard cuando el SEO es válido.
