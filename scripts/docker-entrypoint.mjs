/**
 * Arranque en Docker. Prepara volumen CMS_DATA_DIR (/app/data por defecto).
 */
import { mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { seedAllBrandKits } from '../lib/brand-kit.mjs'
import {
  dataDir,
  dbPath,
  mediaDir,
  markPersistent,
  getPersistenceStatus,
  checkDataWritable
} from '../lib/db.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seedPath = join(root, 'data-seed', 'db.json')

mkdirSync(mediaDir, { recursive: true })
mkdirSync(join(dataDir, 'brand'), { recursive: true })
mkdirSync(join(dataDir, 'site-config'), { recursive: true })
mkdirSync(join(dataDir, 'oauth'), { recursive: true })

if (!checkDataWritable()) {
  console.error(`[entrypoint] FATAL: no se puede escribir en ${dataDir}`)
  console.error('[entrypoint] En Coolify → Persistent Storage → Destination Path = /app/data')
  process.exit(1)
}

markPersistent()
seedAllBrandKits()

if (!existsSync(dbPath) && existsSync(seedPath)) {
  copyFileSync(seedPath, dbPath)
  console.log('[entrypoint] db.json inicial copiado desde data-seed/')
}

if (!existsSync(dbPath)) {
  console.log('[entrypoint] db.json se creará vacío al primer arranque del servidor')
}

const status = getPersistenceStatus()
console.log('[entrypoint] persistence', JSON.stringify(status))
if (!status.likelyDockerVolume && process.env.NODE_ENV === 'production') {
  console.warn(
    '[entrypoint] AVISO: dataDir no parece un volumen Docker. Los posts se perderán en el próximo deploy si Coolify no monta Persistent Storage en /app/data'
  )
}

// API y worker comparten imagen, volumen y configuración. Postgres sigue
// siendo un servicio externo (Coolify managed resource), pero no necesitamos
// un segundo contenedor para que los jobs sobrevivan a los reinicios.
const production = process.env.NODE_ENV === 'production'
const workerEnabled = process.env.WORKER_ENABLED !== '0'
if (production && !process.env.DATABASE_URL) {
  console.error('[entrypoint] FATAL: DATABASE_URL es obligatorio en producción para API v2 y worker.')
  process.exit(1)
}

const children = new Map()
let stopping = false
let exitCode = 0
let killTimer = null

function stopChildren(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal)
  }
  killTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) child.kill('SIGKILL')
    }
  }, 15_000)
  killTimer.unref?.()
}

function maybeExit() {
  if (stopping && [...children.values()].every((child) => child.exitCode !== null || child.signalCode)) {
    if (killTimer) clearTimeout(killTimer)
    process.exit(exitCode)
  }
}

function spawnService(name, args) {
  const child = spawn('node', args, { cwd: root, stdio: 'inherit', env: process.env })
  children.set(name, child)
  child.on('error', (error) => {
    console.error(`[entrypoint] ${name} no pudo arrancar: ${error.message}`)
    exitCode = 1
    stopChildren()
  })
  child.on('exit', (code, signal) => {
    if (!stopping) {
      // Cualquier salida inesperada debe reiniciar el contenedor para que
      // Coolify recupere API y/o worker como una unidad.
      exitCode = code && code > 0 ? code : 1
      console.error(`[entrypoint] ${name} terminó (${signal || `code ${code}`}); deteniendo el resto`)
      stopChildren()
    }
    maybeExit()
  })
  return child
}

process.once('SIGTERM', () => stopChildren('SIGTERM'))
process.once('SIGINT', () => stopChildren('SIGINT'))

console.log('[entrypoint] iniciando API en el contenedor')
spawnService('cms', ['server.mjs'])

if (workerEnabled && process.env.DATABASE_URL) {
  console.log('[entrypoint] iniciando worker persistente en el mismo contenedor')
  spawnService('worker', ['worker.mjs'])
} else if (workerEnabled) {
  console.warn('[entrypoint] WORKER_ENABLED=1 pero DATABASE_URL no está configurado; worker omitido')
}
