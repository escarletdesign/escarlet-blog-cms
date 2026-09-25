import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProvider, VIDEO_PROVIDERS } from './video-provider.mjs'
import { sniffVideoMime, assertVideoBuffer } from './video-media.mjs'
import { buildChatGptVideoPrompt, newVideoJobId } from './video-jobs.mjs'

test('normalizeProvider acepta valores conocidos y cae en unknown', () => {
  assert.equal(normalizeProvider('descript'), 'descript')
  assert.equal(normalizeProvider('DEScript'), 'descript')
  assert.equal(normalizeProvider('otro'), 'unknown')
  assert.deepEqual(VIDEO_PROVIDERS.includes('manual'), true)
})

test('sniffVideoMime detecta webm y mp4', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])
  const mp4 = Buffer.alloc(12)
  mp4.write('ftyp', 4, 'ascii')
  assert.equal(sniffVideoMime(webm), 'video/webm')
  assert.equal(sniffVideoMime(mp4), 'video/mp4')
})

test('assertVideoBuffer rechaza bytes no vídeo', () => {
  assert.throws(() => assertVideoBuffer(Buffer.from('hola')), (error) => error.code === 'VIDEO_INVALID_MIME')
})

test('newVideoJobId usa prefijo vid_', () => {
  assert.match(newVideoJobId(), /^vid_[a-f0-9]{12}$/)
})

test('buildChatGptVideoPrompt incluye sourceUrl y job id', () => {
  const prompt = buildChatGptVideoPrompt({
    videoJobId: 'vid_abc123',
    brand: 'escarlet',
    sourceUrl: 'https://cms.escarlet.design/media/escarlet/raw.mov',
    speaker: 'silvia',
    channel: 'instagram',
    format: 'reel'
  })
  assert.match(prompt, /vid_abc123/)
  assert.match(prompt, /raw\.mov/)
  assert.match(prompt, /video_import_external_media/)
})
