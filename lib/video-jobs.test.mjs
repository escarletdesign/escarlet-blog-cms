import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProvider, VIDEO_PROVIDERS } from './video-provider.mjs'
import { sniffVideoMime, assertVideoBuffer } from './video-media.mjs'
import {
  buildChatGptVideoPrompt,
  motionRenderAvailability,
  newVideoJobId,
  VIDEO_JOB_STATUSES,
  videoRenderJobIdempotencyKey
} from './video-jobs.mjs'
import { buildMotionSceneSvg, buildMotionSvg, normalizeMotionScenes } from './motion-renderer.mjs'

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

test('motion jobs esperan proveedor sin fingir un render', () => {
  const first = videoRenderJobIdempotencyKey('vid_abc123')
  const second = videoRenderJobIdempotencyKey('vid_abc123')
  assert.equal(first, 'video-render:vid_abc123')
  assert.equal(first, second)
  assert.ok(VIDEO_JOB_STATUSES.includes('awaiting_provider'))
  assert.ok(VIDEO_JOB_STATUSES.includes('running'))
  assert.deepEqual(motionRenderAvailability('descript'), {
    configured: false,
    provider: 'descript',
    status: 'awaiting_provider',
    code: 'provider_not_configured',
    retryable: true
  })
  assert.equal(motionRenderAvailability('manual').code, 'manual_render_required')
  assert.equal(motionRenderAvailability('local').provider, 'local')
})

test('el renderer local compone un frame vertical con copy escapado', () => {
  const svg = buildMotionSvg({ imageBase64: 'aGVsbG8=', imageMime: 'image/png', site: 'demo', title: 'Plato <especial>', text: 'Una explicación breve.' })
  assert.match(svg, /1080/)
  assert.match(svg, /Plato &lt;especial&gt;/)
  assert.match(svg, /data:image\/png;base64,aGVsbG8=/)
})

test('el renderer local acepta un logo SVG entregado como asset de motion', () => {
  const svg = buildMotionSvg({ imageBase64: 'aGVsbG8=', imageMime: 'image/png', logoBase64: 'PHN2Zy8+', logoMime: 'image/svg+xml', site: 'demo', title: 'Reel', text: 'Copy aprobado.' })
  assert.match(svg, /data:image\/svg\+xml;base64,PHN2Zy8\+/)
})

test('el renderer de escenas mantiene el texto fuera del modo flat y respeta contain', () => {
  const flat = buildMotionSceneSvg({ imageBase64: 'aGVsbG8=', imageMime: 'image/png', logoBase64: 'PHN2Zy8+', title: 'No overlay', text: 'No debe aparecer', fit: 'contain', renderMode: 'flat_slides' })
  assert.match(flat, /preserveAspectRatio="xMidYMid meet"/)
  assert.doesNotMatch(flat, /No overlay|No debe aparecer|data:image\/svg\+xml/)
  const timeline = normalizeMotionScenes({
    scenes: [{ path: '/tmp/one.png', durationMs: 2400, fit: 'contain' }, { path: '/tmp/two.png', durationMs: 3600, fit: 'cover' }],
    renderMode: 'layered_motion'
  })
  assert.equal(timeline.totalMs, 6000)
  assert.deepEqual(timeline.scenes.map((scene) => scene.fit), ['contain', 'cover'])
  assert.equal(timeline.backgroundMode, 'blurred_source')
  assert.equal(timeline.motionPreset, 'subtle_editorial')
  assert.deepEqual(timeline.transition, { type: 'crossfade', durationMs: 400 })
  const dynamic = normalizeMotionScenes({
    scenes: [{ path: '/tmp/one.png', durationMs: 4000, textAnimation: 'fade_up' }, { path: '/tmp/two.png', durationMs: 4000, motionPreset: 'dynamic_editorial', textAnimation: 'slide_left' }],
    renderMode: 'layered_motion',
    motionPreset: 'dynamic_editorial',
    transition: { type: 'wipeleft', durationMs: 450 }
  })
  assert.equal(dynamic.motionPreset, 'dynamic_editorial')
  assert.deepEqual(dynamic.scenes.map((scene) => scene.textAnimation), ['fade_up', 'slide_left'])
  assert.deepEqual(dynamic.transition, { type: 'wipeleft', durationMs: 450 })
  const withBackground = buildMotionSceneSvg({ imageBase64: 'aGVsbG8=', backgroundBase64: 'YmFja2dyb3VuZA==', fit: 'contain', backgroundMode: 'blurred_source', renderMode: 'flat_slides' })
  assert.match(withBackground, /feGaussianBlur/)
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
