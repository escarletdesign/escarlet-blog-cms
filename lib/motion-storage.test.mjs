import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertMotionAssetFile, resolveMotionStoragePath } from './motion-storage.mjs'

test('resuelve storageKey completo dentro del directorio de media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'escarlet-motion-storage-'))
  try {
    const file = join(root, 'escarlet', 'slide-01.png')
    await mkdir(join(root, 'escarlet'), { recursive: true })
    await writeFile(file, 'png')
    assert.equal(resolveMotionStoragePath('media/escarlet/slide-01.png', root), file)
    assert.equal(resolveMotionStoragePath('/media/escarlet/slide-01.png', root), file)
    assert.equal(await assertMotionAssetFile('media/escarlet/slide-01.png', { root, assetId: 'slide-01' }), file)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rechaza una ruta que resuelve al directorio media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'escarlet-motion-storage-'))
  try {
    await assert.rejects(
      assertMotionAssetFile('media', { root, assetId: 'asset-directory' }),
      (error) => error.code === 'motion_asset_not_file' && error.message.includes(root)
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rechaza traversal y rutas fuera del almacenamiento', async () => {
  const root = await mkdtemp(join(tmpdir(), 'escarlet-motion-storage-'))
  try {
    assert.equal(resolveMotionStoragePath('media/../secret.png', root), '')
    assert.equal(resolveMotionStoragePath('/tmp/secret.png', root), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
