#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as cms from './cms-client.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'

const RESOURCE_MAP = {
  voice: 'voice.md',
  keywords: 'keywords.md',
  'agent-rules': 'AGENT.md',
  agent: 'AGENT.md',
  'image-guide': 'image-guide.md',
  'visual-style': 'visual-style.md'
}

const server = new Server(
  { name: 'escarlet-blog-cms', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
)

function textResult(payload) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }]
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'blog_list_sites',
      description: 'Lista sitios configurados en el CMS central.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'blog_list_posts',
      description: 'Lista posts por site y status opcional (draft, review, published).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Handle del site, ej. escarlet' },
          status: { type: 'string', description: 'draft, review o published' }
        },
        required: ['site']
      }
    },
    {
      name: 'blog_get_post',
      description: 'Lee un post completo por slug.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' }
        },
        required: ['site', 'slug']
      }
    },
    {
      name: 'blog_create_draft',
      description:
        'Crea esqueleto de borrador. Antes, en este mismo turno, llama blog_get_brand_context y aplica voz, AGENT.md y estilo visual.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          title: { type: 'string' },
          author: { type: 'string', description: 'Charly o Silvia' },
          slug: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' }
        },
        required: ['site', 'title']
      }
    },
    {
      name: 'blog_update_post',
      description:
        'Actualiza campos de un post (parcial). El cuerpo y el SEO deben seguir el brand kit leído con blog_get_brand_context.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          excerptEs: { type: 'string' },
          bodyHtml: { type: 'string' },
          metaTitle: { type: 'object' },
          metaDescription: { type: 'object' },
          imageUrl: { type: 'string' },
          imageAlt: { type: 'string' },
          authorName: { type: 'string' },
          relatedSlugs: { type: 'array', items: { type: 'string' } },
          socialPack: { type: 'object' },
          status: { type: 'string' }
        },
        required: ['site', 'slug']
      }
    },
    {
      name: 'blog_validate_seo',
      description: 'Valida quality gates SEO antes de publicar.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' }
        },
        required: ['site', 'slug']
      }
    },
    {
      name: 'blog_publish',
      description: 'Publica un post si pasa validación SEO. Dispara rebuild del sitio.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' }
        },
        required: ['site', 'slug']
      }
    },
    {
      name: 'blog_get_seo_context',
      description: 'Keywords y reglas SEO del site.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      }
    },
    {
      name: 'blog_get_brand_context',
      description:
        'Obligatorio al crear o editar un post. Devuelve voz, estilo visual, keywords, AGENT.md e imágenes de referencia del site.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      }
    },
    {
      name: 'blog_update_brand_file',
      description:
        'Crea o corrige un archivo del brand kit (voice.md, visual-style.md, image-guide.md, keywords.md, AGENT.md). El equipo puede editarlo después en el dashboard.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          file: {
            type: 'string',
            description: 'voice.md, visual-style.md, image-guide.md, keywords.md o AGENT.md'
          },
          content: { type: 'string', description: 'Markdown completo del archivo' }
        },
        required: ['site', 'file', 'content']
      }
    },
    {
      name: 'blog_upload_media',
      description:
        'Sube imagen en base64. kind=reference es moodboard de marca. kind=post es portada o foto del artículo. Devuelve URL pública.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: { type: 'string' },
          contentBase64: { type: 'string' },
          alt: { type: 'string' },
          kind: { type: 'string', description: 'post o reference' }
        },
        required: ['site', 'filename', 'contentBase64']
      }
    }
  ]
}))

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const listed = await cms.listSites()
  const sites = listed.handles?.length
    ? listed.handles
    : (listed.sites || []).map((s) => s.handle || s.id).filter(Boolean)
  const resources = []
  for (const site of sites) {
    for (const key of Object.keys(RESOURCE_MAP)) {
      resources.push({
        uri: `brand://${site}/${key}`,
        name: `${site} ${key}`,
        mimeType: 'text/markdown'
      })
    }
  }
  return { resources }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const match = request.params.uri.match(/^brand:\/\/([^/]+)\/([^/]+)$/)
  if (!match) throw new Error(`URI desconocida: ${request.params.uri}`)
  const [, site, key] = match
  const file = RESOURCE_MAP[key]
  if (!file) throw new Error(`Recurso desconocido: ${key}`)
  const data = await cms.getBrandFile(site, file)
  return {
    contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: data.content || '' }]
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params
  const site = args.site || DEFAULT_SITE

  switch (name) {
    case 'blog_list_sites':
      return textResult(await cms.listSites())
    case 'blog_list_posts':
      return textResult(await cms.listPosts(site, args.status))
    case 'blog_get_post':
      return textResult(await cms.getPost(site, args.slug))
    case 'blog_create_draft':
      return textResult(await cms.createDraft(args))
    case 'blog_update_post':
      return textResult(await cms.updatePost(args))
    case 'blog_validate_seo':
      return textResult(await cms.validateSeo(site, args.slug))
    case 'blog_publish':
      return textResult(await cms.publishPost(site, args.slug))
    case 'blog_get_seo_context':
      return textResult(await cms.getSeoContext(site))
    case 'blog_get_brand_context':
      return textResult(await cms.getBrandContext(site))
    case 'blog_update_brand_file':
      return textResult(await cms.updateBrandFile(site, args.file, args.content))
    case 'blog_upload_media':
      return textResult(await cms.uploadMedia(args))
    default:
      throw new Error(`Tool desconocida: ${name}`)
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
