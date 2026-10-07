import { basename } from 'node:path'

export const ESCARLET_BRAND_ASSET_NAMES = Object.freeze([
  'style-board.png',
  'character-board.png',
  'character-silvia.png',
  'character-charly.png',
  'logo-official-blue.png'
])

const ESCARLET_BRAND_ASSET_SET = new Set(ESCARLET_BRAND_ASSET_NAMES)

export function assetFilename(value) {
  return basename(String(value || '').replace(/\\/g, '/'))
}

export function isApprovedBrandAsset(site, value) {
  if (String(site || '').trim().toLowerCase() !== 'escarlet') return true
  return ESCARLET_BRAND_ASSET_SET.has(assetFilename(value))
}
