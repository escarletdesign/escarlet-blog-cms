# Escarlet CMS Brand Kit

Versión 2.2.0 · 18 de septiembre de 2026

Paquete preparado para importar en `escarlet-blog-cms` mediante `blog_import_brand_zip` o desde `/app` → la marca Escarlet → Identidad y brand kit → Importar ZIP.

## Qué se ha combinado

- La identidad verbal y las reglas editoriales de `brandkit escarlet`.
- El contrato real del CMS: `voice.md`, `visual-style.md`, `image-guide.md`, `keywords.md`, `AGENT.md` e `image-spec.json`.
- El sistema visual 2.2.0 del CMS: brand core, sistema visual, arquetipos, referencias y plantillas sociales.
- Las cuatro imágenes adjuntas como referencias visuales importables y los dos SVG oficiales del logo.

## Decisión de precedencia

El sistema 2.2.0 activo del CMS usa una única identidad fija: cian `#12B8D6`, verde suave `#62B38A`, crema `#F3E7D0`, oro `#E8B73A`, carbón `#1E1E1E`, gris `#6D6D6D` y blanco `#FFFFFF`. El fondo canónico conserva el flujo cian, verde suave y oro, pero no crea una segunda identidad.

La regla práctica es:

1. `brand/brand-core.json` y `brand/reference-library.json` definen la identidad y las referencias canónicas.
2. `brand_prepare_image_generation` resuelve la ruta y los adjuntos exactos para cada imagen.
3. `visual-style.md`, `image-spec.json` y `AGENT.md` documentan el mismo contrato operativo.
4. Los documentos de `source-material/` son trazabilidad, no archivos que el agente deba cargar automáticamente.

## Archivos de runtime

| Archivo | Uso en el CMS |
| --- | --- |
| `voice.md` | Voz, posicionamiento, promesas y vocabulario |
| `visual-style.md` | Dirección visual y convivencia de paletas |
| `image-guide.md` | Nombres, alt y destinos de archivos |
| `keywords.md` | Keywords y criterio SEO |
| `AGENT.md` | Flujo operativo del agente |
| `image-spec.json` | Reglas estructuradas para imágenes y carruseles |
| `brand/*.json` | Sistema visual 2.2.0 importable por sitio |

## Referencias incluidas

Las imágenes de `assets/reference-*.png` son referencias de estilo, no retratos autoritativos. Muestran personas anónimas y composiciones editoriales. El logo se conserva como archivo oficial y no debe redibujarse con IA.

## Documentos de trabajo

`docs/` contiene el perfil y la guía legible para humanos. `source-material/` conserva los archivos originales aportados, incluido el spec visual anterior, para poder auditar qué se ha transformado.

## Estado canónico

- La versión operativa es `2.2.0` y el MCP publica `brandKitVersionId` y `brandKitSnapshotHash`.
- Si falta `05-tablero-visual.png` o `fondo-escarlet.jpg`, el MCP bloquea la generación y no permite sustituciones.
- El logo se conserva como archivo oficial y no debe redibujarse con IA.

## Regla rápida

Una pieza de Escarlet debe sonar clara y humana, empezar por la experiencia del cliente y convertir complejidad en un siguiente paso concreto. Visualmente debe usar una idea, materia real, luz natural o cálida, espacio negativo y cero texto incrustado en las imágenes generadas.
