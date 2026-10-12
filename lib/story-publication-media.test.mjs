import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeStoryMedia } from './story-publication-media.mjs'

test('Story conserva sus imágenes y completa desde el carrusel sin duplicados', () => {
  const story = [{ url: 'https://cdn.example/story.jpg' }]
  const instagram = [
    { url: 'https://cdn.example/story.jpg' },
    { url: 'https://cdn.example/slide-2.jpg' },
    { url: 'https://cdn.example/slide-3.jpg' }
  ]

  assert.deepEqual(mergeStoryMedia(story, instagram), [story[0], instagram[1], instagram[2]])
})

test('Story usa el carrusel cuando no tiene medios y limita Buffer a 20 imágenes', () => {
  const instagram = Array.from({ length: 22 }, (_, index) => ({ url: `https://cdn.example/${index}.jpg` }))

  assert.deepEqual(mergeStoryMedia([], instagram), instagram.slice(0, 20))
})
