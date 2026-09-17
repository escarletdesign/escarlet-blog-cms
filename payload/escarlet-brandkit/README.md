# Escarlet CMS Brand Kit

Versión 2.1 · 17 de septiembre de 2026

Paquete preparado para importar en `escarlet-blog-cms` mediante `blog_import_brand_zip` o desde `/app` → la marca Escarlet → Identidad y brand kit → Importar ZIP.

## Qué se ha combinado

- La identidad verbal y las reglas editoriales de `brandkit escarlet`.
- El contrato real del CMS: `voice.md`, `visual-style.md`, `image-guide.md`, `keywords.md`, `AGENT.md` e `image-spec.json`.
- El sistema visual v2 del CMS: brand core, sistema visual, arquetipos, referencias y plantillas sociales.
- Las cuatro imágenes adjuntas como referencias visuales importables y los dos SVG oficiales del logo.

## Decisión de precedencia

El sistema v2 activo del CMS conserva la paleta operativa crema, verde bosque, tinta y coral. El material adjunto de septiembre introduce un degradado editorial cian–verde–oro y se conserva como referencia para cabeceras conceptuales de blog, no como sustitución de la identidad fija. Así se evita que el agente mezcle dos paletas en una misma pieza.

La regla práctica es:

1. `brand/brand-core.json` y `brand/visual-system.json` mandan sobre la identidad visual de runtime.
2. `visual-style.md` permite el tratamiento cian–verde–oro únicamente como preset editorial de cabecera cuando el brief lo justifica.
3. Los documentos de `source-material/` son trazabilidad, no archivos que el agente deba cargar automáticamente.

## Archivos de runtime

| Archivo | Uso en el CMS |
| --- | --- |
| `voice.md` | Voz, posicionamiento, promesas y vocabulario |
| `visual-style.md` | Dirección visual y convivencia de paletas |
| `image-guide.md` | Nombres, alt y destinos de archivos |
| `keywords.md` | Keywords y criterio SEO |
| `AGENT.md` | Flujo operativo del agente |
| `image-spec.json` | Reglas estructuradas para imágenes y carruseles |
| `brand/*.json` | Sistema visual v2 importable por sitio |

## Referencias incluidas

Las imágenes de `assets/reference-*.png` son referencias de estilo, no retratos autoritativos. Muestran personas anónimas y composiciones editoriales. El logo se conserva como archivo oficial y no debe redibujarse con IA.

## Documentos de trabajo

`docs/` contiene el perfil y la guía legible para humanos. `source-material/` conserva los archivos originales aportados, incluido el spec visual anterior, para poder auditar qué se ha transformado.

## Pendientes de validación

- Confirmar si el degradado cian–verde–oro debe pasar a ser paleta oficial de Escarlet o seguir limitado a cabeceras editoriales.
- Aportar, si existe, un logo vectorial oscuro para fondos claros. El paquete incluye las dos versiones actuales localizadas.
- Generar seis activos funcionales finales si se necesita un moodboard completo de campaña. Este paquete importa las referencias existentes sin inventar nuevas escenas.

## Regla rápida

Una pieza de Escarlet debe sonar clara y humana, empezar por la experiencia del cliente y convertir complejidad en un siguiente paso concreto. Visualmente debe usar una idea, materia real, luz natural o cálida, espacio negativo y cero texto incrustado en las imágenes generadas.
