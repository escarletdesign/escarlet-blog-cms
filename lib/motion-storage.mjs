import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export function resolveMotionStoragePath(storageKey, root) {
  const mediaRoot = resolve(String(root || ''))
  const raw = String(storageKey || '').trim()
  if (!mediaRoot || !raw) return ''

  const absolute = raw.startsWith('/') && !raw.startsWith('/media/') ? resolve(raw) : ''
  if (absolute) return absolute === mediaRoot || absolute.startsWith(`${mediaRoot}/`) ? absolute : ''

  const clean = raw.replace(/^\/+/, '').replace(/\\/g, '/')
  const relative = clean === 'media' ? '' : clean.startsWith('media/') ? clean.slice('media/'.length) : clean
  if (relative.split('/').includes('..')) return ''
  const candidate = relative ? resolve(join(mediaRoot, relative)) : mediaRoot
  return candidate === mediaRoot || candidate.startsWith(`${mediaRoot}/`) ? candidate : ''
}

export async function assertMotionAssetFile(storageKey, { root, assetId, required = true } = {}) {
  const resolvedPath = resolveMotionStoragePath(storageKey, root)
  if (!resolvedPath) {
    if (!required) return ''
    throw Object.assign(new Error(`Asset ${assetId || 'desconocido'} no tiene un storageKey resoluble.`), { code: 'motion_asset_path_missing', status: 409 })
  }
  let details
  try {
    details = await stat(resolvedPath)
  } catch {
    throw Object.assign(new Error(`Asset ${assetId || 'desconocido'} no está disponible en el almacenamiento local: ${resolvedPath}`), { code: 'motion_asset_unavailable', status: 409 })
  }
  if (!details.isFile()) {
    throw Object.assign(new Error(`Asset ${assetId || 'desconocido'} no resolvió a un archivo: ${resolvedPath}`), { code: 'motion_asset_not_file', status: 409 })
  }
  return resolvedPath
}
