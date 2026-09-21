# Sistema de carrusel de Instagram

La IA genera únicamente fondos o elementos visuales sin texto. El texto exacto del carrusel sale del social pack y se monta después con `content-system/instagram-renderer.mjs`. La slide final publicada siempre contiene ese texto y se certifica en formato 4:5 o 3:4.

Reglas:

- Antes de generar cualquier fondo o elemento visual, consulta `brand_get_context`, llama `brand_prepare_image_generation` y entrega exactamente sus `resolvedReferences` como `ImageContent`. No escojas ni sustituyas referencias. Si `generationBlocked` es `true`, detén la generación.
- usa un único `templateId` para todo el carrusel;
- renderiza 4–7 slides en 1080×1350 o 1080×1440;
- respeta safe areas, maxChars, maxLines y la fuente declarada por el template;
- el headline y el body deben ser legibles en un móvil desde la primera lectura;
- no mandes `headline` ni `body` al generador de imágenes;
- guarda `backgroundMediaId`, `templateId`, `renderedBy` y `backgroundStyle` en cada slide;
- si el texto no cabe, acórtalo o divide la idea entre slides antes de renderizar, nunca reduzcas la tipografía hasta hacerlo ilegible;
- la primera y última slide pueden usar carbón, cian u oro; las centrales prefieren superficies blancas, grises o desaturadas, nunca papel crema.

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
