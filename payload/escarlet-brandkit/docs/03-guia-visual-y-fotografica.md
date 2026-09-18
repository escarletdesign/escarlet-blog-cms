# Escarlet · Guía visual y fotográfica para el CMS

## Idea visual

Diseño editorial contemporáneo, cálido y táctil. Una idea visual por pieza, materia visible, luz natural o interior cálido y una composición que deja respirar el contenido. La imagen sugiere el argumento sin convertirlo en un icono literal.

## Paleta

### Paleta operativa del CMS

| Color | Hex | Uso |
| --- | --- | --- |
| Turquesa / cian | `#12B8D6` | Flujo cromático y acentos |
| Verde suave | `#62B38A` | Centro del flujo y escenas humanas |
| Crema claro | `#F3E7D0` | Superficies y espacio negativo |
| Amarillo oro | `#E8B73A` | Luz cálida y cierre cromático |
| Gris neutro | `#6D6D6D` | Texto auxiliar |
| Carbón | `#1E1E1E` | Contraste y profundidad |

### Referencia editorial aportada

El fondo canónico usa `#12B8D6`, `#62B38A`, `#E8B73A`, `#F3E7D0`, `#1E1E1E` y `#6D6D6D`, con flujo cian a verde y oro. Conserva siempre las formas orgánicas estratificadas tipo montañas de `fondo-escarlet.jpg`.

## Tipografías y jerarquía

Inter, Arial, sans-serif en el runtime actual. Peso alto para titulares, peso regular para cuerpo y etiquetas cortas. El generador de imágenes nunca dibuja tipografía. El renderer del CMS compone el texto de Instagram desde el template.

## Logo

Usar únicamente los SVG oficiales de `assets/`. No redibujar, deformar ni incrustar el logo en fotografías generadas. Sobre fondos claros usar una versión oscura cuando esté disponible. Sobre fondos oscuros usar `logo-official-white.svg` o `logo-official-blue.svg` según contraste.

## Identidad real

Las personas de las referencias son anónimas y sirven para estilo, no para fijar la identidad de una persona real. Si se incorpora una foto del equipo o de un cliente, esa foto pasa a ser referencia de identidad y debe conservar rostro, proporciones, producto y local.

## Dirección fotográfica

- Personas trabajando, conversando o decidiendo, sin pose corporativa.
- Rostro parcial, perfil, espalda, manos o gesto cuando la privacidad y la idea lo pidan.
- Luz lateral natural. Interior cálido. Sombras suaves.
- Papel, madera, cerámica, tela, pantalla sin texto legible y objetos de oficio.
- Vestuario neutro, negro, carbón o tonos apagados.
- Desorden controlado. Cada objeto debe reforzar el artículo.

## Familias de imagen

1. Editorial abstracta con papel, materia y sombra.
2. Objeto simbólico aislado sobre fondo de papel.
3. Escena humana parcial que muestra criterio o colaboración.
4. Entorno o espacio con huella de uso.
5. Metáfora visual conceptual con un solo gesto.
6. Proceso o mesa de trabajo sin la receta portátil, taza y oficina genérica.
7. Interfaz o producto digital tratado como objeto físico, sin texto legible.

## Composición

Portadas en 3:2. Reservar al menos un 25 % del encuadre sin detalle crítico. Colocar el sujeto en el tercio derecho cuando haya espacio editorial a la izquierda. En Instagram usar el template `editorial` o `impact`, sus safe areas y el renderer del CMS.

## Matriz de activos

| Función | Escena recomendada | Uso |
| --- | --- | --- |
| Identidad | Persona, equipo, producto o símbolo real | Presentación y portada de marca |
| Hero | Transformación sugerida con espacio negativo | Blog y páginas de servicio |
| Método | Manos, herramienta, material o proceso | Artículos prácticos |
| Resultado | Avance en contexto sin garantía | Casos y narrativas |
| Ambiente | Espacio u objetos propios | Separadores y redes |
| Textura | Papel, sombra o abstracción | Fondos del renderer |

## Adaptaciones por canal

- Blog. 3:2, sin texto ni logo en la imagen, 2–3 referencias aprobadas.
- Instagram. Fondo generado sin texto y texto renderizado en 1080×1350.
- Presentaciones. Usar el sistema 2.2.0 y el logo oficial colocado.
- Web. Priorizar contraste, espacio negativo y alt descriptivo.

## Qué evitar

Stock corporativo, oficinas de cristal vacías, sonrisas impostadas, robots, cerebros con circuitos, collages 3D, iconos flotantes, degradados genéricos, texto o logos generados, manos defectuosas y pantallas con palabras inventadas.

## Control de aprobación

- Paleta y contraste coherentes con la ruta determinista resuelta.
- Una sola idea visual y sujeto claro.
- Sin texto, números, logos ni marcas de agua en imágenes generadas.
- Anatomía, manos, perspectiva y producto revisados.
- Referencias aprobadas entregadas al generador.
- Metadata de arquetipo, composición, referencias y decisión guardada en el post.
