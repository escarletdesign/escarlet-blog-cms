# Estilo visual de imágenes · Escarlet CMS

## Dirección activa

Fotos de gente real trabajando, conversando o mostrando un oficio. Luz natural o interior cálido. Texturas de papel, madera, cerámica, tela y pantalla sin texto legible. Aspecto editorial, no banco de stock.

El sistema visual v2 del CMS es la fuente operativa para portadas y carruseles. Las imágenes aportadas en septiembre se usan como referencias aprobadas de composición y emoción, no como identidad de personas reales.

## Color operativo

- Base crema y papel. `#F4F1EA` y `#E8E0D3`.
- Verde bosque. `#1F4D3A`.
- Verde profundo. `#15352A`.
- Tinta. `#1B211D`.
- Coral de señal. `#C8674B`.
- Gris auxiliar. `#6C746F`.

## Preset editorial heredado de la carpeta adjunta

El material aportado propone un fondo abstracto texturizado con flujo cian–verde–oro. Sus colores de referencia son `#18B7D6`, `#78A97C`, `#E7B73A`, `#1F1F1F`, `#EFE8D7` y `#6D6D6D`.

Este preset se permite únicamente cuando el brief pide una cabecera de blog conceptual, luminosa o introspectiva. No sustituye la paleta fija del brand core ni debe mezclarse automáticamente con el coral de señal.

## Composición

- Portada horizontal, preferentemente 3:2. El preset heredado puede trabajar en 16:9 cuando el destino lo necesite.
- Sujeto claro, una persona, un objeto de oficio o un detalle de marca.
- Reservar al menos un 25 % del encuadre sin detalle crítico.
- Usar el tercio derecho para el sujeto cuando se necesite espacio editorial a la izquierda.
- Sin watermarks, logos ajenos ni texto incrustado.

## Personas y sujetos

La persona puede aparecer de espaldas, de perfil, con rostro parcial, en silueta o mediante manos y gesto. La emoción debe salir del cuerpo, la luz y la situación, no de una pose de stock.

Para piezas estratégicas o educativas, preferir mesa de trabajo, materiales y huella humana. Para piezas emocionales, usar presencia anónima, pausa, dirección de luz y espacio negativo. Para piezas de negocio o marca, mostrar oficio y decisión sin convertir la escena en oficina corporativa.

## Sistema de variedad del CMS

Elegir un arquetipo de `brand/image-archetypes.json`, inspeccionar las últimas seis piezas y evitar repetir el arquetipo consecutivo. Consultar `reference-library.json` antes de generar cualquier portada, fondo o slide.

## Qué evitar

Manos de plástico, dedos de más, oficinas de cristal vacías, collages de iconos 3D, robots, cerebros con circuitos, gradientes genéricos, tipografía dibujada por IA, mockups de portátil de stock y objetos decorativos sin relación con el tema.

## Reglas del renderer

Las portadas se generan sin texto, letras, números, logos ni UI legible. En Instagram la IA genera solo el fondo. El texto sale del template `editorial` o `impact` y se renderiza a 1080×1350 con safe areas fijas.

## Referencias

Las cuatro imágenes aportadas están en `assets/`. Su papel es orientar materia, luz, encuadre y emoción. No se copian literalmente ni sustituyen una referencia de identidad real.
