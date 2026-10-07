# Workflow visual v2

```text
brand_list → brand_get_context
        ↓
copy editorial + visual brief
        ↓
content_create_batch
        ↓
brand_prepare_image_generation por item y canal
        ↓
ChatGPT genera la imagen final con texto
        ↓
content_upload_media passthrough
        ↓
content_get_batch → revisión
```

## Modos

- `automatic`: una ruta final, con metadata de decisión.
- `exploration`: solo para portadas históricas y fixtures. El flujo social publicado usa una única ruta determinista.

## Repetición

Inspecciona seis posts publicados o recientes. No repitas el arquetipo anterior. Si la similitud temática supera 0,62, cambia también el tipo de encuadre y la presencia de persona. El script `analyze-existing-assets.mjs` marca repetición por filename, hash y metadata. Esta variedad no cambia el contrato de formato social.

## Assets sociales

`instagram` usa `social_image` a 1080×1350. Cada slide se genera con texto integrado y declara `textRendered`, `textContent`, `templateId` y `renderedBy: "chatgpt-image-generation"`.

`instagram_story` usa `instagram_story` a 1080×1920. La estructura canónica es `socialPack.instagramStory.frames[]`. Los campos antiguos de Story se conservan solo para lectura histórica.

El CMS no compone overlays, tipografía ni logos. Comprueba dimensiones, metadata, preparación, hash e idempotencia, y conserva los píxeles recibidos.

## María Morales

El sistema es multi-site. Para otro sitio, copia los cinco archivos de `brand/`, cambia `site` y carga sus referencias mediante MCP. Las reglas de layout son reutilizables, pero paleta, voz y referencias nunca se comparten automáticamente.
