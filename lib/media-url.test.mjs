import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaForClient, decodeImageBase64, looksLikeImage } from './media-url.mjs'

test('mediaForClient usa ruta relativa si CMS_PUBLIC_URL es localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3000'
  const item = mediaForClient({
    path: '/media/escarlet/reference/a.png',
    url: 'http://localhost:3000/media/escarlet/reference/a.png'
  })
  assert.equal(item.url, '/media/escarlet/reference/a.png')
})

test('decodeImageBase64 quita prefijo data URL', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0])
  const encoded = 'data:image/png;base64,' + png.toString('base64')
  const out = decodeImageBase64(encoded)
  assert.equal(out[0], 0x89)
  assert.equal(looksLikeImage(png), true)
})
