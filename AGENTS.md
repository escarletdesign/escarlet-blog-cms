# Contrato de UI para agentes

Estas reglas aplican a cualquier cambio de interfaz dentro de `apps/pwa`.

## Fuente de verdad

- Los componentes compartidos viven en `apps/pwa/src/ui/index.tsx`.
- Los tokens de producto viven en `apps/pwa/src/ui/tokens.css` y usan el prefijo `--ui-`.
- La guía completa está en `docs/UI-DESIGN-SYSTEM.md`.
- `apps/pwa/src/App.tsx` y `apps/pwa/src/ContentBatches.tsx` contienen flujos históricos. Sus clases genéricas ya están migradas a `ui-*`; no copies markup propio ni estilos no tokenizados a pantallas nuevas.

## Reglas de implementación

1. Usa `Button`, `IconButton`, `Field`, `TextField`, `Textarea`, `Select`, `Checkbox`, `Card`, `Stack`, `Inline`, `PageHeader`, `Badge` y `StatusBadge` antes de crear markup propio.
2. No añadas colores, sombras, radios o espaciados literales en un componente nuevo. Usa `--ui-*` desde CSS.
3. No uses las clases legacy `primary`, `secondary`, `ghost`, `card` o `form-actions` en archivos nuevos.
4. Cada pantalla debe cubrir estados de carga, vacío, error y éxito cuando el flujo los necesite.
5. Los textos visibles pasan por `i18n` cuando la pantalla ya tenga traducciones.
6. Los diálogos deben usar `Modal` o `Drawer`. Las pestañas deben usar `Tabs` y un panel con `aria-labelledby` y `aria-controls` coherentes.
7. Comprueba teclado, foco visible, contraste y comportamiento móvil antes de cerrar el cambio.
8. Ejecuta `npm run ui:check` y `npm run build` antes de entregar.

Si una nueva necesidad no cabe en los componentes existentes, añade primero una variante reusable en `src/ui` y documenta su uso. No resuelvas una necesidad compartida con CSS local de una sola pantalla.
