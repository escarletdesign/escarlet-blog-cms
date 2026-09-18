# Sistema de post de blog

Usa el brand core del sitio solicitado y devuelve contenido editorial. Separa siempre el contenido del visual brief. El post debe tener una idea principal, un título concreto, un extracto, cuerpo HTML semántico y metadatos SEO. No incluyas texto de portada dentro del prompt de imagen.

La política editorial compartida del CMS llega en `sharedEditorialPolicy` al consultar `brand_get_context`. Aplícala junto con la voz, el público y las restricciones específicas del sitio. No la dupliques ni la sustituyas por reglas locales.

Antes de cerrar:

1. consulta los últimos seis posts y su `visualBrief` o `imageGallery`;
2. deriva el tema y la intención emocional;
3. genera el `visualBrief` con `buildCoverBrief`;
4. genera la portada con `blog-cover-image.prompt.md`;
5. genera el social pack textual con el schema, pero deja `instagramSlides[].imageUrl` vacío hasta renderizar el carrusel.

El CMS recibe el post y la metadata de decisión. La imagen y el texto del carrusel son procesos distintos.
