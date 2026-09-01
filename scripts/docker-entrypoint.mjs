/**
 * Arranque en Docker. Crea data/ si el volumen está vacío.
 */
import { mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { seedAllBrandKits } from '../lib/brand-kit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data')
const dbPath = join(dataDir, 'db.json')
const seedPath = join(root, 'data-seed', 'db.json')

mkdirSync(join(dataDir, 'media'), { recursive: true })
seedAllBrandKits()

if (!existsSync(dbPath) && existsSync(seedPath)) {
  copyFileSync(seedPath, dbPath)
  console.log('[entrypoint] db.json inicial copiado desde data-seed/')
}

if (!existsSync(dbPath)) {
  console.log('[entrypoint] db.json se creará vacío al primer arranque del servidor')
}

const child = spawn('node', ['server.mjs'], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
