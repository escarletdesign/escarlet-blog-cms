import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  RUNTIME_CHANNEL,
  RUNTIME_FILES,
  getRuntimeManifest,
  getRuntimeFile,
  runtimeFilePath
} from './frontend-runtime.mjs'

test('el manifiesto runtime lista sync y packs con hash real', () => {
  const manifest = getRuntimeManifest()
  assert.equal(manifest.channel, RUNTIME_CHANNEL)
  assert.deepEqual(
    manifest.files.map((f) => f.name),
    RUNTIME_FILES
  )
  for (const file of manifest.files) {
    const disk = runtimeFilePath(file.name)
    assert.ok(disk)
    const buf = readFileSync(disk)
    assert.equal(file.sha256, createHash('sha256').update(buf).digest('hex'))
    assert.equal(file.bytes, buf.length)
  }
  assert.equal(getRuntimeFile('sync-blog-cms.mjs')?.name, 'sync-blog-cms.mjs')
  assert.equal(getRuntimeFile('../secret.mjs'), null)
  assert.equal(getRuntimeFile('README.md'), null)
})
