/**
 * Runtime frontend servido por el CMS.
 * Las landings bajan estos archivos en cada build (scripts/escarlet-blog.mjs).
 * Canal v1. Un cambio incompatible abre /runtime/v2/.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = join(root, 'templates', 'frontend')

export const RUNTIME_CHANNEL = 'v1'
/** v1.2.0: Social Pack host moves to CMS; pack generator retired from runtime channel. */
export const RUNTIME_VERSION = '1.2.0'

/** Sync only. Pack HTML/payloads live in CMS (see lib/social-pack-host.mjs). */
export const RUNTIME_FILES = ['sync-blog-cms.mjs']

/** Legacy Vite pack generator kept on disk for dual-run landings; not served via /runtime. */
export const LEGACY_RUNTIME_FILES = ['generate-blog-social-packs.mjs']

const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.mjs$/i

export function runtimeFilePath(name) {
  const base = String(name || '').trim()
  if (!FILE_RE.test(base) || !RUNTIME_FILES.includes(base)) return null
  const disk = join(templatesDir, base)
  if (!existsSync(disk)) return null
  return disk
}

export function fileSha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function getRuntimeManifest() {
  const files = RUNTIME_FILES.map((name) => {
    const disk = runtimeFilePath(name)
    if (!disk) throw new Error(`Falta plantilla runtime ${name}`)
    const buf = readFileSync(disk)
    return {
      name,
      bytes: buf.length,
      sha256: fileSha256(buf)
    }
  })
  return {
    channel: RUNTIME_CHANNEL,
    version: RUNTIME_VERSION,
    files,
    note:
      'Baja estos archivos con scripts/escarlet-blog.mjs. Social Pack se sirve desde el CMS. El look de /blog sigue en cada landing.'
  }
}

export function getRuntimeFile(name) {
  const disk = runtimeFilePath(name)
  if (!disk) return null
  return {
    name,
    path: disk,
    body: readFileSync(disk),
    contentType: 'text/javascript; charset=utf-8'
  }
}
