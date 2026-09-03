#!/usr/bin/env node
/**
 * Alta de un site nuevo en el CMS.
 *
 *   npm run site:init -- --handle mares24 --name "Mares 24" --domain https://mares24.com
 *   npm run site:init -- --handle umbral --domain https://umbral.es --webhook "https://coolify.../deploy?uuid=..."
 *   npm run site:init -- --handle demo --copy-frontend ../mi-proyecto/scripts
 */
import { createSite, copyFrontendTemplates } from '../lib/create-site.mjs'
import { renderOnboardingMarkdown } from '../lib/onboarding.mjs'

function parseArgs(argv) {
  const out = { force: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--handle') out.handle = argv[++i]
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--domain') out.domain = argv[++i]
    else if (a === '--webhook') out.rebuildWebhookUrl = argv[++i]
    else if (a === '--token') out.coolifyApiToken = argv[++i]
    else if (a === '--author') {
      out.authors = out.authors || []
      out.authors.push(argv[++i])
    } else if (a === '--force') out.force = true
    else if (a === '--copy-frontend') out.copyFrontend = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help || !args.handle) {
  console.log(`Uso:
  npm run site:init -- --handle <kebab> --name "Nombre" --domain https://...

Opciones.
  --webhook URL     Deploy webhook Coolify del frontend
  --token TOKEN     API token Coolify (Deploy)
  --author Nombre   Repetible
  --force           Reescribe stubs
  --copy-frontend DIR  Copia templates/frontend a DIR
`)
  process.exit(args.help ? 0 : 1)
}

const result = await createSite(args)
console.log(`✓ Site ${result.site.handle} listo`)
if (result.seedDir) console.log(`  seed: ${result.seedDir}`)
if (args.copyFrontend) {
  const copied = copyFrontendTemplates(args.copyFrontend)
  console.log(`  frontend templates → ${args.copyFrontend} (${copied.length} archivos)`)
}
console.log('')
console.log(renderOnboardingMarkdown(result.playbook))
