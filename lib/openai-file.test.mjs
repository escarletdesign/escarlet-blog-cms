import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OPENAI_FILE_DEF,
  openaiFileDefs,
  connectorFileMeta,
  pickConnectorFile
} from './openai-file.mjs'

test('el schema de file declara las cuatro propiedades que exige ChatGPT', () => {
  assert.deepEqual(Object.keys(OPENAI_FILE_DEF.properties), [
    'download_url',
    'file_id',
    'mime_type',
    'file_name'
  ])
  assert.deepEqual(OPENAI_FILE_DEF.required, ['download_url', 'file_id'])
  assert.equal(OPENAI_FILE_DEF.additionalProperties, false)
  assert.ok(openaiFileDefs().OpenAIFile)
  assert.deepEqual(connectorFileMeta()['openai/fileParams'], ['file'])
})

test('pickConnectorFile lee download_url snake_case y camelCase', () => {
  assert.equal(
    pickConnectorFile({
      file: {
        download_url: 'https://files.example.com/a.png',
        file_id: 'file_1',
        mime_type: 'image/png',
        file_name: 'a.png'
      }
    }).download_url,
    'https://files.example.com/a.png'
  )
  assert.equal(
    pickConnectorFile({
      file: { downloadUrl: 'https://files.example.com/b.png', fileId: 'file_2' }
    }).file_id,
    'file_2'
  )
  assert.equal(
    pickConnectorFile({ file: [{ download_url: 'https://files.example.com/c.png', file_id: 'file_3' }] })
      .download_url,
    'https://files.example.com/c.png'
  )
})

test('pickConnectorFile marca rutas sandbox para que el CMS las rechace', () => {
  const hit = pickConnectorFile({ file: '/mnt/data/portada.png' })
  assert.equal(hit.sandboxPath, '/mnt/data/portada.png')
  assert.equal(hit.download_url, '')
})

test('pickConnectorFile conserva identificadores incompletos para devolver un diagnóstico útil', () => {
  assert.deepEqual(pickConnectorFile({ file: { file_id: 'file_only' } }), {
    download_url: '',
    file_id: 'file_only',
    mime_type: '',
    file_name: ''
  })
  assert.equal(pickConnectorFile({ file: { asset_pointer: 'file-service://asset-1' } }).asset_pointer, 'file-service://asset-1')
})
