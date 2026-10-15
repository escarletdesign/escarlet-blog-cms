import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSlideSvg } from './instagram-renderer.mjs'

test('renderiza texto sin borde y elimina separadores decorativos', () => {
  const svg = buildSlideSvg({
    slide: {
      headline: 'Criterio — antes - ahora',
      body: 'Una idea — clara para leer en móvil.'
    },
    templateId: 'editorial',
    slideIndex: 0,
    slideCount: 4
  })

  assert.doesNotMatch(svg, /<text[^>]+\s(?:stroke|paint-order)=/)
  assert.doesNotMatch(svg, /Criterio\s+[\u2014\u2013-]\s+/)
  assert.doesNotMatch(svg, /Una idea\s+[\u2014\u2013-]\s+/)
})
