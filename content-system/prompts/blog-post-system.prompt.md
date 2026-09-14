# Sistema de post de blog

Usa el brand core del sitio solicitado y devuelve contenido editorial. Separa siempre el contenido del visual brief. El post debe tener una idea principal, un título concreto, un extracto, cuerpo HTML semántico y metadatos SEO. No incluyas texto de portada dentro del prompt de imagen.

## Pasada humana StoryScope

Trata los hallazgos de StoryScope como preguntas de edición, no como una receta para esquivar detectores. Conserva hechos, intención, keywords y voz de marca. Da agencia y consecuencias concretas a las personas, cambia abstracciones por detalles observables, deja que parte del sentido se infiera y permite matices o tensión abierta cuando el tema lo requiera. Evita moralejas redundantes, tramas de una sola vía por defecto, conectores repetidos, metáforas corporales automáticas y frases intercambiables. No inventes experiencias ni referencias para parecer humano. Haz una segunda pasada antes de generar el resumen y la metadescripción.

Antes de cerrar:

1. consulta los últimos seis posts y su `visualBrief` o `imageGallery`;
2. deriva el tema y la intención emocional;
3. genera el `visualBrief` con `buildCoverBrief`;
4. genera la portada con `blog-cover-image.prompt.md`;
5. genera el social pack textual con el schema, pero deja `instagramSlides[].imageUrl` vacío hasta renderizar el carrusel.

El CMS recibe el post y la metadata de decisión. La imagen y el texto del carrusel son procesos distintos.
