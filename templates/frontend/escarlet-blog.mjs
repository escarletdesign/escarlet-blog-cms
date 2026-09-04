#!/usr/bin/env node
/**
 * Hook estable de cada landing. Casi no cambia.
 * En cada build baja sync y packs desde el CMS y los ejecuta.
 *
 *   node scripts/escarlet-blog.mjs
 *   node scripts/escarlet-blog.mjs sync
 *   node scripts/escarlet-blog.mjs packs
 *
 * Env.
 *   BLOG_CMS_URL             https://blog-cms.escarlet.cc
 *   BLOG_CMS_SITE            handle
 *   BLOG_SITE_URL            https://dominio.com
 *   BLOG_RUNTIME_CHANNEL     v1
 *   BLOG_ENABLED             false fuerza apagado local. El interruptor del CMS manda en producción.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const landingRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = join(landingRoot, '.escarlet-blog-runtime')
const DEFAULT_CMS = 'https://blog-cms.escarlet.cc'

function loadLocalEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = join(landingRoot, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

function cmsUrl() {
  return String(process.env.BLOG_CMS_URL || DEFAULT_CMS).replace(/\/$/, '')
}

function channel() {
  return String(process.env.BLOG_RUNTIME_CHANNEL || 'v1').trim() || 'v1'
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { Accept: '*/*' },
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function allowedRuntimeName(name) {
  return /^[a-z0-9][a-z0-9._-]*\.mjs$/i.test(String(name || ''))
}

export async function refreshRuntime() {
  const base = `${cmsUrl()}/runtime/${channel()}`
  const manifest = JSON.parse((await fetchBuffer(`${base}/manifest.json`)).toString('utf8'))
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('El manifiesto del runtime no lista archivos')
  }
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(join(runtimeDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const file of manifest.files) {
    if (!allowedRuntimeName(file.name)) {
      throw new Error(`Archivo runtime no permitido (${file.name})`)
    }
    const buf = await fetchBuffer(`${base}/${file.name}`)
    const hash = sha256(buf)
    if (file.sha256 && hash !== file.sha256) {
      throw new Error(`Hash distinto en ${file.name}`)
    }
    writeFileSync(join(runtimeDir, file.name), buf)
  }
  console.log(
    `[escarlet-blog] runtime ${manifest.channel || channel()} ${manifest.version || ''} → ${runtimeDir}`
  )
  return manifest
}

function runNode(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: landingRoot,
    env: process.env
  })
  const status = result.status ?? 1
  if (status !== 0) process.exit(status)
}

export async function runCli(argv = process.argv.slice(2)) {
  loadLocalEnv()
  const cmd = String(argv[0] || 'all').trim() || 'all'
  if (!['sync', 'packs', 'pages', 'all'].includes(cmd)) {
    console.error('Uso. node scripts/escarlet-blog.mjs [sync|packs|pages|all]')
    process.exit(1)
  }
  if (cmd !== 'pages') await refreshRuntime()
  if (cmd === 'sync' || cmd === 'all') {
    runNode(join(runtimeDir, 'sync-blog-cms.mjs'))
  }
  if (cmd === 'packs' || cmd === 'all') {
    runNode(join(runtimeDir, 'generate-blog-social-packs.mjs'))
  }
  if (cmd === 'pages') {
    const pages = join(landingRoot, 'scripts', 'generate-blog-pages.mjs')
    if (existsSync(pages)) runNode(pages)
    else {
      console.error('[escarlet-blog] Esta landing no tiene scripts/generate-blog-pages.mjs')
      process.exit(1)
    }
  }
}

const isMain =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  runCli().catch((error) => {
    console.error(`[escarlet-blog] ${error.message}`)
    process.exit(1)
  })
}
