import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandAssetFiles } from './migrate-json-to-postgres.mjs'

test('la reparación de brand assets incluye las referencias visuales del volumen', () => {
  const assets = brandAssetFiles('escarlet')
  assert.ok(assets.some((asset) => asset.endsWith('/reference/05-tablero-visual.png')))
  assert.ok(assets.some((asset) => asset.endsWith('/reference/fondo-escarlet.jpg')))
  assert.ok(!assets.some((asset) => /_thumb\./i.test(asset)))
})
