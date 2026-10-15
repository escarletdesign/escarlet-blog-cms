# Escarlet: reglas del agente (v3)

Handle CMS: `escarlet`. Tagline: Ideas humanas que dejan huella.

## Consulta de marca

1. `workspace.context.get` y `brand.context.get`: voz, paleta, catálogo y versión.
2. `brand.visual_style.get` y `brand.references.resolve` para obtener el estilo y las referencias autorizadas.
3. Para construir el kit, crea un draft con `brand.version.create`, sube imágenes con `asset.upload` usando `kind=reference` y enlázalas con `brand.asset.register`.
4. Valida con `brand.version.validate` y publica solo tras confirmación humana con `brand.version.publish`.
5. SVG del logo: asset opcional para el motor motion (`logo-official-white.svg` / `logo-official-blue.svg`), nunca lo redibujes con IA.
6. `fondo-escarlet.png` es el fondo de autoridad visual. Debe acompañar al tablero maestro en cualquier generación de imagen, salvo que una ruta aprobada indique lo contrario.

## Publicar

1. Textos completos → `content.post.create`.
2. Style board → genera fondos **sin texto ni logo**.
3. `asset.upload` + `preparationId`. La imagen final debe llevar el texto integrado cuando corresponda.
4. Enseña la URL devuelta. `ready_for_review` = pendiente de revisión humana.

## Vídeo y motion

1. ChatGPT entrega al motor motion las imágenes, fondos, copy, audio y el SVG aprobado del logo cuando la pieza lo necesite.
2. `production.motion.compose` solo crea el trabajo y registra los roles de cada asset. El motor motion anima esos insumos y devuelve el vídeo para revisión.
3. No generes un logo nuevo ni sustituyas un SVG aprobado por un dibujo creado por IA.

## Prohibido

Elegir referencias sueltas. Asociar `kind=reference` a blog/Instagram. Aprobar o publicar sin confirmación humana. Inventar clientes, cifras o resultados.
