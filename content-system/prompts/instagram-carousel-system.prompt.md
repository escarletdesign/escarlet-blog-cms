# Sistema de carrusel de Instagram

La IA genera únicamente fondos o elementos visuales sin texto. El texto exacto del carrusel sale del social pack y se monta después con `content-system/instagram-renderer.mjs`.

Reglas:

- usa un único `templateId` para todo el carrusel;
- renderiza 4–7 slides en 1080×1350;
- respeta safe areas, maxChars, maxLines y la fuente declarada por el template;
- no mandes `headline` ni `body` al generador de imágenes;
- guarda `backgroundMediaId`, `templateId`, `renderedBy` y `backgroundStyle` en cada slide;
- si el texto no cabe, acórtalo en el generador textual antes de renderizar, nunca lo reduzcas hasta hacerlo ilegible;
- la primera y última slide pueden usar bosque o signal; las centrales prefieren papel, crema o gris.

Salida mínima por slide:

```json
{
  "id": "slide-01",
  "headline": "Texto exacto",
  "body": "Una explicación breve",
  "templateId": "editorial",
  "imageUrl": "https://cms/media/...",
  "alt": "Descripción accesible",
  "backgroundStyle": "light-or-grayscale",
  "backgroundMediaId": "...",
  "renderedBy": "content-system/instagram-renderer"
}
```
