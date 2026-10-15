---
name: escarlet-brandkit
description: Identidad Escarlet v3: style board, personajes y logo PNG/SVG para el CMS.
---

# Brandkit Escarlet v3

## Archivos que importan

| Archivo | Uso |
|---------|-----|
| `voice.md` / `keywords.md` | Voz y SEO |
| `AGENT.md` | Contrato operativo del agente |
| `brand-core.json` | Paleta, tipografía, reglas |
| `reference-library.json` | Rutas + tableros + logos |
| `channels/*.json` | Blog, Instagram, LinkedIn, vídeo |
| `assets/style-board.png` | Tablero visual maestro |
| `assets/fondo-escarlet.png` | Fondo de autoridad visual y contexto de generación |
| `assets/character-*.png` / `assets/character-silvia.webp` | Silvia / Charly sueltos |
| `assets/logo-official-blue.png` | Logo PNG (referencia agente) |
| `assets/logo-official-*.svg` | Logo SVG (motor motion / web) |

## Entrega portable para importar

Cuando el kit se construye fuera del CMS, la entrega obligatoria es un ZIP
importable. Usa esta estructura, sin carpetas intermedias ambiguas:

```text
brand-kit.zip
├── voice.md
├── visual-style.md
├── image-guide.md
├── keywords.md
├── AGENT.md
├── brand-core.json
├── image-spec.json
├── visual-system.json
├── image-archetypes.json
├── reference-library.json
├── social-templates.json
└── assets/
    ├── style-board.png
    ├── logo-official-blue.png
    └── ...
```

`reference-library.json` es obligatorio y debe declarar cada imagen incluida
en `assets/` dentro de `references`, con `filename`, `role`, `usage`, `alt` y
`approved: true`. Usa los usos del CMS: `logo`, `reference`, `style_board`,
`character`, `typography`, `palette` o `campaign`. Para una imagen de
storyboard usa `role: "storyboard"` y `usage: "style_board"`. El importador
aplica esos metadatos al asset, por lo que no hay que reclasificar imágenes a
mano después de subir el ZIP.

Ejemplo mínimo:

```json
{
  "site": "shift",
  "references": [
    {
      "id": "shift-storyboard",
      "filename": "shift-storyboard.png",
      "role": "storyboard",
      "usage": "style_board",
      "alt": "Storyboard visual de Shift",
      "approved": true
    },
    {
      "id": "shift-logo",
      "filename": "shift-logo.svg",
      "role": "logo",
      "usage": "logo",
      "alt": "Logo de Shift",
      "approved": true
    }
  ]
}
```

Antes de entregar el ZIP, comprueba que cada `filename` existe y que no hay
dos entradas con el mismo nombre. No entregues un ZIP de imágenes sueltas:
sin `reference-library.json` el CMS no puede conservar el tipo de asset.

## Flujo

1. `workspace.context.get` y `brand.context.get`
2. `brand.visual_style.get`, `brand.rules.get` y `brand.references.resolve` según la pieza
3. Para crear o actualizar el kit, usa `brand.version.create`, sube referencias con `asset.upload` y regístralas con `brand.asset.register`
4. `brand.version.validate`
5. Publica solo tras confirmación humana con `brand.version.publish`
6. Para imágenes de contenido, prepara con `brand.generation.prepare` y conserva su `preparationId`

Antes de generar, comprueba que `brand.context.get` devuelve el mismo
`brandKitSnapshotHash` que las demás respuestas y que `reference-library.json`
está presente. Si falta, está vacío cuando la pieza necesita referencias, o
`generationBlocked` es `true`, detén el flujo y completa el onboarding. No uses
las `referenceImages` como sustituto de la biblioteca canónica.

## Contrato de sincronización

`reference-library.json` es el índice canónico de referencias. Cada nombre
declarado en `references` debe tener un `brand_assets` aprobado en la versión
publicada y un `storageKey` o `publicUrl` existente. Al crear o reparar un kit,
registra primero los assets, valida la versión y publica el mismo snapshot. No
dejes una versión publicada con el archivo en el manifest pero sin sus filas de
`brand_assets`.

Si `selection.routes` existe y no incluye `default`, el backend deriva una ruta
default determinista desde `introspective_or_tense`, `human_or_work` o la
primera ruta declarada. Aun así, el onboarding debe escribir `default` de forma
explícita para que el kit sea portable y auditable.

Para una pieza social existente, conserva los `reference` originales y usa una
preparación vigente con `brand.generation.prepare`. Sube las imágenes finales
como `kind=social`, con `assetType=social_image`, `assetIndex` consecutivo,
`itemId`, `channels` y el texto renderizado. Después verifica que la variante
tenga exactamente la cantidad esperada de medios antes de revisar o publicar.

Si una preparación devuelve `generationBlocked`, `brand_preparation_required`,
`BRAND_GROUNDING_STALE` o `BRAND_VERSION_MISMATCH`, detén la subida, vuelve a
validar el Brand Kit activo y genera una preparación nueva. No uses un snapshot
estático ni conviertas referencias en assets publicables.

No uses `/mcp`, `brand_get_context`, `brand_get_style_board` ni otras
tools legacy. El ZIP es el formato portable de intercambio y respaldo, y debe
incluir siempre el índice `reference-library.json` con la clasificación de sus
imágenes.
