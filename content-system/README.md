# Content system visual v2

Sistema versionado para portadas y carruseles del CMS. La carpeta separa:

- `brand/` identidad fija, variables, arquetipos, templates y referencias.
- `prompts/` prompts componibles para agente y generación visual.
- La política editorial compartida de escritura llega desde `blog_get_brand_context` y no se duplica en cada `AGENT.md`.
- `templates/instagram/` HTML/CSS de las dos retículas aprobadas.
- `schemas/` contratos para brief, slides y social pack.
- `scripts/` auditoría, selección, render y regeneración.
- `examples/` fixture del post «La IA ya diseña bien…».

El runtime usa `lib/visual-system.mjs` para decidir variedad y `lib/instagram-renderer.mjs` para montar el texto final. El generador de imágenes nunca es responsable de la tipografía.

Para otro sitio, conserva scripts y schemas, pero crea sus propios archivos `brand/{site}-*.json` y carga las referencias del sitio mediante MCP.
