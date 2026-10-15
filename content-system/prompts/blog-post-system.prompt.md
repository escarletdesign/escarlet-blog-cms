# Sistema de post de blog

Usa el brand core del sitio solicitado y devuelve contenido editorial. Separa siempre el contenido del visual brief. El post debe tener una idea principal, un título concreto, un extracto, cuerpo HTML semántico y metadatos SEO. No incluyas texto de portada dentro del prompt de imagen.

La política editorial compartida del CMS llega en `sharedEditorialPolicy` al consultar `brand_get_context`. Aplícala junto con la voz, el público y las restricciones específicas del sitio. No la dupliques ni la sustituyas por reglas locales.

En todo texto visible de Escarlet no uses guiones, rayas, em dash, en dash ni separadores de guiones como decoración. Usa puntuación, subtítulos, saltos o espacio.

Antes de cerrar:

1. consulta los últimos seis posts y su `visualBrief` o `imageGallery`;
2. deriva el tema y la intención emocional;
3. genera el `visualBrief` con `buildCoverBrief`;
4. genera la portada sin texto con `blog-cover-image.prompt.md`;
5. redacta el social pack con el schema, incluyendo el copy exacto y la metadata necesaria para generar después las imágenes sociales finales con texto integrado. Stories usan `instagramStory.frames[]`.

El CMS recibe el post y la metadata de decisión. La generación editorial del copy y la generación visual final son pasos separados, pero cada imagen social se entrega ya compuesta por ChatGPT. El CMS no añade overlays.
