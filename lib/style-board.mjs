import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Jimp from 'jimp'
import { mediaDir } from './db.mjs'

const BOARD_MAX_SIDE = 1200
const TILE_GAP = 16
const BOARD_BG = 0xffffffff

function flattenAlpha(image) {
  if (!image.hasAlpha()) return image
  const bg = new Jimp(image.bitmap.width, image.bitmap.height, BOARD_BG)
  return bg.composite(image, 0, 0)
}

async function loadTile(diskPath) {
  const image = await Jimp.read(diskPath)
  return flattenAlpha(image)
}

/**
 * Builds one grounded style board from discrete brand references.
 * The agent receives this single ImageContent; discrete files stay server-side.
 */
export async function composeStyleBoardBuffer(diskPaths = []) {
  const paths = diskPaths.filter((path) => path && existsSync(path)).slice(0, 4)
  if (!paths.length) throw Object.assign(new Error('No hay referencias para componer el style board.'), { status: 409, code: 'STYLE_BOARD_EMPTY' })
  const tiles = await Promise.all(paths.map((path) => loadTile(path)))
  const columns = tiles.length === 1 ? 1 : 2
  const rows = Math.ceil(tiles.length / columns)
  const cell = Math.floor((BOARD_MAX_SIDE - TILE_GAP * (columns + 1)) / columns)
  const width = TILE_GAP + columns * (cell + TILE_GAP)
  const height = TILE_GAP + rows * (cell + TILE_GAP)
  const board = new Jimp(width, height, BOARD_BG)
  for (let index = 0; index < tiles.length; index += 1) {
    const col = index % columns
    const row = Math.floor(index / columns)
    const tile = tiles[index].clone().cover(cell, cell)
    board.composite(tile, TILE_GAP + col * (cell + TILE_GAP), TILE_GAP + row * (cell + TILE_GAP))
  }
  if (board.bitmap.width > BOARD_MAX_SIDE || board.bitmap.height > BOARD_MAX_SIDE) board.scaleToFit(BOARD_MAX_SIDE, BOARD_MAX_SIDE)
  const buffer = await board.quality(84).getBufferAsync(Jimp.MIME_JPEG)
  return { buffer, mimeType: 'image/jpeg', width: board.bitmap.width, height: board.bitmap.height }
}

export function styleBoardCachePath(site, fingerprint) {
  return join(mediaDir, site, 'style-boards', `${fingerprint}.jpg`)
}

export async function getOrCreateStyleBoard({ site, fingerprint, diskPaths }) {
  const cachePath = styleBoardCachePath(site, fingerprint)
  if (existsSync(cachePath)) {
    const buffer = readFileSync(cachePath)
    return { buffer, mimeType: 'image/jpeg', path: cachePath, cached: true, sha256: createHash('sha256').update(buffer).digest('hex') }
  }
  const composed = await composeStyleBoardBuffer(diskPaths)
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, composed.buffer)
  return {
    buffer: composed.buffer,
    mimeType: composed.mimeType,
    path: cachePath,
    cached: false,
    sha256: createHash('sha256').update(composed.buffer).digest('hex'),
    width: composed.width,
    height: composed.height
  }
}

export function styleBoardFingerprint({ site, brandKitVersionId, brandKitSnapshotHash, route, filenames }) {
  return createHash('sha256')
    .update(JSON.stringify({ site, brandKitVersionId, brandKitSnapshotHash, route, filenames }))
    .digest('hex')
    .slice(0, 32)
}
