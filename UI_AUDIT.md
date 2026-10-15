# Auditoría UI del CMS Escarlet

**Fecha:** 12 de octubre de 2026
**Alcance:** auditoría estática inicial del frontend React/Vite de `apps/pwa`: árbol de rutas, componentes, hojas de estilo, dependencias y patrones de interacción. En esa fase no se implementaron cambios.

## Resumen ejecutivo

El problema principal no es que falte una biblioteca visual. El proyecto ya tiene un sistema propio en `apps/pwa/src/ui`, tokens `--ui-*` y una guía de diseño. La inconsistencia viene de que ese sistema no es todavía la única forma de construir la interfaz: `App.tsx` concentra gran parte del producto, `styles.css` mezcla estilos globales, legacy y nuevos, y conviven rutas y patrones editoriales de distintas generaciones.

La navegación también exige una reorganización. En escritorio hay navegación principal y administración dentro del mismo sidebar; en móvil solo se muestran tres destinos y el resto queda detrás del menú. Además, algunas vistas de administración aparecen como enlaces, tarjetas y pestañas. Esto eleva el costo de encontrar una función y de entender en qué sección se está.

**Recomendación:** conservar React, Vite, React Router y el sistema visual propio en la primera etapa. Rediseñar primero la arquitectura de navegación y el shell, unificar los patrones compartidos y migrar los flujos por secciones. No cambiar contratos del CMS ni incorporar una biblioteca de componentes como solución automática a un problema que es principalmente de arquitectura y consistencia.

El cambio puede mejorar de forma importante la experiencia en desktop y móvil, pero requiere una migración incremental y verificación de los flujos existentes. La propuesta de este documento es para revisar; no se inició la implementación.

### Alcance confirmado para esta beta

No hace falta conservar la UI ni las rutas legacy por compatibilidad. Si un flujo o componente es obsoleto, se puede retirar para reducir duplicación y dejar una arquitectura limpia. La funcionalidad de producto que siga en uso debe continuar operando. El MCP es la excepción explícita: sus contratos y comportamiento actual deben permanecer intactos y verificarse durante cualquier migración del frontend.

## Hallazgos priorizados

| Prioridad | Hallazgo y evidencia | Efecto para las personas | Riesgo de mantenimiento |
|---|---|---|---|
| **P1** | **La jerarquía de navegación cambia según el dispositivo.** `Shell` define navegación principal y de administración en [App.tsx](apps/pwa/src/App.tsx#L929), mientras que móvil toma únicamente `links.slice(0, 3)` y añade el botón de menú en [App.tsx](apps/pwa/src/App.tsx#L948) y [App.tsx](apps/pwa/src/App.tsx#L1036). | Calendario, asistente y administración no tienen el mismo acceso directo en móvil. Para una ruta importante hace falta abrir el menú y comprender su agrupación. El contexto de la sección activa puede perder peso frente a los accesos fijos. | Se mantienen dos modelos mentales y es fácil que una ruta nueva quede fuera de uno de ellos. |
| **P1** | **Rutas nuevas y legacy coexisten.** El router declara flujos de contenido, publicación, previsualización y administración, con feature flags y redirecciones, en [App.tsx](apps/pwa/src/App.tsx#L566). La administración combina enlaces laterales con `AdminTabs` y tarjetas en [App.tsx](apps/pwa/src/App.tsx#L5835). | Funciones relacionadas aparecen bajo distintas etiquetas o niveles; algunos caminos legacy compiten con el flujo vigente. | Mantener rutas antiguas sin necesidad conserva duplicación. Para la beta, consolidar y retirar lo obsoleto después de identificar los flujos activos; conservar solo rutas que sigan teniendo un uso real. |
| **P1** | **`App.tsx` es un módulo monolítico de 8.158 líneas.** Incluye router, shell, componentes de dominio, formularios, calendario, editor y administración. Ejemplos: navegación en [App.tsx](apps/pwa/src/App.tsx#L892), creación en [App.tsx](apps/pwa/src/App.tsx#L1736), editor en [App.tsx](apps/pwa/src/App.tsx#L2045), calendario en [App.tsx](apps/pwa/src/App.tsx#L4988) y administración en [App.tsx](apps/pwa/src/App.tsx#L5828). | Las pantallas son difíciles de localizar y modificar sin entender contexto no relacionado. | Alto acoplamiento entre shell, estado, rutas y vistas; los cambios visuales tienen una superficie de regresión grande. |
| **P1** | **La hoja global acumula sistemas de estilos distintos.** [styles.css](apps/pwa/src/styles.css#L1) importa tokens, pero combina selectores globales, alias legacy y clases `ui-*`. La hoja tiene 1.229 líneas, 53 reglas `@media`, 282 apariciones de colores hexadecimales y 54 de `rgb/rgba`. Hay reglas globales para `nav`, `select`, `label` y otros elementos, además de estilos locales por página. | El mismo control puede verse distinto según dónde se renderice. Los ajustes responsive de una sección pueden afectar otras sin que sea evidente. | Una corrección requiere conocer cascada, especificidad, orden y reglas históricas, no solo el componente afectado. |
| **P1** | **El sistema de diseño existe, pero la adopción es parcial.** `ui/index.tsx` exporta controles, layouts, overlays, estados y tarjetas, mientras que `App.tsx` conserva controles y componentes propios. La guía en [UI-DESIGN-SYSTEM.md](docs/UI-DESIGN-SYSTEM.md#L47) pide reutilizar patrones y estados explícitos. `DataTable` está definido en [ui/index.tsx](apps/pwa/src/ui/index.tsx#L154), pero no aparece usado por otras pantallas en el frontend revisado. | Se repiten variaciones de botones, campos, listas, acciones e iconos. Las tablas no tienen un patrón de producto compartido; las vistas de gestión resuelven cada lista por separado. | Hay dos fuentes de verdad: el contrato documentado y los patrones que efectivamente usa cada pantalla. |
| **P1** | **Los estados de carga, vacío y error no son uniformes.** `RecentContentWork` oculta el bloque tanto si no hay resultados como si falla la carga, en [App.tsx](apps/pwa/src/App.tsx#L1287). `RecentPosts` presenta el texto de “sin publicaciones” también ante un error, en [App.tsx](apps/pwa/src/App.tsx#L1313). | La persona no puede distinguir entre “no hay contenido” y “no se pudo cargar”. En el primer caso también se pierde la explicación y la siguiente acción. | Errores de API quedan disfrazados de datos vacíos y dificultan soporte y diagnóstico. |
| **P2** | **Modales y overlays tienen implementaciones compartidas y propias.** `Modal` y `Drawer` ofrecen foco y cierre con Escape en [ui/index.tsx](apps/pwa/src/ui/index.tsx#L102). `App.tsx` también tiene, entre otros, `LinkModal` y `ConfirmModal` con markup propio, desde [App.tsx](apps/pwa/src/App.tsx#L2148). | Títulos, foco inicial, cierre, ancho y comportamiento móvil pueden variar entre tareas similares. | Corregir accesibilidad o responsive en el componente compartido no corrige las implementaciones duplicadas. |
| **P2** | **Las experiencias de contenido y edición están repartidas entre rutas.** El editor WYSIWYG propio usa `contentEditable` y `document.execCommand` en [App.tsx](apps/pwa/src/App.tsx#L2045). La vista `SocialPack` vive en [App.tsx](apps/pwa/src/App.tsx#L3750) y hay una vista de contenido empaquetado independiente en [ContentPackPreview.tsx](apps/pwa/src/ContentPackPreview.tsx#L108). | Crear, revisar, previsualizar y publicar puede sentirse como flujos diferentes aunque operen sobre el mismo contenido. | La presentación, las acciones y los estados pueden divergir entre rutas. No hay dependencia de editor enriquecido instalada que unifique el patrón. |
| **P2** | **El responsive se construyó por acumulación.** Los puntos de corte incluyen 440, 480, 560, 600, 620, 650, 700, 760, 820, 900 y otros. El sidebar cambia a fijo desde 760 px en [styles.css](apps/pwa/src/styles.css#L12), pero el contenido de páginas conserva ajustes propios, por ejemplo campañas a 900 px en [styles.css](apps/pwa/src/styles.css#L814). | En anchos intermedios el sidebar ocupa 266 px y deja menos espacio útil antes de que algunas composiciones cambien a una columna. Hace falta validar ese rango, no solo un teléfono y un monitor ancho. | Cada módulo añade breakpoints sin una pauta común y el diseño puede degradarse justo en tablets y ventanas estrechas. |
| **P2** | **Iconografía y textos no tienen una convención completa.** No hay paquete de iconos. Hay componentes de SVG propios, como `NavIcon` y `AdminActionIcon`, en [App.tsx](apps/pwa/src/App.tsx#L1160), junto a glifos Unicode. Existe i18n es/en en [i18n.ts](apps/pwa/src/i18n.ts), pero también hay strings visibles escritos directamente en componentes, por ejemplo [App.tsx](apps/pwa/src/App.tsx#L1243). | Acciones similares pueden usar símbolos, etiquetas o tonos distintos; parte de la interfaz no acompaña el idioma seleccionado. | Los iconos y las traducciones no tienen un lugar único de evolución. |
| **P3** | **No hay un patrón de formularios ni listas de datos a nivel de biblioteca externa.** Los formularios usan estado local de React y controles nativos o propios; no aparecen React Hook Form, Formik ni una biblioteca de tablas en las dependencias. | Esto no es necesariamente un defecto funcional, pero deja a cada pantalla decisiones de validación, error, guardado y densidad. | La consistencia depende de que los componentes y la guía interna se adopten de forma disciplinada. |

### Qué ya está bien encaminado

- React 19, React Router, TypeScript, Vite y una PWA están integrados en el stack actual.
- Existe `apps/pwa/src/ui` con botones, campos, estructura, badges, estados, modal, drawer y tabs.
- `tokens.css` define color, espacio, radio y foco mediante variables `--ui-*`.
- Hay una guía de diseño y una ruta `/design-system` para inspeccionar patrones.
- Algunos flujos sí utilizan `Field`, `Button`, `Tabs`, `Modal`, `Drawer`, `EmptyState` y estados de error accesibles; por ejemplo `ContentBatches.tsx`.
- El código revisado contiene pocos estilos inline; la mayoría son valores dinámicos, como progreso, posición o muestras de tokens. No son el problema central.

## Inventario del stack visual

| Categoría | Uso encontrado |
|---|---|
| Framework y renderizado | React y React DOM `^19.3.0`, TypeScript. Punto de entrada en [main.tsx](apps/pwa/src/main.tsx#L1). |
| Navegación | `react-router-dom ^7.18.3`, rutas declaradas en `App.tsx`. |
| Bundler y PWA | Vite `^8.2.2`, `@vitejs/plugin-react` y `vite-plugin-pwa ^1.3.0`. |
| Componentes | No hay Mantine, MUI, Chakra, Ant Design ni Radix/shadcn. La biblioteca visual es propia: [ui/index.tsx](apps/pwa/src/ui/index.tsx). |
| CSS | CSS convencional: [tokens.css](apps/pwa/src/ui/tokens.css) y una hoja global [styles.css](apps/pwa/src/styles.css). No hay Tailwind ni Sass; tampoco se encontraron archivos o imports CSS Modules. |
| Iconos | Componentes SVG propios y símbolos Unicode. No hay dependencia de iconos. |
| Formularios | Controles propios sobre HTML nativo, estado local React y validaciones manuales. Sin React Hook Form o Formik. |
| Tablas | Patrón `DataTable` propio, sin TanStack Table, AG Grid u otra dependencia de tablas. El patrón compartido no se consume actualmente desde otras pantallas. |
| Editor | `contentEditable` propio. No hay Tiptap, Lexical, Quill ni Monaco. |
| i18n | Módulo interno [i18n.ts](apps/pwa/src/i18n.ts) con español e inglés. |
| Procesamiento visual/media | `@resvg/resvg-js` y `jimp` aparecen en dependencias, pero no son librerías de UI. |

Las versiones se tomaron de `package.json` del repositorio, no de una inferencia sobre herramientas instaladas en el equipo.

## Mapa de páginas, layouts y estilos

### Entrada y composición

- `apps/pwa/src/main.tsx`: renderiza `App`, importa estilos globales y registra el service worker.
- `apps/pwa/src/App.tsx`: router, contexto de sesión/marca, shell, guards, navegación y buena parte de las pantallas. Es la unidad principal a dividir.
- `apps/pwa/src/api.ts`: cliente de acceso a los datos del CMS. Debe mantenerse fuera de una migración visual.
- `apps/pwa/src/i18n.ts`: etiquetas y traducciones actuales.

### Rutas principales

El router en `App.tsx:566-612` reúne:

- Inicio: `/`.
- Crear y producción: `/apps`, `/production/food-to-reel`, `/production/reel-from-image`, `/production/menu-to-reel`, `/production/product-to-social`.
- Contenido y publicación: `/plans`, `/plans/:itemId/preview`, `/calendar`, `/publication/publisher`, más rutas legacy como `/posts`, `/manual/:slug?`, `/schedule/:slug`, `/publish/:slug`, `/preview/:slug` y `/social-pack/:slug`.
- Administración: `/admin`, `/brands/*`, `/connections`, `/team`, `/settings`, `/billing` y otras rutas condicionales por permisos o flags.
- Sistema visual: `/design-system`.

Las rutas dependen de roles, capacidades de marca y feature flags. Se deben conservar las reglas de acceso de las funciones vigentes. Como es una beta, las rutas o pantallas legacy sin uso pueden eliminarse en vez de perpetuar redirects; primero se identifica qué flujos reales necesitan seguir accesibles.

### Módulos de pantalla

La mayor parte del producto está todavía dentro de `App.tsx`. Ya hay módulos separados para `ContentBatches.tsx`, `ContentPackPreview.tsx`, `AppsDashboard.tsx`, `Publisher.tsx`, `FoodToReel.tsx`, `ProductToSocial.tsx` y `DesignSystem.tsx`. No hay una organización por páginas y features que refleje todavía las áreas reales del producto.

### Componentes y estilos compartidos

- [ui/index.tsx](apps/pwa/src/ui/index.tsx): controles, primitives de layout, tarjetas de contenido, status badges, modal/drawer, tabs, toast y `DataTable`, todo concentrado en un archivo.
- [tokens.css](apps/pwa/src/ui/tokens.css): paleta oscura actual, acento verde lima, superficies, bordes, radios, espaciado y foco.
- [styles.css](apps/pwa/src/styles.css): reset/globales, compatibilidad legacy y estilos de páginas y componentes. La nueva capa `ui-*` se incorporó sin retirar aún toda la capa anterior.
- [UI-DESIGN-SYSTEM.md](docs/UI-DESIGN-SYSTEM.md): contrato que pide usar componentes, tokens, estados explícitos, tabs accesibles y comprobación responsive. Existe diferencia entre esa meta y la adopción en las pantallas antiguas.

## Evaluación de patrones de interacción

| Área | Estado actual | Dirección recomendada |
|---|---|---|
| Navegación | Sidebar de escritorio y header/nav inferior de móvil. El nav móvil presenta tres destinos; el resto va al menú. Se mezclan destinos de uso frecuente y administración. | Definir una sola arquitectura de información; variar el contenedor por ancho, no la jerarquía. Mantener marca/espacio y sección actual visibles. Agrupar administración y configuración en un destino claro. |
| Listas y tablas | Predominan tarjetas y filas propias. `DataTable` y su wrapper con overflow existen, pero no se usan como patrón común. | Elegir entre lista/tarjeta o tabla según la tarea. Definir búsqueda, filtros, orden, selección y acciones de fila como patrón reutilizable, no forzar una tabla en móvil. |
| Formularios | Controles compartidos conviven con inputs, labels y estados locales implementados por pantalla. No hay gestión de formularios compartida. | Reutilizar `Field` y controles; acordar validación, errores, acciones, confirmación de guardado y prevención de pérdida de datos. No introducir una dependencia hasta demostrar que el patrón propio no alcanza. |
| Modales y drawers | Los componentes compartidos contemplan Escape y foco. También hay overlays propios en `App.tsx`. | Usar una única primitiva; modal para decisiones breves y drawer/pantalla completa en móvil para edición o filtros largos. Verificar apertura/cierre y retorno de foco con teclado. |
| Editores | Editor enriquecido casero basado en `contentEditable` más campos de texto en otros flujos. | Separar responsabilidades de edición, vista previa y publicación; conservar las cargas y guardados actuales. Evaluar librería especializada solo si hay requisitos editoriales que el componente actual no cubre. |
| Loading, vacío, error y éxito | `Skeleton`, `EmptyState`, `Toast`, `Progress` y `StatusBadge` están disponibles; su uso y mensajes no son consistentes. Algunos errores terminan presentándose como vacío. | Aplicar un contrato de estados por pantalla: cargando, error recuperable, vacío con siguiente acción y éxito confirmable. Diferenciar error de ausencia de datos. |
| Responsive | Se adapta mediante muchos breakpoints locales y reglas globales. Tiene consideración de safe area y varias vistas móviles, pero no una escala común de layouts. | Definir pocas bandas funcionales y validar tamaños intermedios. Revisar tablas, filtros, acciones persistentes, overlays, calendario y edición en teléfonos reales. |
| Accesibilidad | Hay labels, regiones y roles ARIA, tab panels y un foco básico compartido. Algunas piezas propias y el shell necesitan QA de teclado, foco, tamaño táctil y lector de pantalla. | No declarar accesibilidad completa solo por tener ARIA. Agregar pruebas manuales de teclado, foco visible, orden, contraste y zoom antes de aceptar cada flujo migrado. |

## Causas técnicas de inconsistencia

1. **La UI no tiene una frontera de propiedad nítida.** El shell y el router viven junto a páginas de producto; las primitivas y patrones de dominio conviven en un único `ui/index.tsx`.
2. **La cascada CSS cubre demasiada superficie.** Selectores genéricos y valores literales afectan controles en todas las páginas. Los tokens nuevos coexisten con alias viejos y estilos no tokenizados.
3. **La adopción de la biblioteca propia no es obligatoria en el código existente.** El documento es claro para pantallas nuevas, pero muchas rutas siguen usando controles y estilos de la generación anterior.
4. **La navegación refleja la historia del producto más que una tarea de usuario.** Rutas de creación, campañas, publicación y administración se fueron agregando con distintos niveles y nombres.
5. **La duplicación tiene impacto de comportamiento, no solo visual.** Overlays, estados de datos, iconografía y presentación de contenido no comparten siempre la misma implementación.
6. **El responsive no tiene puntos de aceptación por flujo.** Hay reglas por componente, pero el contrato requiere validar desde 320 px y el repositorio no evidencia un proceso de QA visual automatizado.

## Comparación de opciones de stack

| Opción | Beneficios | Coste y riesgos | Evaluación |
|---|---|---|---|
| **Mantener stack actual y consolidar `src/ui`** | Menor cambio de dependencias; preserva tokens, marca y CSS actual; permite corregir navegación y layouts directamente. Reutiliza componentes ya instalados. | El equipo sigue siendo responsable de mantener los componentes complejos. La disciplina de adopción y las pruebas visuales pasan a ser importantes. | **Recomendado ahora.** El dolor detectado está en estructura, IA y uso desigual, no en la falta de widgets. |
| **Adoptar shadcn/ui gradualmente** | Los componentes se copian al proyecto y se pueden adaptar; base de componentes accesibles y familiar; flexibilidad de propiedad del código. | La instalación oficial requiere Tailwind CSS, `shadcn`, `class-variance-authority`, `cn`, `lucide-react` y configuración de estilos, según [instalación manual](https://ui.shadcn.com/docs/installation/manual). Se superpondría a `styles.css` y a `src/ui` hasta migrar cada componente. Tailwind no está presente hoy. | **Posible segunda etapa, no primera.** Considerarlo si se decide explícitamente reemplazar la base CSS y mantener los componentes copiados en la casa. No agregarlo en paralelo como otro dialecto permanente. |
| **Adoptar Mantine** | Biblioteca integrada de controles, overlays, hooks y opciones para formularios; instalación oficial para Vite y posibilidad de theme propio. `@mantine/form` puede usarse con o sin los inputs de `@mantine/core`, como indica [la guía de formularios](https://mantine.dev/form/use-form/). | Agrega dependencias y hojas de estilo globales; exige `MantineProvider`, importar estilos y resolver precedencia con el CSS existente, según [getting started](https://mantine.dev/getting-started/) y [guía de estilos](https://mantine.dev/styles/mantine-styles/). Cambia visualmente las pantallas y puede duplicar componentes hasta terminar la migración. | **No recomendada para resolver este rediseño.** Puede ser conveniente si prima velocidad de formularios/widgets estandarizados sobre control fino del look, aceptando una sustitución amplia y planificada. |

En el caso de shadcn/ui, la documentación oficial confirma que sus componentes se copian dentro del repositorio, a diferencia de una dependencia de componentes tradicional: [visión general del proyecto](https://ui.shadcn.com/docs/new). Esa propiedad ayuda a personalizar, pero no elimina la necesidad de definir IA, patrones y tokens.

## Propuesta de estructura de carpetas

La estructura objetivo separa la composición de aplicación, pantallas y features sin mover el API CMS ni los módulos de generación multimedia fuera de sus contratos. La migración puede llegar aquí por etapas, no hace falta hacer un movimiento masivo inicial.

```text
apps/pwa/src/
  app/
    App.tsx
    router.tsx
    providers/
    layouts/
      AppShell.tsx
  pages/
    HomePage/
    ContentPage/
    CalendarPage/
    AppsPage/
    PublisherPage/
    SettingsPage/
    AdminPage/
  features/
    content/
      components/
      hooks/
    publishing/
    editorial-calendar/
    brands/
    connections/
    team/
    media-library/
  ui/
    primitives/
    patterns/
    tokens.css
    index.ts
  styles/
    reset.css
    global.css
    shell.css
    legacy.css
  i18n/
    index.ts
  api.ts
  types.ts
```

Reglas de propiedad propuestas:

- `app/`: rutas, proveedores, guards y shell; no lógica de una pantalla concreta.
- `pages/`: composición a nivel de ruta y coordinación de features.
- `features/`: componentes y estado de una tarea de producto, manteniendo la integración actual con `api.ts`.
- `ui/primitives`: piezas de bajo nivel compartidas; `ui/patterns`: tablas/listas, filtros, estados, encabezados y formularios compuestos.
- `styles/`: aislar globales y compatibilidad; el CSS legacy se retira cuando ya no tenga consumidores.
- Mantener nombres de rutas, parámetros y comportamiento de `api.ts`; no mover lógica de servidor al frontend ni al revés.

## Sistema de diseño y experiencia propuestos

### Arquitectura de información

Para revisar con producto antes de implementar:

- Mantener cuatro destinos de uso frecuente: **Inicio, Contenido, Crear y Calendario**.
- Reunir **Marcas, Conexiones, Equipo, Plan/uso y Configuración** bajo un espacio reconocible de **Administración** o **Más**, según permisos.
- Mostrar la marca activa y la sección actual en el shell. No duplicar administración como accesos, tarjetas y tabs si conducen al mismo destino.
- Eliminar rutas históricas que no formen parte de los flujos de la beta. Mantener rutas y query params de funciones que sí estén en uso, sin agregar una capa de compatibilidad legacy por defecto.

### Responsive y navegación

- **Escritorio amplio:** sidebar estable con grupos de navegación y marca/contexto visibles.
- **Ventana intermedia/tablet:** sidebar colapsable o rail con control explícito, sin reservar ancho fijo cuando el contenido no alcanza.
- **Móvil:** navegación inferior con accesos prioritarios y un destino **Más** que abre navegación completa. Mantener visible el estado activo; los filtros y tareas secundarias se abren en drawer.
- Validar como mínimo 320, 375, 768, 1024 y 1440 px. Estos son escenarios de QA, no un mandato de cinco breakpoints CSS.
- Acciones táctiles con área cómoda, textos sin truncado crítico, sin scroll horizontal accidental y con el safe area respetado.

### Tokens y componentes

- Conservar el verde lima como color de marca, pero reservarlo para acción principal, selección y foco. Usar semántica estable para éxito, aviso, error e información.
- Reducir los colores a tokens semánticos de fondo, superficie, superficie elevada, texto, texto secundario, borde y feedback. Medir contraste en estados reales.
- Mantener la paleta oscura inicialmente para reducir el riesgo de la primera etapa; antes de cambiarla globalmente, comparar un prototipo claro en calendario, editor y tablas/listas.
- Establecer una escala breve de espacio, tipografía, radios y alturas de control; evitar valores aislados en cada pantalla.
- Consolidar `Button`, `IconButton`, `Field`, `TextField`, `Textarea`, `Select`, `Checkbox`, `Modal`, `Drawer`, `Tabs`, `PageHeader`, `StatusBadge` y `EmptyState` antes de añadir nuevas abstracciones.
- Promover a patrones solamente los elementos repetidos: navegación local, filtros, barra de acciones, lista de publicaciones y estados de consulta.

## Plan incremental con riesgo, esfuerzo y beneficio

| Fase | Cambio | Esfuerzo | Riesgo | Beneficio |
|---|---|---:|---:|---|
| **0. Acordar el modelo** | Revisar este informe, confirmar el mapa de navegación y priorizar los flujos de mayor uso. Prototipar shell desktop/móvil antes de reescribir pantallas. | Bajo | Bajo | Evita codificar una IA que no refleje el trabajo real. |
| **1. Shell y navegación** | Separar `AppShell` y router; simplificar menú, subnavegación y estado activo; retirar rutas y elementos legacy que no se usen en la beta. Conservar permisos y flags de las funciones vigentes. | Medio | Medio | Reduce el costo de encontrar contenido, calendario y administración en cualquier dispositivo, además de quitar complejidad sin valor de compatibilidad. |
| **2. Fundaciones visuales** | Normalizar tokens, tipografía, espacios, botones, campos, overlays y breakpoints; aislar globales y empezar a retirar alias solo cuando no tengan consumidores. | Medio | Medio | Corrige diferencias visibles y evita que reglas globales rompan pantallas vecinas. |
| **3. Migrar por tareas** | Migrar primero Inicio/Contenido/Calendario; luego publicación/producción; finalmente marcas, conexiones y equipo. Una sección por vez, con paridad de funcionalidad y permisos; eliminar duplicados legacy al cerrar cada área. | Alto | Medio/alto | Permite resolver problemas reales y verificar cada grupo sin un big bang, sin arrastrar interfaces que la beta ya no necesita. |
| **4. Unificar patrones de interacción** | Adoptar overlays y tabs compartidos; definir estados de carga/vacío/error/éxito; revisar formularios, listas y experiencia de edición. | Medio/alto | Medio | Menos sorpresas y menos componentes que evolucionan distinto. |
| **5. QA y retiro legacy** | Validación desktop/móvil, teclado, lector de pantalla básico, i18n y estados de datos; eliminar clases y componentes antiguos ya sin uso. | Medio | Bajo/medio | Evita dejar dos sistemas activos indefinidamente y detecta regresiones antes de cerrar cada fase. |

### Límites de seguridad y compatibilidad

La reestructuración debe permanecer en la capa de presentación de `apps/pwa/src`. Para no afectar servicios existentes:

- No modificar contratos ni payloads de `api.ts` o del CMS.
- No modificar autenticación, sesión, autorización, capacidades ni evaluación de roles; el shell nuevo debe consumir el mismo estado.
- **MCP: no cambiar contratos, herramientas, recursos, autenticación ni comportamiento actual.** Mantener las mismas capacidades y validar antes/después con las pruebas MCP existentes y un smoke test de conexión, listado e invocación.
- No cambiar servidor, jobs, `worker.mjs` ni colas.
- No alterar generación multimedia, almacenamiento de assets ni publicación. Cambiar solo cómo se accede y presenta cada flujo.
- Mantener paths y query params de las funciones activas. Las rutas legacy sin uso pueden eliminarse, no requieren redirects de compatibilidad en esta beta.
- Revisar especialmente formularios con edición, borrado, agendado y publicación para no perder validaciones ni confirmaciones durante una extracción.

## Decisión propuesta

**Conservar el stack actual y reestructurar de forma incremental, con limpieza de legacy.** La primera entrega de implementación debería limitarse a un prototipo navegable del shell y a separar router/layout, sin cambiar llamadas al CMS ni el MCP. Una vez validado el mapa desktop/móvil, migrar el resto por flujo y eliminar las rutas duplicadas que ya no formen parte de la beta.

No sugiero instalar shadcn/ui y Mantine para compararlos dentro de la misma PWA: serían dos fuentes de componentes y estilos adicionales. Si después de consolidar `src/ui` sigue faltando velocidad o soporte para componentes avanzados, elegir una sola opción y migrar explícitamente, no combinar ambas.

## Alcance de la revisión

La auditoría inicial revisó código, dependencias, guía de diseño y estructura de rutas sin modificar código. No se ejecutaron pruebas visuales manuales en navegador, dispositivos, zoom ni lector de pantalla. Tampoco se midieron contrastes con una herramienta automatizada. Las conclusiones de usabilidad son hipótesis técnicas basadas en la estructura del frontend y requieren validación con recorridos reales de usuarios antes de cerrar el rediseño.

El workspace ya tenía modificaciones locales en `App.tsx`, `ContentPackPreview.tsx`, `styles.css`, `server.mjs` y `worker.mjs` al crear este informe. Se conservaron intactas durante la auditoría; los cambios posteriores están descritos arriba.

## Estado después de revisar el informe

Se implementó una primera fase acotada, sin tocar `api.ts`, autenticación, endpoints, servidor, worker, contratos ni fuentes MCP:

- Se movió el shell de navegación a `apps/pwa/src/app/layouts/AppShell.tsx` y el historial conversacional a `apps/pwa/src/features/chat/SidebarConversations.tsx`.
- La navegación móvil prioriza Inicio, Contenido, Crear y Calendario, y ofrece el resto bajo “Más”. El menú conserva el contexto activo de administración, marca y ruta; cierra con Escape, selección, backdrop o al pasar a escritorio, y devuelve el foco.
- Entre 760 y 1023 px se usa el mismo drawer móvil/tablet en vez de reservar permanentemente 266 px al sidebar. La barra inferior se adapta al número de destinos disponibles y respeta el safe area.
- Inicio distingue carga, error con reintento y ausencia de publicaciones/contenido. Se agregaron las traducciones necesarias en español e inglés.

### Verificación de esta fase

- `npm run ui:check`: aprobado.
- `npm run build`: aprobado. Vite aún informa que el bundle principal supera 500 kB, un asunto existente de división de código, no un fallo de compilación.
- `npm test` con `CMS_DATA_DIR` temporal: 61 pruebas aprobadas, incluidas las pruebas MCP. El directorio de datos habitual tenía estado persistido que hizo fallar una prueba de generación antes de aislarlo; no se modificó ese estado.
- `npx tsc --noEmit -p apps/pwa/tsconfig.json`: reporta errores de tipos en otras secciones de `App.tsx`, calendario, administración de equipo, `AppsDashboard`, `ContentBatches` y `FoodToReel`. El build actual no ejecuta ese typecheck. No se detectaron errores en `AppShell` ni `SidebarConversations`.
- No se hizo una validación visual autenticada en navegador. El intento local anterior llegó a login porque el proxy del backend respondía con conexión rechazada.

### Pendiente para completar la reestructuración

Al cierre de la primera fase, `App.tsx` todavía reunía editor, calendario, administración y otros flujos. El calendario canónico se extrajo en el corte posterior descrito al final de este informe. Las rutas legacy del editor, previsualización y Social Pack siguen conservándose porque tienen llamadas internas activas; no se agregó compatibilidad nueva.

El siguiente corte recomendado es migrar Contenido y Calendario a componentes de tarea compartidos, verificar sus acciones en escritorio/tablet/móvil y retirar los caminos duplicados que queden sin consumidores. La capa MCP debe seguir ejecutándose contra la misma suite de 61 pruebas durante cada corte.

### Actualización de implementación

Se aplicaron también estos cambios en el frontend:

- Los contextos de sesión, marca, idioma y notificaciones ahora viven en `apps/pwa/src/app/context.tsx`, fuera del router monolítico.
- Las vistas de Contenido, Crear, producción, Publisher y el sistema visual se cargan bajo demanda. El JavaScript principal pasó de 740 kB a 625 kB minificado. Vite todavía advierte que supera 500 kB.
- La navegación de escritorio y móvil comparte el estado de rutas activas. Administración aparece como una sola entrada para administradores; las áreas de marcas, equipo, conexiones y uso se abren desde una portada común, sin duplicarlas en pestañas y menú. Los accesos de miembros no administradores siguen visibles.
- Se eliminaron los redirects sin llamadas internas a `/review` y `/batches`; el fallback de rutas ya conduce a Contenido. Se mantuvieron las rutas de edición, publicación, previsualización y Social Pack que sí tienen llamadas desde la interfaz.
- El drawer cerrado es inerte para teclado y tecnologías de asistencia. Se añadió un enlace de salto al contenido y scroll propio para menús altos en móvil y escritorio.
- Se corrigieron errores existentes de TypeScript en los tipos de calendario, roles, catálogo de Crear, biblioteca de contenido y producción de Reel.

### Verificación tras la actualización

- `npm run ui:check`: aprobado.
- `npm run build`: aprobado, con aviso de bundle principal por encima de 500 kB.
- `npx tsc --noEmit -p apps/pwa/tsconfig.json`: aprobado.
- `npm test` en un `CMS_DATA_DIR` temporal: 61/61 pruebas aprobadas, incluidas las de MCP.
- Esa fase no modificó contratos CMS, autenticación, API, servidor, worker ni implementación MCP. No se pudo completar una prueba visual autenticada porque el backend local no estaba disponible.

### Trabajo estructural pendiente

`App.tsx` todavía contiene el editor, Home y varias pantallas de administración. El componente `Calendar` que se usa dentro de Posts también permanece ahí; la ruta canónica de calendario ya vive fuera del módulo. Las rutas activas legacy se conservan mientras tengan llamadas internas. La inspección visual autenticada y el recorrido con lector de pantalla siguen pendientes. El MCP conserva sus contratos y pasó la suite automatizada, pero no se hizo una conexión real desde una aplicación cliente.

### Corte del calendario editorial

- La ruta `/calendar` ahora carga de forma diferida `apps/pwa/src/features/calendar/EditorialCalendar.tsx`. Sus filtros, vistas de lista y mes, detalle por canal, estados de carga/error/vacío y acciones de reintento/reagendado se trasladaron sin cambiar su comportamiento.
- La lógica de presentación multimedia específica del calendario también quedó en el feature. Se conservaron las llamadas existentes a `calendarV2`, `contentBatches`, `rescheduleContent` y `markChannelPublished`; `api.ts`, los contratos CMS y MCP no cambiaron.
- El componente `Calendar` incrustado en Posts sigue en `App.tsx` porque esa pantalla todavía lo consume.
- Verificación inicial del corte: `npm run ui:check`, `npx tsc --noEmit -p apps/pwa/tsconfig.json`, `npm run build` y 61/61 pruebas con `CMS_DATA_DIR` temporal pasaron. El chunk inicial se dividió después, como se registra en las correcciones de revisión.
- No se pudo hacer validación visual autenticada, móvil ni con lector de pantalla en esta sesión. El cambio preserva la interfaz y los flujos existentes, pero requiere ese recorrido manual antes de cerrar la migración de calendario.

### Correcciones de revisión Thermos

- El feed público del Blog solo incorpora variantes sociales publicadas. Las imágenes se proyectan con URL pública, dimensiones y vistas previas; `publicPost` elimina rutas internas y metadatos privados del `socialPack`.
- El worker conserva primero los medios de la variante Story y completa desde el carrusel de Instagram solo con assets aprobados, programados, en sincronización o publicados. El merge elimina URLs duplicadas y respeta el máximo de 20 imágenes de Buffer.
- `calendarV2` y el calendario tienen tipos explícitos de respuesta. El espacio de tablet usa tokens compartidos.
- Rolldown separa las dependencias en un chunk reutilizable: el entry queda en 348 kB y vendor en 265 kB, sin superar el límite de 500 kB por chunk.
- Verificación tras estas correcciones: `npm run ui:check`, `npx tsc --noEmit -p apps/pwa/tsconfig.json`, `npm run build` y 66/66 pruebas de `npm test` pasan con `CMS_DATA_DIR` temporal.
- No cambiaron rutas ni contratos del CMS, autenticación o MCP. `api.ts` solo recibió tipos de TypeScript. La comprobación visual autenticada y con lector de pantalla sigue pendiente.
