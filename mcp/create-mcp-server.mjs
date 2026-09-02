import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as cms from '../lib/cms-ops.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'

export const RESOURCE_MAP = {
  voice: 'voice.md',
  keywords: 'keywords.md',
  'agent-rules': 'AGENT.md',
  agent: 'AGENT.md',
  'image-guide': 'image-guide.md',
  'visual-style': 'visual-style.md'
}

function textResult(payload) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }]
  }
}

function errorResult(err) {
  const payload = {
    message: err.message,
    status: err.status || 500,
    ...(err.extra || {})
  }
  if (payload.validation && !payload.blockingErrors) {
    payload.blockingErrors = payload.validation.errors
    payload.warnings = payload.validation.warnings
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  }
}

export function createMcpServer() {
  const server = new Server(
    { name: 'escarlet-blog-cms', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  )

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
        description: 'Lee un post completo por slug. Incluye previewUrl para abrir el borrador en el navegador.',
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
          'Crea esqueleto de borrador. Antes llama blog_get_brand_context. Devuelve previewUrl ABSOLUTO (https://blog-cms.escarlet.cc/preview/...) listo para compartir con el humano.',
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
          'Actualiza campos de un post (parcial). Devuelve validation con blockingErrors, warnings, previewUrl y hint para saber si falta SEO antes de publicar.',
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
        description:
          'Valida quality gates SEO. Devuelve blockingErrors (impiden publicar), warnings (recomendaciones) y previewUrl. Con aprobación humana activa, blog_publish puede enviar a revisión aunque haya errores.',
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
        description:
          'Publica o envía a revisión. Con aprobación humana activa, un borrador draft pasa a review aunque el SEO no esté perfecto (devuelve previewUrl). La publicación final la hace un humano desde el dashboard cuando el SEO es válido.',
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
          'Sube una imagen al CMS y devuelve media.url ABSOLUTA (https://blog-cms.escarlet.cc/media/...). Usa esa URL en imageUrl del post. PREFERIDO: pasa imageUrl con una URL http(s) pública temporal de la imagen generada (OpenAI, Gemini, CDN, etc.). El CMS la descarga y guarda. EVITA contentBase64 para fotos grandes: el base64 suele truncarse o fallar por tamaño. contentBase64 solo para archivos pequeños de prueba. kind=post portada del artículo. kind=reference moodboard de marca.',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string' },
            filename: {
              type: 'string',
              description: 'Nombre kebab-case con extensión, ej. que-es-branding.png'
            },
            imageUrl: {
              type: 'string',
              description:
                'URL http(s) pública de la imagen (preferido). El CMS descarga el archivo completo desde aquí.'
            },
            contentBase64: {
              type: 'string',
              description:
                'Solo si no hay imageUrl y el archivo es pequeño. No uses base64 para portadas grandes.'
            },
            alt: { type: 'string', description: 'Texto alt descriptivo (lo que se ve en la foto)' },
            kind: { type: 'string', description: 'post (portada) o reference (moodboard)' }
          },
          required: ['site', 'filename']
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
    try {
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
    } catch (err) {
      return errorResult(err)
    }
  })

  return server
}
