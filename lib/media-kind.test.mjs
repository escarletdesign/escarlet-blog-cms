import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMediaKind, MEDIA_KINDS } from './media-kind.mjs'

test('normalizeMediaKind acepta alias de Instagram y referencia', () => {
  assert.equal(normalizeMediaKind('social'), 'social')
  assert.equal(normalizeMediaKind('instagram'), 'social')
  assert.equal(normalizeMediaKind('ig'), 'social')
  assert.equal(normalizeMediaKind('reference'), 'reference')
  assert.equal(normalizeMediaKind('moodboard'), 'reference')
  assert.equal(normalizeMediaKind('post'), 'post')
  assert.equal(normalizeMediaKind(''), 'post')
  assert.deepEqual(MEDIA_KINDS, ['post', 'social', 'reference'])
})
