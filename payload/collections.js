/** Colecciones Payload 3. Copiar a un create-payload-app con Postgres cuando el panel simple se quede corto. */

export const Sites = {
  slug: 'sites',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'handle', type: 'text', required: true, unique: true },
    { name: 'domain', type: 'text' }
  ]
}

export const Authors = {
  slug: 'authors',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'url', type: 'text' }
  ]
}

export const Categories = {
  slug: 'categories',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true }
  ]
}

export const Posts = {
  slug: 'posts',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'site', 'status', 'datePublished'] },
  versions: { drafts: true },
  hooks: {
    afterChange: [
      async ({ doc, previousDoc }) => {
        const url = process.env.REBUILD_WEBHOOK_URL
        if (!url) return
        if (doc.status !== 'published') return
        if (previousDoc?.status === 'published' && previousDoc?.updatedAt === doc.updatedAt) return
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'escarlet-blog-cms', slug: doc.slug })
        })
      }
    ]
  },
  fields: [
    { name: 'site', type: 'relationship', relationTo: 'sites', required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, index: true },
    { name: 'excerptEs', type: 'textarea' },
    { name: 'bodyHtml', type: 'textarea', required: true },
    { name: 'metaTitle', type: 'text' },
    { name: 'metaDescription', type: 'textarea' },
    { name: 'datePublished', type: 'date', required: true },
    { name: 'dateModified', type: 'date' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'imageAlt', type: 'text' },
    { name: 'author', type: 'relationship', relationTo: 'authors' },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
    { name: 'related', type: 'relationship', relationTo: 'posts', hasMany: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      options: [
        { label: 'Borrador', value: 'draft' },
        { label: 'Publicado', value: 'published' }
      ]
    }
  ]
}

export const Media = {
  slug: 'media',
  upload: { staticDir: '../media', mimeTypes: ['image/*'] },
  fields: [{ name: 'alt', type: 'text' }]
}
