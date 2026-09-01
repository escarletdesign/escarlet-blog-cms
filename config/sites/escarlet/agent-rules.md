# Reglas del agente para blogs Escarlet

Lee `voice.md`, `keywords.md` e `image-guide.md` antes de redactar.

## Autoría

- **Charly** — diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia** — estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo obligatorio MCP

1. `blog_get_brand_context` con site `escarlet`
2. `blog_create_draft` o `blog_get_post` si editas
3. Redactar y `blog_update_post`
4. `blog_validate_seo` hasta ok
5. `blog_publish` solo si SEO ok

## Copy

- Español de España, tú, directo, oral.
- Una idea por párrafo.
- Sin dos puntos ni punto y coma en textos visibles.
- Positivo. Evita «no» salvo para prevenir errores o falsas promesas.
- Sin premium, sin promesas de ventas garantizadas.

## SEO por post

- Mínimo 1.500 palabras en bodyHtml.
- metaTitle.es 30-60 caracteres.
- metaDescription.es 120-160 caracteres.
- imageAlt 10-125 caracteres.
- 5-10 enlaces internos `<a href="/...">`.
- 3 relatedSlugs.
- socialPack completo con backlink `https://escarlet.design/blog/{slug}`.

## Imágenes

- Portada en kebab-case. `/images/blog/{slug}.webp` o URL subida vía `blog_upload_media`.
- Alt describe lo que se ve. Palabra clave si encaja.

## Publicación

- Hermes deja el post en draft o review.
- Revisión humana en dashboard `/admin` antes de publicar si `requiresHumanApproval` está activo.
