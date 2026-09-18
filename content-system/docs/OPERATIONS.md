# Operaciones

## Generar una portada

```bash
node content-system/scripts/generate-cover-options.mjs \
  --site=escarlet --title="La IA ya diseña bien. Ese empieza a ser el problema" \
  --summary="Cuando la herramienta deja de fallar, el criterio pasa a ser el trabajo." \
  --mode=automatic
```

El resultado es un visual brief listo para pasarlo al prompt de imagen.

## Renderizar un carrusel

```bash
node content-system/scripts/render-instagram-carousel.mjs \
  --input=content-system/examples/sample-carousel-output.json \
  --output=tmp/carousel
```

El renderer usa `@resvg/resvg-js`, no la tipografía del generador de imágenes.

## Analizar activos existentes

```bash
node content-system/scripts/analyze-existing-assets.mjs --site=escarlet --json=tmp/assets-audit.json
```

Lee `data/db.json` por defecto y puede recibir `--db=/ruta/a/db.json`.

## Regenerar un post

```bash
node content-system/scripts/regenerate-post-assets.mjs --site=escarlet --slug=mi-post --dry-run
```

Sin `--dry-run` usa el MCP local para actualizar metadata. La subida de imágenes v2 usa `content_upload_media` y, para post o social, la credencial de `brand_prepare_image_generation`.

## Agregar referencias

1. Sube la imagen con `content_upload_media` y `kind: reference`.
2. Añade su entrada a `escarlet-reference-library.json` con `approved: true`.
3. En producción sincroniza `visual-style.md` e `image-spec.json` con `blog_update_brand_file`.

## Agregar arquetipos o templates

Añade un objeto que cumpla el schema correspondiente y un template HTML/CSS. No cambies la retícula de un carrusel existente sin versionar el `templateId`.
