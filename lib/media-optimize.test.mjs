import { test } from 'node:test'
import assert from 'node:assert/strict'
import Jimp from 'jimp'
import { optimizeImageBuffer, jpegFilename, generateThumbBuffer } from './media-optimize.mjs'

test('jpegFilename cambia la extensión a jpg', () => {
  assert.equal(jpegFilename('slug-ig-01.webp'), 'slug-ig-01.jpg')
  assert.equal(jpegFilename('Portada PNG.png'), 'portada-png.jpg')
})

test('optimizeImageBuffer convierte PNG ruidoso a JPEG más pequeño', async () => {
  const image = new Jimp(640, 640, 0xffffffff)
  image.scan(0, 0, 640, 640, function (x, y, idx) {
    this.bitmap.data[idx] = (x * 13 + y * 7) % 255
    this.bitmap.data[idx + 1] = (x * 3) % 255
    this.bitmap.data[idx + 2] = (y * 5) % 255
  })
  const png = await image.getBufferAsync(Jimp.MIME_PNG)
  const out = await optimizeImageBuffer(png, { kind: 'post', filename: 'portada.png' })
  assert.equal(out.optimized, true)
  assert.equal(out.format, 'jpeg')
  assert.equal(out.filename, 'portada.jpg')
  assert.equal(out.buffer[0], 0xff)
  assert.equal(out.buffer[1], 0xd8)
  assert.ok(out.buffer.length < png.length)
})

test('optimizeImageBuffer elimina el bloque EXIF de un JPEG', async () => {
  const image = new Jimp(64, 64, 0x2d6a4fff)
  const jpeg = await image.quality(88).getBufferAsync(Jimp.MIME_JPEG)
  const exifPayload = Buffer.from('Exif\0\0GPS test', 'latin1')
  const segment = Buffer.alloc(4 + exifPayload.length)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(exifPayload.length + 2, 2)
  exifPayload.copy(segment, 4)
  const withExif = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
  const out = await optimizeImageBuffer(withExif, { kind: 'social', filename: 'foto.jpg' })
  assert.equal(out.metadataSanitized, true)
  assert.equal(out.buffer.includes(Buffer.from('Exif\0\0', 'latin1')), false)
})

test('optimizeImageBuffer elimina bloques C2PA/JUMBF APP11 de un JPEG', async () => {
  const image = new Jimp(64, 64, 0x2d6a4fff)
  const jpeg = await image.quality(88).getBufferAsync(Jimp.MIME_JPEG)
  const jumbf = Buffer.from('JUMBF c2pa manifest', 'latin1')
  const segment = Buffer.alloc(4 + jumbf.length)
  segment[0] = 0xff
  segment[1] = 0xeb
  segment.writeUInt16BE(jumbf.length + 2, 2)
  jumbf.copy(segment, 4)
  const withC2pa = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
  const out = await optimizeImageBuffer(withC2pa, { kind: 'social', filename: 'foto.jpg' })
  assert.equal(out.buffer.includes(Buffer.from('JUMBF c2pa', 'latin1')), false)
})

test('optimizeImageBuffer recorta slides sociales a 1080 de ancho', async () => {
  const png = await new Jimp(1600, 2000, 0x2d6a4fff).getBufferAsync(Jimp.MIME_PNG)
  const out = await optimizeImageBuffer(png, { kind: 'social', filename: 'post-ig-01.png' })
  const image = await Jimp.read(out.buffer)
  assert.ok(image.bitmap.width <= 1080)
  assert.ok(image.bitmap.height <= 1440)
  assert.equal(out.filename, 'post-ig-01.jpg')
})

test('generateThumbBuffer limita el ancho a 400 y devuelve JPEG', async () => {
  const png = await new Jimp(1200, 800, 0xc45c48ff).getBufferAsync(Jimp.MIME_PNG)
  const out = await generateThumbBuffer(png, 400)
  assert.equal(out.ok, true)
  assert.equal(out.format, 'jpeg')
  assert.ok(out.buffer)
  assert.equal(out.buffer[0], 0xff)
  assert.equal(out.buffer[1], 0xd8)
  assert.ok(out.width <= 400)
  const image = await Jimp.read(out.buffer)
  assert.ok(image.bitmap.width <= 400)
})
