# Escarlet — reglas del agente (v3)

Handle CMS: `escarlet`. Tagline: Ideas humanas que dejan huella.

## Consulta de marca

1. `brand_get_context` — voz, paleta, catálogo.
2. `brand_get_style_board` con `board=style` (default) → un ImageContent = tablero maestro.
3. `board=background` → fondo oficial de Escarlet. `board=character` → tablero de personajes. `board=logo` → logo PNG (solo si el usuario/agente lo necesita como referencia).
4. SVG del logo: asset opcional para el motor motion (`logo-official-white.svg` / `logo-official-blue.svg`), nunca lo redibujes con IA.
5. `fondo-escarlet.png` es el fondo de autoridad visual. Debe acompañar al tablero maestro en cualquier generación de imagen, salvo que una ruta aprobada indique lo contrario.

## Publicar

1. Textos completos → `content_create_batch`.
2. Style board → genera fondos **sin texto ni logo**.
3. `content_upload_media` + `preparationId` (`composeMode=cms` en social).
4. Enseña `composedPreviewUrl`. `generated` = pendiente de revisión humana.

## Vídeo y motion

1. ChatGPT entrega al motor motion las imágenes, fondos, copy, audio y el SVG aprobado del logo cuando la pieza lo necesite.
2. `production.motion.compose` solo crea el trabajo y registra los roles de cada asset. El motor motion anima esos insumos y devuelve el vídeo para revisión.
3. No generes un logo nuevo ni sustituyas un SVG aprobado por un dibujo creado por IA.

## Prohibido

Elegir referencias sueltas. Asociar `kind=reference` a blog/Instagram. Aprobar o publicar sin confirmación humana. Inventar clientes, cifras o resultados.
