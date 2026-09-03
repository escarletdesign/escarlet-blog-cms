import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDb, writeDb } from './db.mjs'
import { loadSiteConfig, saveSiteConfig, getSitesRoot, listSiteHandles } from './site-config.mjs'
import { writeBrandFile, BRAND_FILES, ensureBrandKit, readBrandFile } from './brand-kit.mjs'
import { getOnboardingPlaybook } from './onboarding.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatesSiteDir = join(root, 'templates', 'site')

const HANDLE_RE = /^[a-z][a-z0-9-]{1,46}[a-z0-9]$/

function siteError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function validateSiteHandle(handle) {
  const h = String(handle || '').trim().toLowerCase()
  if (!HANDLE_RE.test(h)) {
    throw siteError(
      400,
      'Handle inválido. Usa kebab-case corto (ej. mares24, umbral, cliente-x). Letras minúsculas, números y guiones.'
    )
  }
  if (h === 'admin' || h === 'api' || h === 'mcp' || h === 'media') {
    throw siteError(400, `Handle reservado. ${h}`)
  }
  return h
}

function readTemplate(name, fallback) {
  const path = join(templatesSiteDir, name)
  if (existsSync(path)) return readFileSync(path, 'utf8')
  return fallback
}

function renderTemplate(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  )
}

function buildSiteJson({ handle, name, domain, authors, socialPackChannels }) {
  return {
    handle,
    name,
    domain,
    adapter: 'json-api',
    requiresHumanApproval: true,
    seo: {
      minWords: 400,
      metaTitleMin: 20,
      metaTitleMax: 70,
      metaDescriptionMin: 70,
      metaDescriptionMax: 180,
      internalLinksMin: 1,
      internalLinksMax: 8,
      relatedSlugsCount: 0,
      canonicalPattern: '{domain}/blog/{slug}'
    },
    authors: authors?.length ? authors : ['Equipo'],
    copyRules: { noColonsSemicolons: true },
    socialPackChannels: socialPackChannels || {
      substack: true,
      linkedin: true,
      x: true,
      videoScript: true,
      instagramCarousel: true
    }
  }
}

function writeSeedDir(handle, siteJson, brandFiles) {
  const dir = join(getSitesRoot(), handle)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.json'), JSON.stringify(siteJson, null, 2) + '\n')
  for (const [filename, content] of Object.entries(brandFiles)) {
    writeFileSync(join(dir, filename), content)
  }
  return dir
}

function defaultBrandFiles({ handle, name, domain }) {
  const vars = { handle, name, domain }
  const stubs = {}
  for (const file of BRAND_FILES) {
    const fallback =
      file === 'AGENT.md'
        ? `# AGENT.md — ${name}\n\nAntes de escribir llama blog_get_brand_context con site ${handle}.\n`
        : `# ${file.replace('.md', '')} — ${name}\n\nCompleta este archivo con la marca del site.\n`
    stubs[file] = renderTemplate(readTemplate(file, fallback), vars)
  }
  return stubs
}

/**
 * Crea un site nuevo en el CMS central.
 * Persistente en Docker. db + brand kit + site-config runtime.
 * También escribe config/sites/{handle} cuando el filesystem lo permite (local / imagen),
 * salvo que SITE_SEED_DIR o CMS_SKIP_SEED=1 (tests).
 */
export async function createSite(input = {}) {
  const handle = validateSiteHandle(input.handle)
  const name = String(input.name || handle).trim()
  const domain = String(input.domain || `https://${handle}.example`).replace(/\/$/, '')
  const authors = Array.isArray(input.authors)
    ? input.authors.map((a) => String(a).trim()).filter(Boolean)
    : undefined

  const existing = loadSiteConfig(handle)
  const handles = listSiteHandles()
  const db = readDb()
  const inDb = (db.sites || []).some((s) => s.handle === handle || s.id === handle)

  if ((existing || handles.includes(handle) || inDb) && !input.force) {
    throw siteError(409, `Ya existe el site ${handle}. Usa force:true para reescribir brand stubs vacíos / seed.`)
  }

  const siteJson = buildSiteJson({ handle, name, domain, authors })
  const brandFiles = defaultBrandFiles({ handle, name, domain })

  let seedDir = null
  const skipSeed = process.env.CMS_SKIP_SEED === '1' || input.skipSeed
  if (!skipSeed) {
    try {
      seedDir = writeSeedDir(handle, siteJson, brandFiles)
    } catch (err) {
      console.warn(`[create-site] No se pudo escribir config/sites/${handle}: ${err.message}`)
    }
  }

  ensureBrandKit(handle)
  for (const [file, content] of Object.entries(brandFiles)) {
    const current = readBrandFile(handle, file)
    if (!String(current || '').trim() || input.force) writeBrandFile(handle, file, content)
  }

  const runtimePartial = {
    name,
    domain,
    requiresHumanApproval:
      input.requiresHumanApproval === undefined ? true : Boolean(input.requiresHumanApproval)
  }
  if (authors?.length) runtimePartial.authors = authors
  if (input.rebuildWebhookUrl) runtimePartial.rebuildWebhookUrl = String(input.rebuildWebhookUrl).trim()
  if (input.coolifyApiToken) runtimePartial.coolifyApiToken = String(input.coolifyApiToken).trim()
  if (input.socialPackChannels) runtimePartial.socialPackChannels = input.socialPackChannels
  const config = saveSiteConfig(handle, runtimePartial)

  if (!inDb) {
    db.sites = db.sites || []
    db.sites.push({ id: handle, name, handle, domain })
    writeDb(db)
  } else if (input.force) {
    db.sites = (db.sites || []).map((s) =>
      s.handle === handle || s.id === handle ? { ...s, name, handle, domain } : s
    )
    writeDb(db)
  }

  const playbook = getOnboardingPlaybook({ handle, name, domain })

  let agentIcon = null
  const skipFavicon = Boolean(input.skipFavicon) || process.env.CMS_SKIP_FAVICON === '1'
  if (!skipFavicon) {
    try {
      const { prepareSiteAgentIcon } = await import('./favicon.mjs')
      agentIcon = await prepareSiteAgentIcon(handle, domain, { soft: true })
    } catch (err) {
      agentIcon = {
        ok: false,
        message: err.message || 'No se pudo preparar el icono del agente.'
      }
    }
  } else {
    agentIcon = { ok: false, skipped: true, message: 'Icono del agente omitido en este entorno.' }
  }

  return {
    ok: true,
    site: { handle, name, domain },
    config,
    seedDir,
    agentIcon,
    nextSteps: playbook.phases.slice(1).map((p) => ({ id: p.id, title: p.title, steps: p.steps })),
    playbook
  }
}

/**
 * Copia plantillas del frontend al path destino (opcional helper CLI).
 */
export function copyFrontendTemplates(destDir) {
  const src = join(root, 'templates', 'frontend')
  if (!existsSync(src)) throw new Error('Falta templates/frontend')
  mkdirSync(destDir, { recursive: true })
  const copied = []
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(destDir, name)
    copyFileSync(from, to)
    copied.push(to)
  }
  return copied
}
