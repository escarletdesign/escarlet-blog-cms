import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProductTransformSvg } from './product-renderer.mjs'

test('product transform conserva la referencia y el perfil vertical', () => {
  const svg = buildProductTransformSvg({ imageBase64: 'aGVsbG8=', imageMime: 'image/png', site: 'demo', title: 'Producto <nuevo>', width: 1080, height: 1920 })
  assert.match(svg, /width="1080" height="1920"/)
  assert.match(svg, /data:image\/png;base64,aGVsbG8=/)
  assert.match(svg, /Producto &lt;nuevo&gt;/)
})
