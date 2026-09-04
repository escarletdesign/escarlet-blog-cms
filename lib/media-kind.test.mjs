import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMediaKind, inferMediaKind, MEDIA_KINDS } from './media-kind.mjs'

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

test('inferMediaKind usa el filename de slide IG aunque kind sea post', () => {
  assert.equal(inferMediaKind({ kind: 'post', filename: 'cuidar-columna-ig-01.png' }), 'social')
  assert.equal(inferMediaKind({ kind: 'post', filename: 'portada-cliente.png' }), 'post')
})
