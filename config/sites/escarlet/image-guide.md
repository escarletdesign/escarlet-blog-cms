# Imágenes. Nombres de archivo y alt text

Convención del sitio alineada con el curso de SEO. Aplica a portadas, fotos de equipo, casos, logo, previews de guías y cualquier imagen que Google pueda indexar.

## Nombre de archivo

- Minúsculas y kebab-case. `diseno-web-el-ejido.webp`.
- Describe la entidad, el servicio y la zona cuando aportan. `carlos-brugiafredo-diseno-desarrollo-el-ejido.webp`.
- Sin espacios, sin tildes, sin `trabajos -`, sin nombres de herramienta (`chatgpt`, `pexels`, `img_1234`).
- Prefiere `.webp`. Guarda un `.jpg` o `.png` de respaldo si hace falta.
- El archivo y el alt hablan de lo mismo.

## Alt text

- Describe lo que se ve y nombra la entidad o la página.
- Una o dos frases cortas. Punto o coma. Sin `:` ni `;`.
- Incluye la palabra clave de la página si describe de verdad la imagen.
- Las fotos decorativas (fondos de hero, método) van con `alt=""`.
- El logo. `Escarlet. Branding y diseño web`.

## Dónde van los archivos

| Uso | Carpeta | Ejemplo |
|---|---|---|
| Logo | `public/` | `escarlet-logo-branding-diseno-web.png` |
| Equipo | `public/images/home/team/` | `carlos-brugiafredo-diseno-desarrollo-el-ejido.webp` |
| Portadas de casos | `public/works/` | `gala-identidad-ceramica-artesanal.webp` |
| Galería de un caso | `public/works/{slug}/` | `gala/gala1.webp` |
| Blog | `public/images/blog/` | `seo-local-almeria-guia-google-maps.webp` |
| Preview de guía | `public/images/leads/` | `checklist-seo-local-almeria.webp` |
| PDF de guía | `public/leads/` | `checklist-seo-local-almeria.pdf` |

## Cómo añadir una imagen nueva

1. Nombra el archivo antes de subirlo.
2. Copia a la carpeta de la tabla.
3. Actualiza `src` y `alt` en el mismo cambio.
4. Si sustituyes un archivo, deja el viejo un tiempo para no romper caché.

Antes de generar cualquier imagen, llama `brand_prepare_image_generation` después de `brand_get_context`. Entrega al generador exactamente sus `resolvedReferences` como `ImageContent`, en el orden de `attachmentIndex`. No escojas ni sustituyas referencias. Si `generationBlocked` es `true`, detén la generación y restaura los activos indicados. Esta regla aplica a portadas, imágenes de artículo, imágenes sociales, slides, fondos y piezas de apoyo.

## Carrusel Instagram (blog)

Si el site tiene `instagramCarousel` activo, el agente genera 4–7 slides (1080×1350), las sube al CMS con `kind` `social` (`{slug}-ig-01.jpg` …) y las enlaza en `socialPack.instagramSlides`. ChatGPT envía el PNG en `contentBase64` o a trozos. El CMS comprime. El pack admin solo descarga las URLs del CMS.

Regla visual del carrusel: la primera y la última slide pueden usar colores de marca o gradientes suaves. Las slides centrales usan fondos blancos, grises o desaturados y evitan colores saturados. No uses papel crema. Genera los fondos de Instagram sin texto. El CMS renderiza el `headline` y `body` guardados, con ortografía exacta, jerarquía clara y tamaño legible en móvil. Si el copy no cabe, acórtalo o divídelo entre slides.

## Lead magnets

Cada guía tiene PDF en `public/leads/` y portada en `public/images/leads/` con el mismo kebab-case.

1. Guarda el PDF en `public/leads/`.
2. Pon `pdfFile` en `src/data/lead-magnets.js`.
3. La portada es una captura de la página 1 en `.webp`, con `.jpg` de respaldo.

## Pendiente de covers únicos

Tres artículos del blog reutilizan `cuanto-cuesta-pagina-web-almeria-2026.webp`. El alt describe el tema de cada artículo. Conviene una portada propia por post.
