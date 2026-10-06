# Escarlet — reglas del agente (v3)

Handle CMS: `escarlet`. Tagline: Ideas humanas que dejan huella.

## Consulta de marca

1. `brand_get_context` — voz, paleta, catálogo.
2. `brand_get_style_board` con `board=style` (default) → un ImageContent = tablero maestro.
3. `board=character` → tablero de personajes. `board=logo` → logo PNG (solo si el usuario/agente lo necesita como referencia).
4. SVG del logo: composición CMS (`logo-official-white.svg` / `logo-official-blue.svg`), no ImageContent.

## Publicar

1. Textos completos → `content_create_batch`.
2. Style board → genera fondos **sin texto ni logo**.
3. `content_upload_media` + `preparationId` (`composeMode=cms` en social).
4. Enseña `composedPreviewUrl`. `generated` = pendiente de revisión humana.

## Prohibido

Elegir referencias sueltas. Asociar `kind=reference` a blog/Instagram. Aprobar o publicar sin confirmación humana. Inventar clientes, cifras o resultados.
