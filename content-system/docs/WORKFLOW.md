# Workflow visual v2

```text
post + resumen + historial reciente
        ↓
visual brief (arquetipo + referencias + reglas negativas)
        ↓
IA → portada sin texto

social copy → slides estructuradas
        ↓
IA → fondos sin texto
        ↓
renderer SVG/CSS → PNG 1080×1350
        ↓
CMS → socialPack.instagramSlides[].imageUrl
```

## Modos

- `automatic`: una ruta final, con metadata de decisión.
- `exploration`: tres rutas de portada y dos templates de carrusel para elegir.

## Repetición

Inspecciona seis posts publicados o recientes. No repitas el arquetipo anterior. Si la similitud temática supera 0,62, cambia también el tipo de encuadre y la presencia de persona. El script `analyze-existing-assets.mjs` marca repetición por filename, hash y metadata.

## María Morales

El sistema es multi-site. Para otro sitio, copia los cinco archivos de `brand/`, cambia `site` y carga sus referencias mediante MCP. Las reglas de layout son reutilizables, pero paleta, voz y referencias nunca se comparten automáticamente.
