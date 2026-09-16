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

const child = spawn('node', ['server.mjs'], { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
