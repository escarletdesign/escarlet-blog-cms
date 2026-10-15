# Prompt componible para portada de blog

Construye el prompt con estas piezas, en este orden:

```text
Sitio: {site}. Tema: {topic}. Resumen: {summary}.
Intención emocional: {emotionalIntent}.
Arquetipo visual: {archetype.name}. Descripción: {archetype.description}.
Composición: {composition}.
Señales visuales: {archetype.signals}.
Referencias aprobadas: {references}.
Reglas fijas de marca: {brandRules}.
No repetir respecto a los posts recientes: {negativeRules}.
Genera una imagen editorial {aspectRatio}, con materia real y luz natural.
No incluyas texto, letras, números, logos, marcas de agua, UI legible ni tipografía.
```

En modo operativo devuelve una única ruta. `brand_prepare_image_generation` resuelve las referencias y adjuntos exactos de esa ruta. No uses el arquetipo para escoger referencias, no hagas exploración automática y explica la decisión en `visualBrief.decision.reason`.
