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
})
