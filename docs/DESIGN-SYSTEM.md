# Design system · Escarlet CMS admin

Patrones visuales del panel (`admin.html`, `public/admin.css`, `public/admin.js`).
Inspiración de componentes 21st.dev adaptados a HTML/CSS/JS vanilla (sin React).

## Colores y tipografía

Definidos en `:root` de `admin.css`.

- Fondo. `--bg` `#f4f1eb`
- Superficie. `--surface` `#fff`
- Acento. `--accent` `#2d6a4f`
- Texto. `--text` `#1c1c1a`
- Fuente. DM Sans

## Page shell (Lumina)

Patrón de pantalla. Sustituye la «tarjeta blanca gigante» en paneles de lista y ajustes.

| Clase | Uso |
|-------|-----|
| `.page-shell` | Contenedor del panel (columna con gap) |
| `.page-head` | Título + meta + herramientas |
| `.page-toolbar` | Filtros (status-pills / seg) bajo el head |
| `.page-surface` | Superficie blanca con sombra suave (lista, form, aside) |
| `.surface-title` / `.surface-desc` | Título corto dentro de una surface |
| `.seg` / `.seg-btn` | Control segmentado (vista, columnas) |
| `.status-pills` / `.status-pill` | Filtro por estado (Published / Draft / Scheduled) |
| `.form-reading` | Ancho de lectura para inputs largos (~40rem) |

Layouts de dos columnas en desktop. `.media-layout`, `.brand-layout`, `.site-config-layout`, `.users-layout` (stack en &lt;980px).

Social Pack. `.pack-toolbar` une filtros y controles sobre la parrilla. Las columnas de tarjetas usan `repeat(N, minmax(0, 1fr))` para llenar el ancho.

File drop dentro de `.pico`. No uses `role="button"` en `.file-drop-surface` (Pico lo pinta como botón primario verde). El CSS fuerza fondo claro `#faf8f4`.

## Botones

| Clase | Uso |
|-------|-----|
| `.btn.btn-primary` | Una acción principal por zona |
| `.btn` | Secundaria |
| `.btn.btn-ghost` | Navegación / Descartar |
| `.btn.btn-danger` | Destructiva |

## File drop (subida de archivos)

Patrón canónico. Adaptado de **File Dropzone** (21st.dev / Joyco).

### Cuándo usarlo

Cualquier `<input type="file">` del admin (imágenes, ZIP). No uses el input nativo a solas.

### Markup

```html
<div
  class="file-drop"
  data-file-drop
  data-accept="image/*"
  data-max-mb="12"
  data-kind="image"
>
  <input type="file" id="miArchivo" accept="image/*" class="visually-hidden" />
  <div class="file-drop-surface" tabindex="0" role="button" aria-controls="miArchivo">
    <div class="file-drop-empty">
      <span class="file-drop-icon" aria-hidden="true"><!-- svg --></span>
      <p class="file-drop-title">Suelta el archivo aquí</p>
      <p class="file-drop-hint">JPG, PNG o WebP · máx. 12 MB</p>
      <span class="btn file-drop-browse">Elegir archivo</span>
    </div>
    <div class="file-drop-preview" hidden>
      <img class="file-drop-thumb" alt="" />
      <div class="file-drop-file-icon" hidden aria-hidden="true"></div>
      <div class="file-drop-meta">
        <strong class="file-drop-name"></strong>
        <span class="file-drop-size"></span>
      </div>
      <button type="button" class="file-drop-clear" aria-label="Quitar archivo">×</button>
    </div>
  </div>
  <p class="file-drop-error" hidden role="alert"></p>
</div>
```

### Comportamiento (`initFileDrops` en `admin.js`)

- Drag over / leave / drop con estado `data-dragging`
- Click en la superficie o en «Elegir archivo» abre el diálogo
- Preview de imagen o chip de archivo (ZIP)
- Validación de tamaño (`data-max-mb`) y tipo (`accept`)
- Tras subir con éxito. `clearFileDrop('#miArchivo')`

### Variantes

| Atributo | Valor | Efecto |
|----------|-------|--------|
| `data-kind` | `image` | Preview con miniatura |
| `data-kind` | `file` | Icono de archivo + nombre |
| `data-max-mb` | número | Límite en MB |

### Formulario completo

El drop va arriba. Alt / uso / CTA debajo, sin botón full-bleed ancho de pantalla.

```html
<form class="upload-panel">
  <!-- file-drop -->
  <div class="upload-panel-fields">…alt, uso…</div>
  <div class="actions">
    <button type="submit" class="btn btn-primary">Subir</button>
  </div>
</form>
```

## Formularios y sitios

- Pares de campos (nombre + dominio, email + rol). `.form-grid.form-grid--2`
- Selector de sitios en Sitio. `.site-switcher` + `.site-switcher-item` (botones, no pills)
- Usuarios. `#panel-usuarios` + `.user-table` (solo agency con flag V1)
