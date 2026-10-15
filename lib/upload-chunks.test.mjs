import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectUploadChunk, resetUploadSessions } from './upload-chunks.mjs'

test('collectUploadChunk ensambla trozos en orden', () => {
  resetUploadSessions()
  const first = collectUploadChunk({
    uploadId: 'u1',
    chunkIndex: 0,
    chunkCount: 3,
    contentBase64: 'aaa',
    filename: 'a.png'
  })
  assert.equal(first.complete, false)
  assert.equal(first.nextChunkIndex, 1)

  const second = collectUploadChunk({
    uploadId: 'u1',
    chunkIndex: 2,
    chunkCount: 3,
    contentBase64: 'ccc'
  })
  assert.equal(second.complete, false)
  assert.equal(second.nextChunkIndex, 1)

  const last = collectUploadChunk({
    uploadId: 'u1',
    chunkIndex: 1,
    chunkCount: 3,
    contentBase64: 'bbb'
  })
  assert.equal(last.complete, true)
  assert.equal(last.contentBase64, 'aaabbbccc')
  assert.equal(last.filename, 'a.png')

  const retried = collectUploadChunk({
    uploadId: 'u1',
    chunkIndex: 1,
    chunkCount: 3,
    contentBase64: 'bbb'
  })
  assert.equal(retried.complete, true)
  assert.equal(retried.contentBase64, 'aaabbbccc')
})

test('collectUploadChunk rejects metadata drift and conflicting retries', () => {
  resetUploadSessions()
  collectUploadChunk({ uploadId: 'u2', chunkIndex: 0, chunkCount: 2, contentBase64: 'aa', metadata: { itemId: 'item-1' } })
  assert.throws(
    () => collectUploadChunk({ uploadId: 'u2', chunkIndex: 1, chunkCount: 2, contentBase64: 'bb', metadata: { itemId: 'item-2' } }),
    (error) => error.code === 'UPLOAD_METADATA_MISMATCH'
  )
  assert.throws(
    () => collectUploadChunk({ uploadId: 'u2', chunkIndex: 0, chunkCount: 2, contentBase64: 'changed', metadata: { itemId: 'item-1' } }),
    (error) => error.code === 'UPLOAD_CHUNK_CONFLICT'
  )
})
