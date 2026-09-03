import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mediaForClient,
  decodeImageBase64,
  looksLikeImage,
  resolvePostImageSrc,
  isSandboxOrLocalImageRef,
  sandboxImageHint,
  bufferFromUpload
} from './media-url.mjs'

test('mediaForClient usa ruta relativa si CMS_PUBLIC_URL es localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3000'
  const item = mediaForClient({
    path: '/media/escarlet/reference/a.png',
    url: 'http://localhost:3000/media/escarlet/reference/a.png'
  })
  assert.equal(item.url, '/media/escarlet/reference/a.png')
})

test('decodeImageBase64 quita prefijo data URL', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(1200, 1)
  ])
  const encoded = 'data:image/png;base64,' + png.toString('base64')
  const out = decodeImageBase64(encoded)
  assert.equal(out[0], 0x89)
  assert.equal(looksLikeImage(png), true)
  assert.equal(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false)
})

test('resolvePostImageSrc conserva URLs públicas externas', () => {
  process.env.CMS_PUBLIC_URL = 'https://blog-cms.escarlet.cc'
  const url = 'https://cdn.example.com/portadas/post-demo.webp'
  assert.equal(resolvePostImageSrc(url, 'escarlet'), url)
})

test('isSandboxOrLocalImageRef detecta rutas de ChatGPT', () => {
  assert.equal(isSandboxOrLocalImageRef('/mnt/data/portada.png'), true)
  assert.equal(isSandboxOrLocalImageRef('sandbox:/mnt/data/a.webp'), true)
  assert.equal(isSandboxOrLocalImageRef('file:///tmp/a.png'), true)
  assert.equal(isSandboxOrLocalImageRef('https://cdn.example.com/a.webp'), false)
  assert.equal(isSandboxOrLocalImageRef('/media/escarlet/a.webp'), false)
})

test('bufferFromUpload rechaza sandbox sin base64 y acepta base64 de respaldo', async () => {
  await assert.rejects(
    () => bufferFromUpload({ imageUrl: '/mnt/data/portada.png' }),
    (err) => {
      assert.match(String(err.message), /sandbox|\/mnt\/data|contentBase64/i)
      assert.match(sandboxImageHint('/mnt/data/x.png'), /blog_upload_media/)
      return true
    }
  )

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(1200, 1)
  ])
  const out = await bufferFromUpload({
    imageUrl: '/mnt/data/portada.png',
    contentBase64: png.toString('base64')
  })
  assert.equal(out[0], 0x89)
  assert.equal(looksLikeImage(out), true)
})
