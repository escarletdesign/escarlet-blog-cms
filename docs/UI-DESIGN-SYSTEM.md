# Sistema de diseño de la PWA

## Propósito

Este documento es el contrato visual y de interacción para la PWA del CMS. Su objetivo es que una pantalla nueva se parezca a las existentes por decisión del sistema, no por imitación manual.

La fuente de verdad del código está en `apps/pwa/src/ui/index.tsx`. La fuente de verdad visual está en `apps/pwa/src/ui/tokens.css` y en las clases `ui-*` de `apps/pwa/src/styles.css`.

## Niveles de composición

### Átomos

- `Button` e `IconButton` para acciones.
- `TextField`, `Textarea`, `Select`, `Checkbox` y `Field` para formularios.
- `Badge`, `StatusBadge` y `ChannelBadge` para estados y canales.
- `Skeleton`, `Progress` y `Toast` para feedback.

### Primitivas de layout

- `Stack` para flujo vertical.
- `Inline` para acciones o elementos en línea.
- `Card` para agrupar contenido con una superficie propia.
- `PageHeader` para el encabezado de una pantalla.

### Patrones de producto

- `ContentPlanCard`, `PublicationCard` y `ConnectionCard` para entidades del CMS.
- `Modal` y `Drawer` para tareas que no deben sacar al usuario del contexto.
- `Tabs` para cambiar de sección sin inventar navegación local.
- `DataTable`, `EmptyState`, `ReviewToolbar` y `BulkActionBar` para operaciones de gestión.

Si una necesidad aparece en más de una pantalla, debe convertirse en un patrón de `src/ui` antes de repetirse.

## Tokens

Los nuevos estilos usan exclusivamente variables `--ui-*`.

- Color: `--ui-bg`, `--ui-surface`, `--ui-surface-raised`, `--ui-text`, `--ui-muted`, `--ui-accent`, `--ui-danger`, `--ui-warning`, `--ui-info`.
- Bordes y foco: `--ui-border`, `--ui-border-strong`, `--ui-focus-ring`.
- Forma: `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg`, `--ui-radius-pill`.
- Ritmo: `--ui-space-1` a `--ui-space-8`.
- Elevación y tipografía: `--ui-shadow`, `--ui-font-sans`.

Los alias antiguos (`--bg`, `--text`, `--accent` y similares) existen solo para mantener rutas legacy durante la migración. No deben usarse en código nuevo.

## Reglas de interacción

- `Button` define `type="button"` por defecto. Usa `type="submit"` solo dentro de un formulario que lo necesite.
- Las acciones con solo icono usan `IconButton` y siempre tienen un `label` accesible.
- Los formularios usan `Field` para etiqueta, ayuda y error. El error debe tener `role="alert"` cuando sea dinámico.
- Los diálogos usan `Modal` o `Drawer`, tienen título accesible y se cierran con Escape.
- Las pestañas usan `Tabs`. Pasa un `ariaLabel` descriptivo cuando haya más de un grupo de pestañas. El panel asociado debe exponer `role="tabpanel"`, `id` y `aria-labelledby` coherentes.
- Los estados de una pantalla son explícitos: carga, vacío, error, éxito y acción siguiente.
- Los estados de contenido usan `StatusBadge`. No se crean colores propios para cada estado.

## Reglas responsive

- La composición debe funcionar desde 320 px.
- `Stack` es la opción por defecto en móvil. `Inline` puede envolver sus elementos.
- Las acciones principales deben seguir siendo alcanzables sin desplazamiento horizontal.
- Las tablas deben usar `DataTable` o un contenedor con desplazamiento horizontal intencional.
- No ocultes información esencial solo para resolver un problema de ancho.

## Reglas para agentes

1. Lee este documento y `AGENTS.md` antes de tocar una pantalla.
2. Importa componentes desde `./ui` o desde el alias local equivalente. No dupliques sus estilos.
3. No escribas controles HTML directos en una pantalla nueva.
4. No copies clases `primary`, `secondary`, `ghost`, `card` o `form-actions` desde rutas legacy.
5. Si falta una variante, modifica el componente compartido y añade una breve nota a este documento.
6. Mantén los textos dentro de `i18n` cuando la pantalla tenga soporte multidioma.
7. Ejecuta `npm run ui:check` y `npm run build`.

## Migración legacy

Las rutas antiguas siguen funcionando y están permitidas temporalmente en `App.tsx` y `ContentBatches.tsx`. La migración se hace por pantalla:

1. Sustituir acciones y formularios por primitivas de `src/ui`.
2. Sustituir colores y medidas por tokens `--ui-*`.
3. Eliminar las clases legacy que ya no tenga ningún consumidor.
4. Añadir el estado vacío, de error y de carga que falte.
5. Verificar teclado, foco y móvil.

El guard `npm run ui:check` bloquea controles directos, colores literales y clases legacy en archivos nuevos. Las dos rutas legacy aparecen como inventario pendiente, no como excepciones silenciosas.
