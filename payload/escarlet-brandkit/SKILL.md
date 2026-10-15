---
name: escarlet-brandkit
description: Identidad Escarlet v3: style board, personajes y logo PNG/SVG para el CMS.
---

# Brandkit Escarlet v3

## Archivos que importan

| Archivo | Uso |
|---------|-----|
| `voice.md` / `keywords.md` | Voz y SEO |
| `AGENT.md` | Contrato operativo del agente |
| `brand-core.json` | Paleta, tipografía, reglas |
| `reference-library.json` | Rutas + tableros + logos |
| `channels/*.json` | Blog, Instagram, LinkedIn, vídeo |
| `assets/style-board.png` | Tablero visual maestro |
| `assets/fondo-escarlet.png` | Fondo de autoridad visual y contexto de generación |
| `assets/character-*.png` / `assets/character-silvia.webp` | Silvia / Charly sueltos |
| `assets/logo-official-blue.png` | Logo PNG (referencia agente) |
| `assets/logo-official-*.svg` | Logo SVG (motor motion / web) |

## Flujo

1. `workspace.context.get` y `brand.context.get`
2. `brand.visual_style.get`, `brand.rules.get` y `brand.references.resolve` según la pieza
3. Para crear o actualizar el kit, usa `brand.version.create`, sube referencias con `asset.upload` y regístralas con `brand.asset.register`
4. `brand.version.validate`
5. Publica solo tras confirmación humana con `brand.version.publish`
6. Para imágenes de contenido, prepara con `brand.generation.prepare` y conserva su `preparationId`

Antes de generar, comprueba que `brand.context.get` devuelve el mismo
`brandKitSnapshotHash` que las demás respuestas y que `reference-library.json`
está presente. Si falta, está vacío cuando la pieza necesita referencias, o
`generationBlocked` es `true`, detén el flujo y completa el onboarding. No uses
las `referenceImages` como sustituto de la biblioteca canónica.

No uses `/mcp`, `brand_get_context`, `brand_get_style_board` ni otras
tools legacy. El ZIP solo es staging o respaldo.
