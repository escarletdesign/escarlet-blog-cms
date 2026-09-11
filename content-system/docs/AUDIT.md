# Auditoría del flujo anterior

## Hallazgos

- `lib/ai-workflows.mjs` pedía al generador de imágenes que dibujara el texto de las slides. Eso hace que la tipografía, los saltos y la ortografía sean probabilísticos.
- `config/sites/escarlet/image-spec.json` definía color y tamaño, pero no separaba fondo, layout y render final.
- `config/sites/escarlet/AGENT.md` describía la subida de slides, pero no exigía template, metadata de decisión ni consulta de repetición.
- `generateImageOptions` aplicaba las referencias de forma global y no tenía una selección basada en arquetipos o historial.
- El inventario local tiene 23 posts y repite `cuanto-cuesta-pagina-web-almeria-2026.webp` en varias portadas.

## Cambios

1. `content-system/` separa identidad fija, ejes variables, arquetipos, referencias, prompts, schemas y templates.
2. `lib/visual-system.mjs` selecciona arquetipo y referencias usando los últimos posts.
3. `lib/instagram-renderer.mjs` compone texto + fondo en PNG con una fuente declarada.
4. El workflow de slides genera fondos sin texto y renderiza el resultado final después.
5. Los posts guardan `visualBrief` y las slides guardan `templateId`, `backgroundMediaId` y `renderedBy`.
6. Los scripts de análisis y regeneración permiten auditar todo el histórico o un slug concreto.
