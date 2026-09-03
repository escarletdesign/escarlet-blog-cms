import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as cms from '../lib/cms-ops.mjs'
import { assertSiteAccess, assertSuperAdmin, allowedSiteHandles } from '../lib/auth.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'

export const RESOURCE_MAP = {
  voice: 'voice.md',
  keywords: 'keywords.md',
  'agent-rules': 'AGENT.md',
  agent: 'AGENT.md',
  'image-guide': 'image-guide.md',
  'visual-style': 'visual-style.md',
  'image-spec': 'image-spec.json'
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

function resolveToolSite(auth, args = {}) {
  const requested = args.site || (auth?.role === 'site' ? auth.site : DEFAULT_SITE)
  assertSiteAccess(auth, requested)
  return requested
}

function buildToolList(auth) {
  const tools = [
    {
      name: 'blog_list_sites',
      description: 'Lista sitios visibles con este token.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_onboarding',
      description:
        'Playbook setup + Coolify + flujo posts. Con token de sitio solo aplica a ese handle.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          domain: { type: 'string' },
          name: { type: 'string' }
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_create_site',
      description: 'Alta de un site nuevo. Solo administrador global.',
      inputSchema: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          name: { type: 'string' },
          domain: { type: 'string' },
          authors: { type: 'array', items: { type: 'string' } },
          rebuildWebhookUrl: { type: 'string' },
          coolifyApiToken: { type: 'string' },
          requiresHumanApproval: { type: 'boolean' },
          force: { type: 'boolean' }
        },
        required: ['handle']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      adminOnly: true
    },
    {
      name: 'blog_list_posts',
      description: 'Lista posts por site y status opcional (draft, review, published). Solo lectura.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_post',
      description: 'Lee un post completo por slug. Solo lectura.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_create_draft',
      description: 'Crea esqueleto de borrador NUEVO. Antes usa blog_get_brand_context. Escribe en el CMS.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          title: { type: 'string' },
          author: { type: 'string' },
          slug: { type: 'string' },
          date: { type: 'string' }
        },
        required: ['site', 'title']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_update_post',
      description: 'Actualiza un post EXISTENTE. Para portadas, primero blog_upload_media (imageUrl http pública o contentBase64 si el archivo está en sandbox) y luego pega la URL del CMS en imageUrl.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          originalSlug: { type: 'string' },
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
          status: { type: 'string' },
          keepPublished: { type: 'boolean' }
        },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_unpublish',
      description: 'Despublica un post (published → draft).',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_delete_post',
      description: 'Elimina un post. Obligatorio confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          confirm: { type: 'boolean' }
        },
        required: ['site', 'slug', 'confirm']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true }
    },
    {
      name: 'blog_validate_seo',
      description: 'Valida quality gates SEO.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_publish',
      description: 'Publica o envía a revisión. Cambia estado y puede disparar rebuild del frontend.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_get_seo_context',
      description: 'Keywords y reglas SEO del site.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_get_brand_context',
      description:
        'Obligatorio al crear o editar. Brand kit + workflow. Incluye imageSpec (JSON) cuando el kit trae brand-spec de imágenes.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_update_brand_file',
      description:
        'Crea o corrige un archivo del brand kit (voice.md, visual-style.md, image-guide.md, keywords.md, AGENT.md, image-spec.json).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          file: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['site', 'file', 'content']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_upload_media',
      description:
        'Sube una imagen al CMS y devuelve media.url ABSOLUTA. Tool principal para ChatGPT/Claude/Hermes. Preferido: imageUrl con https:// pública. Si la imagen solo existe en sandbox (/mnt/data, sandbox:, file://), lee el archivo y pasa contentBase64 (completo, sin truncar). NUNCA pases rutas sandbox como imageUrl. kind: post (portada), social (slides Instagram), reference (moodboard).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'Nombre kebab-case con extensión, ej. mi-post.webp o {slug}-ig-01.webp'
          },
          imageUrl: {
            type: 'string',
            description:
              'URL http(s) pública de la imagen. El CMS la descarga. Prohibido: /mnt/data, sandbox:, file:// u otras rutas locales.'
          },
          contentBase64: {
            type: 'string',
            description:
              'Imagen en base64 completa. Úsalo cuando ChatGPT solo tenga el archivo en sandbox (/mnt/data/...). Preferible a inventar una URL local.'
          },
          alt: { type: 'string' },
          kind: { type: 'string', description: 'post | social | reference' }
        },
        required: ['site', 'filename']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_remote_image',
      description:
        'Solo para imageUrl http(s) pública real. El CMS descarga y guarda. Si tienes /mnt/data o sandbox, usa blog_upload_media con contentBase64 en su lugar.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: { type: 'string', description: 'Nombre final, ej. portada.webp o {slug}-ig-01.webp.' },
          imageUrl: {
            type: 'string',
            description: 'URL http(s) pública. Prohibido /mnt/data, sandbox:, file://.'
          },
          alt: { type: 'string' },
          kind: { type: 'string', description: 'post, social o reference' }
        },
        required: ['site', 'filename', 'imageUrl']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_brand_zip',
      description:
        'Importa un ZIP de brand kit y lo organiza solo. Acepta cualquier estructura de carpetas. Clasifica .md (voice, visual-style, image-guide, keywords, AGENT) por nombre o pistas, JSON brand-spec → image-spec.json, e imágenes raster como referencias. PREFERIDO: zipUrl http(s) pública. Evita contentBase64 en ZIPs grandes.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          zipUrl: {
            type: 'string',
            description: 'URL http(s) pública del ZIP (preferido)'
          },
          contentBase64: {
            type: 'string',
            description: 'Solo si no hay zipUrl y el archivo es pequeño'
          }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    }
  ]

  return tools.filter((t) => !(t.adminOnly && auth?.role === 'site')).map(({ adminOnly, ...rest }) => rest)
}

/**
 * @param {{ role: 'admin' } | { role: 'site', site: string }} [auth]
 */
export function createMcpServer(auth = { role: 'admin' }) {
  const server = new Server(
    { name: 'escarlet-blog-cms', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList(auth)
  }))

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const sites = allowedSiteHandles(auth)
    const resources = []
    for (const site of sites) {
      for (const key of Object.keys(RESOURCE_MAP)) {
        const file = RESOURCE_MAP[key]
        const mimeType = file.endsWith('.json') ? 'application/json' : 'text/markdown'
        resources.push({
          uri: `brand://${site}/${key}`,
          name: `${site} ${key}`,
          mimeType
        })
      }
    }
    return { resources }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const match = request.params.uri.match(/^brand:\/\/([^/]+)\/([^/]+)$/)
    if (!match) throw new Error(`URI desconocida: ${request.params.uri}`)
    const [, site, key] = match
    assertSiteAccess(auth, site)
    const file = RESOURCE_MAP[key]
    if (!file) throw new Error(`Recurso desconocido: ${key}`)
    const data = await cms.getBrandFile(site, file)
    const mimeType = file.endsWith('.json') ? 'application/json' : 'text/markdown'
    return {
      contents: [{ uri: request.params.uri, mimeType, text: data.content || '' }]
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params
    try {
      switch (name) {
        case 'blog_list_sites': {
          const all = await cms.listSites()
          const allowed = new Set(allowedSiteHandles(auth))
          return textResult({
            sites: (all.sites || []).filter((s) => allowed.has(s.handle || s.id)),
            handles: [...allowed].sort(),
            role: auth.role
          })
        }
        case 'blog_get_onboarding': {
          const { getOnboardingPlaybook } = await import('../lib/onboarding.mjs')
          const handle = auth.role === 'site' ? auth.site : args.site || DEFAULT_SITE
          if (auth.role === 'site') assertSiteAccess(auth, handle)
          const base = await cms.getOnboarding(handle)
          return textResult(
            getOnboardingPlaybook({
              handle,
              name: args.name || base.site?.name,
              domain: args.domain || base.site?.domain,
              cmsUrl: process.env.CMS_PUBLIC_URL
            })
          )
        }
        case 'blog_create_site':
          assertSuperAdmin(auth)
          return textResult(await cms.createSiteRecord(args))
        case 'blog_list_posts': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.listPosts(site, args.status))
        }
        case 'blog_get_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getPost(site, args.slug))
        }
        case 'blog_create_draft': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.createDraft({ ...args, site }))
        }
        case 'blog_update_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updatePost({ ...args, site }))
        }
        case 'blog_unpublish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.unpublishPost(site, args.slug))
        }
        case 'blog_delete_post': {
          const site = resolveToolSite(auth, args)
          if (args.confirm !== true) {
            throw Object.assign(new Error('Para eliminar, pasa confirm: true'), { status: 400 })
          }
          return textResult(await cms.deletePost(site, args.slug))
        }
        case 'blog_validate_seo': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.validateSeo(site, args.slug))
        }
        case 'blog_publish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.publishPost(site, args.slug))
        }
        case 'blog_get_seo_context': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getSeoContext(site))
        }
        case 'blog_get_brand_context': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getBrandContext(site))
        }
        case 'blog_update_brand_file': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updateBrandFile(site, args.file, args.content))
        }
        case 'blog_upload_media': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.uploadMedia({ ...args, site }))
        }
        case 'blog_import_remote_image': {
          const site = resolveToolSite(auth, args)
          if (!args.imageUrl) {
            throw Object.assign(new Error('Pasa imageUrl http(s) pública. Si solo tienes sandbox (/mnt/data), usa blog_upload_media con contentBase64.'), {
              status: 400
            })
          }
          return textResult(await cms.uploadMedia({ ...args, site, contentBase64: undefined }))
        }
        case 'blog_import_brand_zip': {
          const site = resolveToolSite(auth, args)
          if (!args.zipUrl && !args.contentBase64) {
            throw Object.assign(new Error('Pasa zipUrl (preferido) o contentBase64'), { status: 400 })
          }
          return textResult(await cms.importBrandZip(site, args))
        }
        default:
          throw new Error(`Tool desconocida: ${name}`)
      }
    } catch (err) {
      return errorResult(err)
    }
  })

  return server
}
