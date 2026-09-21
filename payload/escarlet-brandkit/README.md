# Escarlet CMS Brand Kit

Versión 2.3.0 · 18 de septiembre de 2026

Paquete preparado para importar desde la app v2, en la marca Escarlet, dentro de Identidad y brand kit.

## Qué se ha combinado

- La identidad verbal y las reglas editoriales de `brandkit escarlet`.
- El contrato real del CMS: `voice.md`, `visual-style.md`, `image-guide.md`, `keywords.md`, `AGENT.md` e `image-spec.json`.
- El sistema visual 2.3.0 del CMS: brand core, sistema visual, arquetipos, referencias y plantillas sociales.
- Cuatro referencias visuales optimizadas para MCP y los dos SVG oficiales del logo.

## Decisión de precedencia

El sistema 2.3.0 recupera la identidad visual de `master`: papel `#F4F1EA`, papel cálido `#E8E0D3`, verde bosque `#1F4D3A`, verde profundo `#15352A`, tinta `#1B211D`, gris `#6C746F`, terracota `#C8674B` y blanco `#FFFFFF`. La dirección cian, oro y montañas queda retirada.

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
| `brand/*.json` | Sistema visual 2.3.0 importable por sitio |

## Referencias incluidas

Las imágenes de `assets/reference-*.jpg` son referencias de estilo, no retratos autoritativos. Definen materia, luz, paleta y escenas editoriales anónimas. El logo se conserva como archivo oficial y no debe redibujarse con IA.

## Documentos de trabajo

`docs/` contiene el perfil y la guía legible para humanos. `source-material/` conserva los archivos originales aportados, incluido el spec visual anterior, para poder auditar qué se ha transformado.

## Estado canónico

- La versión operativa es `2.3.0` y el MCP publica `brandKitVersionId` y `brandKitSnapshotHash`.
- Si falta cualquiera de las referencias exactas de la ruta, el MCP bloquea la generación y no permite sustituciones.
- `brand_prepare_image_generation` entrega los binarios como `ImageContent`, con filename, orden, rol y hash en `_meta`.
- El logo se conserva como archivo oficial y no debe redibujarse con IA.

## Regla rápida

Una pieza de Escarlet debe sonar clara y humana, empezar por la experiencia del cliente y convertir complejidad en un siguiente paso concreto. Visualmente debe usar una idea, materia real, luz natural o cálida, espacio negativo y cero texto incrustado en las imágenes generadas.
