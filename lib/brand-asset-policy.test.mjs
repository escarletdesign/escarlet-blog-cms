import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isApprovedBrandAsset } from './brand-asset-policy.mjs'

test('Escarlet solo acepta assets canónicos en el brand kit', () => {
  assert.equal(isApprovedBrandAsset('escarlet', 'media/escarlet/reference/style-board.png'), true)
  assert.equal(isApprovedBrandAsset('escarlet', 'carousel-reference-04-bonito-coherente.jpg'), false)
  assert.equal(isApprovedBrandAsset('escarlet', 'la-home-no-tiene-que-contarlo-todo-ig-01-final.jpg'), false)
  assert.equal(isApprovedBrandAsset('maria-test', 'carousel-reference-04-bonito-coherente.jpg'), true)
})
