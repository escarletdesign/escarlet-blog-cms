import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../apps/pwa/src/i18n.ts', import.meta.url)
const source = readFileSync(file, 'utf8')
const versions = [...source.matchAll(/app\.beta"\s*:\s*"Beta\s+(\d+)\.(\d+)\.(\d+)"/g)]

if (!versions.length) {
  throw new Error('No se encontró app.beta en apps/pwa/src/i18n.ts')
}

const [, major, minor] = versions[0]
const currentPatch = Math.max(...versions.map((match) => Number(match[3])))
const nextVersion = `Beta ${major}.${minor}.${currentPatch + 1}`
const next = source.replace(/(app\.beta"\s*:\s*")Beta\s+\d+\.\d+\.\d+("\s*,)/g, `$1${nextVersion}$2`)

if (next === source) {
  throw new Error('No se pudo actualizar app.beta')
}

writeFileSync(file, next, 'utf8')
console.log(`[version] app beta → ${nextVersion}`)
