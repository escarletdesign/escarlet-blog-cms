import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProbablyMarkdown, renderPostBody } from './content-render.mjs'
import { resolveImageSrc } from './media-url.mjs'

test('renderPostBody convierte markdown sin HTML a títulos', () => {
  const html = renderPostBody('## Título\n\nPárrafo con **negrita**.')
  assert.match(html, /<h2>/)
  assert.match(html, /<strong>negrita<\/strong>/)
})

test('renderPostBody deja HTML tal cual', () => {
  const input = '<p>Hola</p><h2>Sección</h2>'
  assert.equal(renderPostBody(input), input)
})

test('isProbablyMarkdown detecta encabezados', () => {
  assert.equal(isProbablyMarkdown('## Hola'), true)
  assert.equal(isProbablyMarkdown('<p>Hola</p>'), false)
})

test('renderPostBody convierte listas y énfasis markdown', () => {
  const html = renderPostBody('- Uno\n- Dos\n\nTexto con *cursiva*.')
  assert.match(html, /<ul>/)
  assert.match(html, /<li>/)
  assert.match(html, /<em>cursiva<\/em>/)
})

test('resolveImageSrc reescribe localhost a /media', () => {
  assert.equal(
    resolveImageSrc('http://localhost:3000/media/escarlet/a.png'),
    '/media/escarlet/a.png'
  )
})
