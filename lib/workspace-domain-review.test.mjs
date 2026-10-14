import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReviewChannels } from './workspace-domain.mjs'

test('la revisión puede limitarse a variantes válidas', () => {
  assert.deepEqual(normalizeReviewChannels(['instagram', 'instagram', 'blog']), ['instagram', 'blog'])
  assert.equal(normalizeReviewChannels(undefined), null)
  assert.throws(() => normalizeReviewChannels([]), /al menos una variante/)
  assert.throws(() => normalizeReviewChannels(['no-es-un-canal']), /Canales no válidos/)
})
