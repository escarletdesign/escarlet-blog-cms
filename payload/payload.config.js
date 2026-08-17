/**
 * Config de referencia Payload 3.
 * Copiar a un create-payload-app con @payloadcms/db-postgres.
 */
import { Sites, Posts, Authors, Media, Categories } from './collections.js'

export const collections = [Sites, Posts, Authors, Media, Categories]

export const rebuildWebhookHook = {
  afterChange: [
    async ({ doc, previousDoc, req: _req }) => {
      const url = process.env.REBUILD_WEBHOOK_URL
      if (!url) return
      const publishedNow = doc.status === 'published' && previousDoc?.status !== 'published'
      const stillPublished = doc.status === 'published' && previousDoc?.status === 'published'
      if (!publishedNow && !stillPublished) return
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'escarlet-blog-cms', slug: doc.slug })
      })
    }
  ]
}
