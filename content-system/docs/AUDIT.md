# Auditoría del flujo visual

## Hallazgos

- Había dos rutas para social: una generaba fondos y el CMS añadía overlays, mientras otra generaba Stories finales con texto en ChatGPT.
- `config/sites/escarlet/image-spec.json` mezclaba contrato de fondo con contrato de pieza final y dejaba ambiguo el origen del texto.
- `config/sites/escarlet/AGENT.md` permitía subir fondos sociales sin exigir metadata de texto ni una estructura canónica para Stories.
- El flujo histórico de generación del CMS no formaba parte del contrato MCP y queda retirado en la beta.
- El inventario local tiene 23 posts y repite `cuanto-cuesta-pagina-web-almeria-2026.webp` en varias portadas.

## Cambios

1. `content-system/` separa identidad fija, ejes variables, arquetipos, referencias, prompts y schemas.
2. `lib/visual-system.mjs` selecciona arquetipo y referencias usando los últimos posts.
3. ChatGPT genera la imagen social final con texto integrado en 1080×1350 o 1080×1920.
4. `content_upload_media` usa `passthrough`. El CMS valida dimensiones, metadata, hash y referencias sin añadir overlays.
5. Cada asset social guarda `textRendered`, `textContent`, `templateId` y `renderedBy: "chatgpt-image-generation"`.
6. Las Stories nuevas usan `socialPack.instagramStory.frames[]`; los campos anteriores solo se auditan como histórico.
7. `lib/instagram-renderer.mjs` y sus templates quedan para históricos, fixtures y migraciones.
8. Los scripts de análisis permiten auditar todo el histórico o un slug concreto sin regenerarlo automáticamente.
