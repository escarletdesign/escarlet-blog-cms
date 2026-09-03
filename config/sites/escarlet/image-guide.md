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

## Carrusel Instagram (blog)

Si el site tiene `instagramCarousel` activo, el agente genera 4–7 slides (1080×1350), las sube al CMS con `kind: social` (`{slug}-ig-01.webp` …) y las enlaza en `socialPack.instagramSlides`. El pack admin solo las descarga.

## Lead magnets

Cada guía tiene PDF en `public/leads/` y portada en `public/images/leads/` con el mismo kebab-case.

1. Guarda el PDF en `public/leads/`.
2. Pon `pdfFile` en `src/data/lead-magnets.js`.
3. La portada es una captura de la página 1 en `.webp`, con `.jpg` de respaldo.

## Pendiente de covers únicos

Tres artículos del blog reutilizan `cuanto-cuesta-pagina-web-almeria-2026.webp`. El alt describe el tema de cada artículo. Conviene una portada propia por post.
