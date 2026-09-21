import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCoverBrief, chooseArchetype, chooseSocialTemplate } from './visual-system.mjs'
import { renderSlidePng } from './instagram-renderer.mjs'

test('visual brief fuerza variedad y registra referencias', () => {
  const archetype = chooseArchetype({
    site: 'escarlet',
    topic: 'La IA ya diseña bien. Ese empieza a ser el problema',
    history: [{ slug: 'last', title: 'Otro post', archetype: 'editorial-abstracta' }]
  })
  assert.equal(archetype.id, 'metafora-visual-conceptual')
  const brief = buildCoverBrief({
    site: 'escarlet',
    title: 'La IA ya diseña bien. Ese empieza a ser el problema',
    summary: 'La ventaja cambia el trabajo.',
    topic: 'IA y criterio',
    history: [{ slug: 'last', title: 'Otro post', archetype: 'editorial-abstracta' }]
  })
  assert.equal(brief.archetype, 'metafora-visual-conceptual')
  assert.deepEqual(brief.referenceDetails.map((reference) => reference.filename), [
    'reference-abstract-editorial.jpg',
    'reference-introspective.jpg'
  ])
  assert.equal(brief.version, '2.3.0')
  assert.equal(brief.decision.recentPostsInspected[0], 'last')
})

test('renderer produce un PNG con el tamaño de Instagram', () => {
  const template = chooseSocialTemplate({ site: 'escarlet', preferredId: 'impact' })
  const png = renderSlidePng({ site: 'escarlet', templateId: template.id, slide: { headline: 'Titular', body: 'Texto breve' } })
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(png.length > 10_000)
})
