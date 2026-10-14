import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandAssetFiles } from './migrate-json-to-postgres.mjs'

test('la reparación de brand assets incluye las referencias visuales del volumen', () => {
  const assets = brandAssetFiles('escarlet')
  assert.ok(assets.some((asset) => asset.endsWith('/reference/style-board.png')))
  assert.ok(assets.some((asset) => asset.endsWith('/reference/character-silvia.webp')))
  assert.ok(assets.some((asset) => asset.endsWith('/reference/character-charly.png')))
  assert.ok(!assets.some((asset) => /\/reference\/(character-board|character-silvia\.png)$/.test(asset)))
  assert.ok(assets.some((asset) => asset.endsWith('/reference/logo-official-blue.png')))
  assert.ok(!assets.some((asset) => /_thumb\./i.test(asset)))
})
