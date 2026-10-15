# Content system visual v2

Sistema versionado para portadas y piezas sociales finales del CMS. La carpeta separa:

- `brand/` identidad fija, variables, arquetipos, templates y referencias.
- `prompts/` prompts componibles para agente y generación visual.
- La política editorial compartida de escritura llega desde `blog_get_brand_context` y no se duplica en cada `AGENT.md`.
- `templates/instagram/` retículas históricas usadas por fixtures y migraciones.
- `schemas/` contratos para brief, slides y social pack.
- `scripts/` auditoría, selección y render histórico.
- `examples/` fixture del post «La IA ya diseña bien…».

El runtime actual usa `brand_prepare_image_generation` para fijar formato y referencias. ChatGPT genera las piezas sociales finales con el texto integrado. El CMS valida, almacena y asocia los archivos en modo `passthrough`, sin overlays ni cambios de píxeles. `lib/instagram-renderer.mjs` queda reservado para históricos, fixtures y migraciones.

Para otro sitio, conserva scripts y schemas, pero crea sus propios archivos `brand/{site}-*.json` y carga las referencias del sitio mediante MCP.
