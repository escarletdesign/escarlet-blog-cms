import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Jimp from 'jimp'
import {
  mediaForClient,
  decodeImageBase64,
  looksLikeImage,
  inspectImageBuffer,
  imageIntegrityMessage,
  coverImageError,
  resolvePostImageSrc,
  isSandboxOrLocalImageRef,
  sandboxImageHint,
  bufferFromUpload,
  pickBase64Payload,
  resolveLocalImagePath
} from './media-url.mjs'

function truncatedWebp(declaredTotal = 121336, actualPayload = 2000) {
  const riffSize = declaredTotal - 8
  const buf = Buffer.alloc(20 + actualPayload)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(riffSize, 4)
  buf.write('WEBP', 8)
  buf.write('VP8 ', 12)
  buf.writeUInt32LE(riffSize - 8, 16)
  buf.fill(0x80, 20)
  return buf
}

async function validPng() {
  const img = new Jimp(32, 32, 0xc45c48ff)
  return img.getBufferAsync(Jimp.MIME_PNG)
}

test('mediaForClient usa ruta relativa si CMS_PUBLIC_URL es localhost', () => {
  process.env.CMS_PUBLIC_URL = 'http://localhost:3000'
  const item = mediaForClient({
    path: '/media/escarlet/reference/a.png',
    url: 'http://localhost:3000/media/escarlet/reference/a.png'
  })
  assert.equal(item.url, '/media/escarlet/reference/a.png')
})

test('decodeImageBase64 quita prefijo data URL y un PNG real pasa integridad', async () => {
  const png = await validPng()
  const encoded = 'data:image/png;base64,' + png.toString('base64')
  const out = decodeImageBase64(encoded)
  assert.equal(out[0], 0x89)
  assert.equal(looksLikeImage(png), true)
  assert.equal(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false)
})

test('inspectImageBuffer rechaza WebP truncado aunque la cabecera sea válida', () => {
  const buf = truncatedWebp()
  const info = inspectImageBuffer(buf)
  assert.equal(info.ok, false)
  assert.equal(info.format, 'webp')
  assert.equal(info.reason, 'truncated')
  assert.equal(info.declaredBytes, 121336)
  assert.ok(info.actualBytes < info.declaredBytes)
  assert.match(imageIntegrityMessage(info), /incompleto/)
  assert.match(imageIntegrityMessage(info), /121336/)
  assert.equal(looksLikeImage(buf), false)
})

test('inspectImageBuffer rechaza PNG sin IEND', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(1200, 1)
  ])
  const info = inspectImageBuffer(png)
  assert.equal(info.ok, false)
  assert.equal(info.format, 'png')
  assert.equal(info.reason, 'truncated')
  assert.equal(info.width, 0)
  assert.equal(info.height, 0)
})

test('inspectImageBuffer devuelve las dimensiones de una imagen válida', async () => {
  const png = await new Jimp(1080, 1080, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const info = inspectImageBuffer(png)
  assert.equal(info.ok, true)
  assert.equal(info.width, 1080)
  assert.equal(info.height, 1080)
  assert.equal(info.aspectRatio, 1)
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
      assert.match(sandboxImageHint('/mnt/data/x.png'), /content_upload_media/)
      return true
    }
  )

  const png = await validPng()
  const out = await bufferFromUpload({
    imageUrl: '/mnt/data/portada.png',
    contentBase64: png.toString('base64')
  })
  assert.equal(out[0], 0x89)
  assert.equal(looksLikeImage(out), true)
})

test('coverImageError ignora URLs externas y vacías', () => {
  assert.equal(coverImageError('https://cdn.example.com/a.jpg', 'escarlet'), '')
  assert.equal(coverImageError('', 'escarlet'), '')
})

test('pickBase64Payload acepta blob y data como alias', () => {
  assert.equal(pickBase64Payload({ blob: 'abc' }), 'abc')
  assert.equal(pickBase64Payload({ data: 'xyz' }), 'xyz')
  assert.equal(pickBase64Payload({ contentBase64: 'one', blob: 'two' }), 'one')
})

test('bufferFromUpload lee un archivo local montado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cms-img-'))
  const png = await validPng()
  const filePath = join(dir, 'portada.png')
  writeFileSync(filePath, png)
  try {
    assert.equal(resolveLocalImagePath(filePath), filePath)
    const out = await bufferFromUpload({ filePath })
    assert.equal(out[0], 0x89)
    assert.equal(out.length, png.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
