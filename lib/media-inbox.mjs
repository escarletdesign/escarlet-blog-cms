import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './db.mjs'

export const IMAGE_DROP_TTL_MS = 20 * 60 * 1000

function inboxDir() {
  const dir = join(dataDir, 'inbox')
  mkdirSync(dir, { recursive: true })
  return dir
}

function inboxPath(token) {
  return join(inboxDir(), `${token}.json`)
}

export function createImageDrop({ site, filename, kind = 'post', alt = '', membershipUserId = '', brandPreparationId = '', generationReceiptId = '', brandAssetType = '', brandRoute = '', itemId = '', requireBrandGrounding = false } = {}) {
  const token = randomBytes(24).toString('hex')
  const meta = {
    token,
    site,
    filename: String(filename || 'imagen.png'),
    kind,
    alt: String(alt || ''),
    membershipUserId: String(membershipUserId || ''),
    brandPreparationId: String(brandPreparationId || ''),
    generationReceiptId: String(generationReceiptId || ''),
    brandAssetType: String(brandAssetType || ''),
    brandRoute: String(brandRoute || ''),
    itemId: String(itemId || ''),
    requireBrandGrounding: Boolean(requireBrandGrounding),
    createdAt: Date.now()
  }
  writeFileSync(inboxPath(token), JSON.stringify(meta))
  return meta
}

export function readImageDrop(token) {
  const id = String(token || '').replace(/[^a-f0-9]/gi, '')
  if (id.length < 16) return null
  const path = inboxPath(id)
  if (!existsSync(path)) return null
  const meta = JSON.parse(readFileSync(path, 'utf8'))
  if (Date.now() - Number(meta.createdAt || 0) > IMAGE_DROP_TTL_MS) {
    unlinkSync(path)
    return null
  }
  return meta
}

export function consumeImageDrop(token) {
  const meta = readImageDrop(token)
  if (!meta) return null
  const path = inboxPath(meta.token)
  if (existsSync(path)) unlinkSync(path)
  return meta
}
