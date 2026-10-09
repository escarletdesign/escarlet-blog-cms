---
name: escarlet-brandkit
description: Identidad Escarlet v3 — style board, personajes y logo PNG/SVG para el CMS.
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
| `assets/character-board.png` | Tablero de personajes |
| `assets/character-*.png` / `assets/character-silvia.webp` | Silvia / Charly sueltos |
| `assets/logo-official-blue.png` | Logo PNG (referencia agente) |
| `assets/logo-official-*.svg` | Logo SVG (motor motion / web) |

## Flujo

1. `brand_get_context`
2. `brand_get_style_board` (`board=style` | `background` | `character` | `logo`)
3. Generar. Publicar solo si el usuario lo pide, con `preparationId`.
