import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'pwa', 'src')
const primitiveFile = join(root, 'ui', 'index.tsx')
const legacyFiles = new Set([
  join(root, 'App.tsx'),
  join(root, 'ContentBatches.tsx')
])

const violations = []
const legacyFindings = []

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(file)
      continue
    }
    if (!/\.(tsx|ts)$/.test(entry.name) || file === primitiveFile) continue

    const source = await readFile(file, 'utf8')
    const relativeFile = relative(process.cwd(), file)
    const rawControls = source.match(/<(button|input|select|textarea)\b/g) || []
    const literalColors = source.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/gi) || []
    const oldClasses = []
    for (const match of source.matchAll(/className\s*=\s*(?:"([^"]*)"|`([^`]*)`|\{([^}]*)\})/g)) {
      const value = match[1] || match[2] || match[3] || ''
      const tokens = value.match(/(?:^|\s)(?:danger-button|danger-link|empty-state|form-stack|form-actions|settings-card|modal-backdrop|modal-card|modal-head|compact-modal|page-header|icon-button|primary|secondary|ghost|card|page|narrow|muted|eyebrow|error|success|status|empty)(?=\s|$)/g) || []
      oldClasses.push(...tokens.map((token) => token.trim()))
    }

    if (legacyFiles.has(file)) {
      if (rawControls.length || literalColors.length) {
        legacyFindings.push({ relativeFile, rawControls: rawControls.length, literalColors: literalColors.length })
      }
    }

    if (!legacyFiles.has(file) && rawControls.length) violations.push(`${relativeFile}: usa componentes de ./ui en lugar de controles HTML directos (${rawControls.join(', ')})`)
    if (!legacyFiles.has(file) && literalColors.length) violations.push(`${relativeFile}: usa tokens --ui-* en lugar de colores literales (${literalColors.join(', ')})`)
    if (oldClasses.length) violations.push(`${relativeFile}: evita clases legacy (${oldClasses.join(', ')})`)
  }
}

await walk(root)

if (legacyFindings.length) {
  console.log('UI consistency: rutas legacy detectadas, pendientes de migración controlada:')
  for (const finding of legacyFindings) console.log(`  ${finding.relativeFile} controles=${finding.rawControls} colores=${finding.literalColors}`)
}

if (violations.length) {
  console.error('\nUI consistency: se encontraron problemas en archivos nuevos:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exitCode = 1
} else {
  console.log('UI consistency: OK. Los archivos nuevos respetan los componentes y tokens compartidos.')
}
