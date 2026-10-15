# Sistema de carrusel de Instagram

La IA genera cada slide final con el texto exacto del social pack ya integrado en la imagen. El CMS no monta texto, logos ni overlays y no modifica los píxeles recibidos. El resultado se certifica en formato 4:5, 1080×1350.

Reglas:

- Antes de generar cualquier pieza visual, consulta `brand_get_context`, llama `brand_prepare_image_generation` y entrega exactamente sus `resolvedReferences` como `ImageContent`. No escojas ni sustituyas referencias. Si `generationBlocked` es `true`, detén la generación.
- usa un único `templateId` para todo el carrusel;
- genera 4–7 slides finales en 1080×1350;
- respeta safe areas, maxChars, maxLines y la fuente declarada por el template;
- el headline y el body deben ser legibles en un móvil desde la primera lectura;
- manda el `headline` y el `body` aprobados al generador de imágenes y no los reescribas durante la generación;
- guarda `templateId`, `textContent`, `textRendered: true` y `renderedBy: "chatgpt-image-generation"` en cada slide;
- si el texto no cabe, acórtalo o divide la idea entre slides antes de generar, nunca reduzcas la tipografía hasta hacerlo ilegible;
- la primera y última slide pueden usar carbón, cian u oro; las centrales prefieren superficies blancas, grises o desaturadas, nunca papel crema.
- no uses guiones, rayas, em dash, en dash ni separadores de guiones como decoración;
- no añadas borde, contorno, trazo, outline, halo ni sombra pegada a ningún texto. La legibilidad debe salir de la tipografía, el tamaño, el peso, el color, el contraste y el espacio.

Salida mínima por slide:

```json
{
  "id": "slide-01",
  "headline": "Texto exacto",
  "body": "Una explicación breve",
  "templateId": "editorial",
  "imageUrl": "https://cms/media/...",
  "alt": "Descripción accesible",
  "textContent": {
    "headline": "Texto exacto",
    "body": "Una explicación breve"
  },
  "dimensions": "1080x1350",
  "aspectRatio": "4:5",
  "renderedBy": "chatgpt-image-generation",
  "textRendered": true
}
```

`backgroundMediaId` y `backgroundSource` solo se leen en publicaciones históricas. No los uses para crear un fondo separado en el flujo actual.
