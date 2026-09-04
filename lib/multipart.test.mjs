import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMultipart } from './multipart.mjs'

test('parseMultipart extrae campos y bytes del archivo', () => {
  const fileBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])
  const body = Buffer.concat([
    Buffer.from(
      '--bound123\r\n' +
        'Content-Disposition: form-data; name="kind"\r\n\r\n' +
        'social\r\n' +
        '--bound123\r\n' +
        'Content-Disposition: form-data; name="file"; filename="slide.png"\r\n' +
        'Content-Type: image/png\r\n\r\n',
      'utf8'
    ),
    fileBytes,
    Buffer.from('\r\n--bound123--\r\n', 'utf8')
  ])
  const parsed = parseMultipart(body, 'multipart/form-data; boundary=bound123')
  assert.equal(parsed.fields.kind, 'social')
  assert.equal(parsed.file.filename, 'slide.png')
  assert.deepEqual([...parsed.file.buffer], [...fileBytes])
})
