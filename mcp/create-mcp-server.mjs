import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as cms from '../lib/cms-ops.mjs'
import {
  MCP_INSTRUCTIONS,
  MCP_SERVER_VERSION,
  withMediaUploadContract
} from '../lib/media-upload-contract.mjs'
import { openaiFileDefs, connectorFileMeta } from '../lib/openai-file.mjs'
import { assertSiteAccess, assertSuperAdmin, allowedSiteHandles, isSiteScopedRole } from '../lib/auth.mjs'
import { isSecretBrandFile } from '../lib/brand-kit.mjs'
import { assertChatToolAllowed, assertSafeToolArguments } from '../lib/ai-security.mjs'
import { loadSiteConfig, isSocialMediaOnlySite } from '../lib/site-config.mjs'
import { readDb } from '../lib/db.mjs'
import {
  getStandaloneSocialPack,
  listStandaloneSocialPacks,
  saveStandaloneSocialPack
} from '../lib/social-pack-store.mjs'
import { getWorkflowFlags } from '../lib/workflow-flags.mjs'
import { isCmsAiEnabled } from '../lib/product-flags.mjs'
import { withGenerationPolicy, assertCmsAiAllowed, CMS_AI_TOOLS } from '../lib/generation-policy.mjs'
import { canReadPost, assertPostAccess, safePostFields } from '../lib/post-access.mjs'
import { listSiteAuthors } from '../lib/human-auth.mjs'

const DEFAULT_SITE = process.env.DEFAULT_SITE || 'escarlet'
const BLOG_CONTENT_TOOLS = new Set([
  'blog_get_workflow',
  'blog_save_social_pack',
  'blog_list_posts',
  'blog_get_post',
  'blog_create_draft',
  'blog_update_post',
  'blog_unpublish',
  'blog_delete_post',
  'blog_validate_seo',
  'blog_publish',
  'blog_request_changes',
  'blog_schedule_post',
  'blog_confirm_schedule',
  'blog_cancel_schedule',
  'blog_list_calendar',
  'blog_get_seo_context'
])

export const RESOURCE_MAP = {
  voice: 'voice.md',
  keywords: 'keywords.md',
  'agent-rules': 'AGENT.md',
  agent: 'AGENT.md',
  'image-guide': 'image-guide.md',
  'visual-style': 'visual-style.md',
  'image-spec': 'image-spec.json'
}

// Publication links are an internal dashboard concern. MCP callers should
// receive the operation result and next action, but never a legacy preview or
// admin URL that can pull them out of the in-app workflow. Keep media URLs
// untouched: they are required when attaching generated/uploaded images.
const PRIVATE_WORKFLOW_KEYS = new Set([
  'previewUrl',
  'dashboardUrl',
  'reviewHint',
  'reviewUrl',
  'legacyUrl',
  'publicationUrl'
])

function redactWorkflowLinks(value) {
  if (Array.isArray(value)) return value.map(redactWorkflowLinks)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_WORKFLOW_KEYS.has(key))
      .map(([key, item]) => [key, redactWorkflowLinks(item)])
  )
}

function textResult(payload) {
  const safePayload = redactWorkflowLinks(payload)
  return {
    content: [{ type: 'text', text: typeof safePayload === 'string' ? safePayload : JSON.stringify(safePayload, null, 2) }]
  }
}

function errorResult(err) {
  const payload = redactWorkflowLinks({
    message: err.message,
    status: err.status || 500,
    ...(err.extra || {})
  })
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
  const requested = args.site || (isSiteScopedRole(auth?.role) ? auth.site : DEFAULT_SITE)
  assertSiteAccess(auth, requested)
  return requested
}

function cmsOrigin() {
  return String(process.env.CMS_PUBLIC_URL || 'https://blog-cms.escarlet.cc')
    .replace(/\/$/, '')
    .replace(/\/app$/, '')
}

function appUrl(path = '') {
  return `${cmsOrigin()}/app${path.startsWith('/') ? path : `/${path}`}`
}

const APP_WORKFLOW_KEYS = new Set(['appUrl', 'appBaseUrl', 'appPreviewUrl', 'appSocialPackUrl'])

function hideAppWorkflowLinks(value) {
  if (Array.isArray(value)) return value.map(hideAppWorkflowLinks)
  if (typeof value === 'string') {
    return value
      .replace(/https?:\/\/[^\s)]+\/app(?:\/[^\s)]*)?/gi, 'la app')
      .replace(/\/app(?:\/[^\s)]*)?/gi, 'la app')
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !APP_WORKFLOW_KEYS.has(key))
      .map(([key, item]) => [key, key === 'routes' ? {} : hideAppWorkflowLinks(item)])
  )
}

function workflowPayload(payload, source) {
  return source === 'app' || source === 'chat' ? hideAppWorkflowLinks(payload) : payload
}

function directWorkflowPublish(args, source) {
  // The external connector is now the /app workflow. Keep the old review gate
  // available only when an integrator explicitly opts into direct=false.
  return args.direct === true || (source === 'mcp' && args.direct !== false)
}

export function buildToolList(auth) {
  const tools = [
    { name: 'blog_list_authors', description: 'Autores asignados y autorizados para publicar en su nombre.', inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] }, annotations: { readOnlyHint: true } },
    { name: 'social_save_pack', description: 'Guarda un Social Pack independiente, sin crear ni actualizar un post de blog. ChatGPT debe generar los textos y las slides antes de llamar a esta tool.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, brief: { type: 'string' }, sourceUrl: { type: 'string' }, socialPack: { type: 'object' } }, required: ['site', 'socialPack'] }, annotations: { readOnlyHint: false } },
    { name: 'social_list_packs', description: 'Lista los Social Packs independientes guardados para un sitio; no devuelve posts de blog.', inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] }, annotations: { readOnlyHint: true } },
    { name: 'social_get_pack', description: 'Lee un Social Pack independiente guardado, sin depender de un post de blog.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, id: { type: 'string' } }, required: ['site', 'id'] }, annotations: { readOnlyHint: true } },
    { name: 'blog_save_social_pack', description: 'Guarda textos y slides generados por ChatGPT. Las slides deben llevar texto renderizado por template, templateId y renderedBy. No genera contenido ni llama APIs de IA.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, slug: { type: 'string' }, socialPack: { type: 'object' } }, required: ['site', 'slug', 'socialPack'] }, annotations: { readOnlyHint: false } },
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
      name: 'blog_get_workflow',
      description:
        'Explica los dos flujos nuevos de Escarlet en /app y su feature flag. Debes usarla antes de crear un post y preguntar al usuario si prefiere el flujo simple asistido o el flujo guiado con revisión en la app.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          mode: { type: 'string', enum: ['easy', 'guided'] }
        },
        required: ['site']
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
          contentMode: { type: 'string', enum: ['blog', 'socialmedia'] },
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
      description:
        'Lista posts por site y status opcional (draft, pending_schedule, scheduled, published). Solo lectura. Los estados de revisión antiguos se conservan solo para datos históricos.',
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
      name: 'blog_get_quota',
      description:
        'Lee métricas históricas del sitio (borradores y publicaciones del mes UTC). En beta no bloquean las publicaciones MCP. Solo lectura.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' } },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'blog_create_draft',
      description:
        'Crea esqueleto de borrador NUEVO. Antes usa blog_get_brand_context. Respeta cupos del plan (QUOTA_EXCEEDED / MEMBERSHIP_SUSPENDED). Escribe en el CMS.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          title: { type: 'string' },
          author: { type: 'string' },
          slug: { type: 'string' },
          date: { type: 'string' },
          contentSource: { type: 'string', description: 'agency | client' }
        },
        required: ['site', 'title']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_update_post',
      description: 'Actualiza un post EXISTENTE. Guarda en el CMS y no dispara rebuild. Para que salga en la web llama blog_publish. No permite modificar estado ni propietario: usa publicar/programar/despublicar. Portada. mediaUpload A→B→C kind post y pega media.url en imageUrl.',
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
          imageGallery: { type: 'array', items: { type: 'object' } },
          visualBrief: { type: 'object', description: 'Metadata del sistema visual v2: arquetipo, composición, referencias y decisión.' },
          imageMetadata: { type: 'object' }
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
      description:
        'Publica o programa desde el workflow nuevo de /app. Después de la confirmación del usuario usa direct=true para no entrar en el flujo legacy de revisión. Con publishAt futuro (YYYY-MM-DD) programa el post.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          publishAt: {
            type: 'string',
            description: 'YYYY-MM-DD. Si es futuro, programa en vez de publicar ya.'
          },
          direct: {
            type: 'boolean',
            description: 'true después de la confirmación del usuario. Publica directamente desde /app y evita review legacy.'
          },
          ignoreSeo: {
            type: 'boolean',
            description: 'Solo si el usuario confirma publicar aunque existan avisos SEO bloqueantes.'
          }
        },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_request_changes',
      description:
        'Compatibilidad histórica. Registra un motivo de cambios en un post antiguo; el workflow nuevo de /app no usa este paso.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          rejectReason: { type: 'string', description: 'Motivo no vacío para el cliente' }
        },
        required: ['site', 'slug', 'rejectReason']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_schedule_post',
      description:
        'Programa un post para publishAt (YYYY-MM-DD). Usa direct=true tras la confirmación del usuario para dejarlo scheduled y evitar la cola de revisión legacy.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          slug: { type: 'string' },
          publishAt: { type: 'string', description: 'YYYY-MM-DD' },
          direct: { type: 'boolean', description: 'true tras la confirmación del usuario; evita pending_schedule legacy.' },
          ignoreSeo: { type: 'boolean', description: 'Solo si el usuario confirma continuar con avisos SEO bloqueantes.' }
        },
        required: ['site', 'slug', 'publishAt']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_confirm_schedule',
      description: 'Confirma un post pending_schedule → scheduled. Solo super-admin.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      adminOnly: true
    },
    {
      name: 'blog_cancel_schedule',
      description: 'Cancela una programación pending_schedule o scheduled y devuelve el post a un estado editable.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string' }, slug: { type: 'string' } },
        required: ['site', 'slug']
      },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
    },
    {
      name: 'blog_list_calendar',
      description:
        'Posts del calendario (pending_schedule, scheduled, published) entre from y to (YYYY-MM-DD).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['site']
      },
      annotations: { readOnlyHint: true }
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
        'Obligatorio al crear o editar. Incluye mediaUpload A→B→C. Con token de sitio no incluye voz ni image-spec (privados). Si file no es invocable usa contentBase64.',
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
        'Con token de sitio solo AGENT.md y keywords.md. Voz, estilo, image-guide e image-spec son solo super-admin.',
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
      name: 'blog_upload_media_file',
      description:
        'Plan A. Adjunta el PNG en file si esta tool es invocable. Si no aparece en el set de tools, usa blog_upload_media (plan B/C). ChatGPT rellena download_url. El CMS descarga. No hagas curl ni PUT. kind: post, social o reference.',
      inputSchema: {
        type: 'object',
        $defs: openaiFileDefs(),
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'Nombre kebab-case. Portada mi-post.png. Slide {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          alt: { type: 'string' },
          file: { $ref: '#/$defs/OpenAIFile' }
        },
        required: ['site', 'filename', 'file']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: {
        ...connectorFileMeta(),
        'openai/toolInvocation/invoking': 'Subiendo la imagen',
        'openai/toolInvocation/invoked': 'Imagen guardada'
      }
    },
    {
      name: 'blog_open_image_drop',
      description:
        'Solo si el host puede hacer HTTP PUT. El sandbox de ChatGPT no resuelve DNS. ChatGPT debe usar blog_upload_media_file. kind: post, social o reference.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'Nombre kebab-case. Portada mi-post.png. Slide {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          alt: { type: 'string' }
        },
        required: ['site', 'filename']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_upload_media',
      description:
        'Plan B/C. Úsala al momento si blog_upload_media_file no es invocable o falla. Pasa contentBase64 o blob. Si el host recorta o rechaza, uploadId + chunkIndex + chunkCount. No pares a preguntar. PROHIBIDO curl, PUT y /mnt/data. kind: post, social o reference.',
      inputSchema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          site: { type: 'string' },
          filename: {
            type: 'string',
            description: 'kebab-case. Portada mi-post.png. Slide Instagram {slug}-ig-01.png'
          },
          kind: {
            type: 'string',
            description: 'post = portada. social = carrusel Instagram. reference = moodboard.'
          },
          contentBase64: {
            type: 'string',
            description: 'PNG o JPG en base64. Camino normal. 2-3 MB valen.'
          },
          alt: { type: 'string' },
          imageUrl: {
            type: 'string',
            description: 'Solo si ya tienes un https público real. No uses /mnt/data.'
          },
          blob: {
            type: 'string',
            description: 'Alias de contentBase64'
          },
          filePath: {
            type: 'string',
            description: 'Solo si el archivo existe en el servidor del CMS. En ChatGPT remoto no existe /mnt/data.'
          },
          uploadId: { type: 'string', description: 'Id de la subida a trozos' },
          chunkIndex: { type: 'string', description: 'Número de trozo desde 0, en texto' },
          chunkCount: { type: 'string', description: 'Total de trozos, en texto' }
        },
        required: ['site', 'filename']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_remote_image',
      description:
        'SOLO si ya tienes una URL https pública real. Si la foto está en el chat, usa blog_upload_media_file. Esta tool no sirve para PNG del sandbox.',
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
          kind: {
            type: 'string',
            enum: ['post', 'social', 'reference'],
            description: 'post, social o reference'
          }
        },
        required: ['site', 'filename', 'imageUrl']
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
    },
    {
      name: 'blog_import_brand_zip',
      description:
        'Importa un ZIP de brand kit. Solo super-admin. Para el ZIP grande usa zipUrl https.',
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
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      adminOnly: true
    }
  ]

  return tools
    .filter((t) => !CMS_AI_TOOLS.has(t.name))
    .filter((t) => !(t.adminOnly && auth?.role !== 'admin'))
    .filter((t) => !(auth?.role === 'client_mcp' && t.name === 'blog_update_brand_file'))
    .map(({ adminOnly, ...rest }) => rest)
}

/**
 * @param {{ role: 'admin' } | { role: 'site', site: string }} [auth]
 */
export function createMcpServer(auth = { role: 'admin' }, { restrictMutations = false, source = 'mcp' } = {}) {
  const server = new Server(
    { name: 'escarlet-blog-cms', version: MCP_SERVER_VERSION, title: 'Escarlet Blog CMS' },
    { capabilities: { tools: {}, resources: {} }, instructions: MCP_INSTRUCTIONS }
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
        if ((auth?.role === 'site' || auth?.role === 'client') && isSecretBrandFile(file)) continue
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
    const data = await cms.getBrandFile(site, file, { auth })
    const mimeType = file.endsWith('.json') ? 'application/json' : 'text/markdown'
    let text = data.content || ''
    if (file === 'AGENT.md') {
      text = withMediaUploadContract(text)
    }
    return {
      contents: [{ uri: request.params.uri, mimeType, text }]
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => withGenerationPolicy({ externalMcp: !['app', 'chat'].includes(source), auth }, async () => {
    const { name, arguments: args = {} } = request.params
    try {
      if (CMS_AI_TOOLS.has(name)) {
        assertCmsAiAllowed(auth)
        throw Object.assign(new Error('Usa el servicio interno de generación de /app, no una herramienta MCP.'), { status: 403 })
      }
      // Every transport shares the same argument boundary. The optional
      // mutation restriction is enabled only for app/chat bridges; the
      // authenticated external MCP transport keeps its explicit workflow.
      assertSafeToolArguments(name, args, { source })
      if (restrictMutations) assertChatToolAllowed(name, args)
      const tool = buildToolList(auth).find((t) => t.name === name)
      if (!tool) throw Object.assign(new Error('Herramienta no disponible para este acceso.'), { status: 403 })
      if (BLOG_CONTENT_TOOLS.has(name)) {
        const site = resolveToolSite(auth, args)
        if (isSocialMediaOnlySite(loadSiteConfig(site))) {
          throw Object.assign(new Error('Este sitio está configurado como solo Social Media. Usa las herramientas de Social Pack.'), { status: 404 })
        }
      }
      if (args.slug && !['blog_create_draft', 'blog_upload_media', 'blog_upload_media_file', 'blog_open_image_drop', 'blog_import_remote_image'].includes(name)) {
        const site = resolveToolSite(auth, args)
        const { post } = await cms.getPost(site, args.originalSlug || args.slug)
        assertPostAccess(post, auth, { write: !tool.annotations?.readOnlyHint })
      }
      switch (name) {
        case 'blog_list_authors': {
          const site = resolveToolSite(auth, args)
          return textResult({ authors: listSiteAuthors({ site, requesterId: auth.userId, requesterRole: auth.role }) })
        }
        case 'social_save_pack': {
          const site = resolveToolSite(auth, args)
          return textResult({
            pack: saveStandaloneSocialPack({
              ...args,
              site,
              actorId: auth.userId || auth.email || auth.role
            })
          })
        }
        case 'social_list_packs': {
          const site = resolveToolSite(auth, args)
          return textResult({ site, packs: listStandaloneSocialPacks(site) })
        }
        case 'social_get_pack': {
          const site = resolveToolSite(auth, args)
          const pack = getStandaloneSocialPack(site, args.id)
          if (!pack) throw Object.assign(new Error('Social Pack no encontrado.'), { status: 404 })
          return textResult({ pack })
        }
        case 'blog_save_social_pack': {
          const site = resolveToolSite(auth, args)
          if (!args.socialPack || typeof args.socialPack !== 'object' || Array.isArray(args.socialPack)) throw Object.assign(new Error('Falta socialPack.'), { status: 400 })
          return textResult(await cms.updatePost({ site, slug: args.slug, socialPack: args.socialPack, keepPublished: true, direct: true, membershipUserId: auth.userId || '' }))
        }
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
          const handle = isSiteScopedRole(auth.role) ? auth.site : args.site || DEFAULT_SITE
          if (isSiteScopedRole(auth.role)) assertSiteAccess(auth, handle)
          const config = loadSiteConfig(handle)
          if (isSocialMediaOnlySite(config)) {
            return textResult({
              site: { handle, name: args.name || config?.name, domain: args.domain || config?.domain },
              socialPackOnly: true,
              message: 'Este sitio usa únicamente Social Pack. No hay flujo de posts de blog.'
            })
          }
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
        case 'blog_get_workflow': {
          const site = resolveToolSite(auth, args)
          const mode = args.mode === 'guided' ? 'guided' : args.mode === 'easy' ? 'easy' : 'choose'
          const workflowDb = readDb()
          const cmsAiEnabled = isCmsAiEnabled({ db: workflowDb })
          const workflow = getWorkflowFlags(workflowDb)
          return textResult(workflowPayload({
            site, mode, enabled: true, generationEngine: 'chatgpt', cmsAiAllowed: false,
            assistantEnabled: cmsAiEnabled && workflow.assistantEnabled,
            blogWizardEnabled: cmsAiEnabled && workflow.blogWizardEnabled,
            appBaseUrl: appUrl('/'),
            routes: { preview: appUrl('/preview/{slug}'), posts: `${appUrl('/posts')}?site=${encodeURIComponent(site)}` },
            askUser: '¿Prefieres el flujo simple o revisar e iterar el borrador con el flujo guiado?',
            steps: ['Consulta blog_get_brand_context y blog_list_authors.', 'Genera en ChatGPT textos e imágenes respetando el brand kit.', 'Crea con blog_create_draft, sube los medios y completa los campos con blog_update_post.', 'En guided entrega appPreviewUrl y aplica las correcciones.', 'Solicita confirmación y usa blog_publish o blog_schedule_post.', 'Solo si se solicita, genera en ChatGPT el Social Pack y guárdalo con blog_save_social_pack.'],
            modes: { easy: { steps: ['Genera todo en ChatGPT', 'Guarda medios y campos', 'Confirma y publica con direct=true'] }, guided: { steps: ['Guarda el borrador', 'Revisa en /app', 'Publica con direct=true'] } },
            appUrl: `${appUrl('/posts')}?site=${encodeURIComponent(site)}`,
            rule: 'Nunca llames APIs de IA del CMS. Si no puedes transferir una imagen, conserva el borrador y pide carga manual.'
          }, source))
        }
        case 'blog_create_site':
          assertSuperAdmin(auth)
          return textResult(await cms.createSiteRecord(args))
        case 'blog_list_posts': {
          const site = resolveToolSite(auth, args)
          const result = await cms.listPosts(site, args.status)
          return textResult({ ...result, posts: result.posts.filter((p) => canReadPost(p, auth, site)) })
        }
        case 'blog_get_post': {
          const site = resolveToolSite(auth, args)
          return textResult(workflowPayload({ ...await cms.getPost(site, args.slug), appPreviewUrl: `${appUrl(`/preview/${encodeURIComponent(args.slug)}`)}?site=${encodeURIComponent(site)}` }, source))
        }
        case 'blog_get_quota': {
          const site = resolveToolSite(auth, args)
          return textResult(cms.getQuotaSnapshot(site, { userId: auth.userId || '' }))
        }
        case 'blog_create_draft': {
          const site = resolveToolSite(auth, args)
          return textResult(
            await cms.createDraft({
              ...safePostFields(args, auth, site),
              site,
              ownerId: auth.userId || '',
              membershipUserId: auth.userId || '',
              skipQuota: true,
              contentSource: args.contentSource || (['client', 'client_mcp'].includes(auth.role) ? 'client' : 'agency')
            })
          )
        }
        case 'blog_update_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updatePost({ ...safePostFields(args, auth, site), site, direct: true, keepPublished: true, membershipUserId: auth.userId || '' }))
        }
        case 'blog_unpublish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.unpublishPost(site, args.slug, { membershipUserId: auth.userId || '' }))
        }
        case 'blog_delete_post': {
          const site = resolveToolSite(auth, args)
          if (args.confirm !== true) {
            throw Object.assign(new Error('Para eliminar, pasa confirm: true'), { status: 400 })
          }
          return textResult(await cms.deletePost(site, args.slug, { membershipUserId: auth.userId || '' }))
        }
        case 'blog_validate_seo': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.validateSeo(site, args.slug))
        }
        case 'blog_publish': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.publishPost(site, args.slug, {
            publishAt: args.publishAt,
            direct: directWorkflowPublish(args, source),
            ignoreSeo: args.ignoreSeo === true,
            skipQuota: true,
            membershipUserId: auth.userId || ''
          }))
        }
        case 'blog_request_changes': {
          const site = resolveToolSite(auth, args)
          return textResult(
            await cms.requestPostChanges(site, args.slug, {
              rejectReason: args.rejectReason,
              actor: { role: auth.role }
            })
          )
        }
        case 'blog_schedule_post': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.schedulePostForDate(site, args.slug, args.publishAt, {
            direct: directWorkflowPublish(args, source),
            ignoreSeo: args.ignoreSeo === true,
            skipQuota: true,
            membershipUserId: auth.userId || ''
          }))
        }
        case 'blog_confirm_schedule': {
          assertSuperAdmin(auth)
          const site = resolveToolSite(auth, args)
          return textResult(await cms.confirmSchedule(site, args.slug, { skipQuota: true, membershipUserId: auth.userId || '' }))
        }
        case 'blog_cancel_schedule': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.cancelSchedule(site, args.slug, { membershipUserId: auth.userId || '' }))
        }
        case 'blog_list_calendar': {
          const site = resolveToolSite(auth, args)
          const result = await cms.listCalendarPosts(site, args.from, args.to)
          return textResult({ ...result, posts: result.posts.filter((p) => canReadPost(p, auth, site)) })
        }
        case 'blog_get_seo_context': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getSeoContext(site))
        }
        case 'blog_get_brand_context': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.getBrandContext(site, { auth }))
        }
        case 'blog_update_brand_file': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.updateBrandFile(site, args.file, args.content, { auth }))
        }
        case 'blog_upload_media_file': {
          const site = resolveToolSite(auth, args)
          if (!args.file) {
            throw Object.assign(
              new Error(
                'Falta file. Adjunta el PNG en el argumento file. Si el host no adjunta archivos, usa blog_upload_media con contentBase64. No hagas curl ni PUT.'
              ),
              { status: 400 }
            )
          }
          return textResult(await cms.uploadMedia({ ...args, site, membershipUserId: auth.userId || '' }))
        }
        case 'blog_open_image_drop': {
          const site = resolveToolSite(auth, args)
          return textResult(cms.openImageDrop({ ...args, site, membershipUserId: auth.userId || '' }))
        }
        case 'blog_upload_media': {
          const site = resolveToolSite(auth, args)
          return textResult(await cms.uploadMedia({ ...args, site, membershipUserId: auth.userId || '' }))
        }
        case 'blog_import_remote_image': {
          const site = resolveToolSite(auth, args)
          if (!args.imageUrl) {
            throw Object.assign(
              new Error('Esta tool no sirve para /mnt/data. Usa blog_upload_media_file y adjunta el PNG en file.'),
              { status: 400 }
            )
          }
          return textResult(await cms.uploadMedia({ ...args, site, contentBase64: undefined, membershipUserId: auth.userId || '' }))
        }
        case 'blog_import_brand_zip': {
          assertSuperAdmin(auth)
          const site = resolveToolSite(auth, args)
          if (!args.zipUrl && !args.contentBase64) {
            throw Object.assign(new Error('Pasa zipUrl (preferido) o contentBase64'), { status: 400 })
          }
          return textResult(await cms.importBrandZip(site, args, { auth }))
        }
        default:
          throw new Error(`Tool desconocida: ${name}`)
      }
    } catch (err) {
      return errorResult(err)
    }
  }))

  return server
}

/**
 * In-process bridge for the PWA. It invokes the exact same MCP tools and
 * permission checks as Streamable HTTP, without creating a second action layer.
 * Keeping this bridge here makes /app and external MCP clients share one
 * contract while the transport remains private to the HTTP handler.
 */
export async function invokeMcpTool(
  name,
  args = {},
  auth = { role: 'admin' },
  { restrictMutations = false, source = 'bridge' } = {}
) {
  const server = createMcpServer(auth, { restrictMutations, source })
  const handler = server._requestHandlers.get('tools/call')
  if (typeof handler !== 'function') throw new Error('El servidor MCP no registró tools/call.')
  return handler({ method: 'tools/call', params: { name, arguments: args } })
}
