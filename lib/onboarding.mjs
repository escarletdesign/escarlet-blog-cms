import { CANONICAL_CMS_URL, canonicalCmsPublicUrl } from './cms-url.mjs'

/**
 * Playbook de onboarding multi-sitio (humano + MCP).
 * Un solo CMS central. Cada web es un {handle} con su brand kit y webhook.
 */

export const CMS_PUBLIC_URL_DEFAULT = CANONICAL_CMS_URL

/**
 * @param {{ handle?: string, domain?: string, name?: string, cmsUrl?: string }} [opts]
 */
export function getOnboardingPlaybook(opts = {}) {
  const handle = String(opts.handle || '{handle}').trim() || '{handle}'
  const name = String(opts.name || handle).trim()
  const domain = String(opts.domain || 'https://tu-dominio.com').replace(/\/$/, '')
  const cmsUrl = canonicalCmsPublicUrl(opts.cmsUrl || process.env.CMS_PUBLIC_URL || CMS_PUBLIC_URL_DEFAULT)

  const playbook = {
    summary:
      'CMS central white-label. Creas un site (handle), conectas el frontend (Vite/SPA o WordPress) y pegas el webhook de rebuild/sync desde /app. Los posts viven en el CMS y el agente trabaja por MCP.',
    architecture: {
      cms: cmsUrl,
      mcp: `${cmsUrl}/mcp`,
      mcpChatGpt: `${cmsUrl}/mcp`,
      app: `${cmsUrl}/app`,
      publicApi: `${cmsUrl}/api/sites/${handle}/posts`,
      embedSession: `${cmsUrl}/api/embed/session`,
      flow: [
        'Agente → MCP (content_* tools)',
        'CMS guarda campañas, publicaciones, variantes, media y brand kit',
        'content_approve → webhook del frontend (Coolify rebuild o sync WordPress)',
        'Vite/SPA. Build → escarlet-blog.mjs baja el contenido sincronizado',
        'WordPress. Plugin sync a posts nativos. Packs y edición en el CMS (SSO desde wp-admin)'
      ]
    },
    site: { handle, name, domain },
    phases: [
      {
        id: 'cms-site',
        title: '1. Dar de alta el site en el CMS',
        steps: [
          `CLI local. npm run site:init -- --handle ${handle} --name "${name}" --domain ${domain}`,
          `O desde la administración de la app v2 crea la marca ${handle}`,
          'Rellena el brand kit (voice, visual-style, image-guide, keywords, AGENT.md) en la app v2',
          'Sube 2–4 fotos de referencia (moodboard) con kind=reference'
        ]
      },
      {
        id: 'frontend',
        title: '2. Conectar el proyecto web (Vue/Vite u otro)',
        steps: [
          `Copia ${cmsUrl}/runtime/v1 (o templates/frontend/escarlet-blog.mjs) a scripts/escarlet-blog.mjs`,
          'Añade wrappers de sync y packs, o llama node scripts/escarlet-blog.mjs al inicio del build',
          'Exporta posts desde src/data/blog.generated.js (o adapta la ruta OUT_FILE)',
          'Mantén un fallback vacío o mínimo para builds offline',
          'Añade src/data/blog.generated.js y .escarlet-blog-runtime/ al .gitignore',
          `Coolify (app del frontend). BLOG_CMS_URL=${cmsUrl} y BLOG_CMS_SITE=${handle}`,
          `Opcional. BLOG_SITE_URL=${domain}`,
          'En el CMS tab Sitio. interruptor Blog en la web pública. Encendido publica /blog. Apagado lo quita en el siguiente rebuild',
          'El look de /blog sigue en esta landing (vista SPA o generate-blog-pages.mjs)',
          'robots.txt Disallow /app. El Social Pack se consulta en el CMS /app por post'
        ]
      },
      {
        id: 'coolify-webhook',
        title: '3. Webhook de deploy Coolify (contenido → rebuild)',
        steps: [
          'En Coolify abre la app del FRONTEND (la web pública, no el CMS)',
          'Webhooks → Deploy Webhook (auth required). Copia la URL',
          'Copia también un API token de Coolify con permiso Deploy',
          `CMS /app/admin → Sitio (site ${handle}) → pega Deploy webhook + Token API Coolify`,
          'Pulsa Probar webhook. Tiene que responder OK',
          'Al publicar un post, el CMS hace POST al webhook y Coolify reconstruye la web'
        ],
        notes: [
          'Git push = cambios de código (con caché). Webhook del CMS = contenido. Va con force=true para no reciclar el dist.',
          'Usa el webhook de la app de producción del cliente, no una preview suelta.',
          'Formato típico. https://coolify.escarlet.cc/api/v1/deploy?uuid=... (pega sin force. El CMS añade force=true al publicar)'
        ]
      },
      {
        id: 'wordpress',
        title: '3b. WordPress (alternativa a Vite/Coolify)',
        steps: [
          'Instala el plugin Escarlet Blog Client en el WordPress del cliente',
          `Ajustes. CMS URL ${cmsUrl}, handle ${handle}, token personal PAT generado en Ajustes`,
          'Copia la URL /wp-json/escarlet-blog/v1/sync y el secreto Bearer al CMS → Sitio (webhook + token)',
          'Probar webhook en el CMS. Debe responder OK y sincronizar posts a /blog',
          'Panel y packs. En wp-admin → Escarlet Blog → Abrir panel Escarlet (SSO a /app). Los packs se usan en el CMS. WP no genera HTML de packs'
        ],
        notes: [
          'Vite y WordPress pueden convivir como frontends distintos (handles distintos). Un solo CMS.',
          'POST /api/embed/session (Bearer PAT personal) crea el enlace de un solo uso que abre /app'
        ]
      },
      {
        id: 'agents',
        title: '4. Cursor / Hermes / ChatGPT / Claude',
        steps: [
          `MCP escarlet-blog → url ${cmsUrl}/mcp + OAuth o Authorization Bearer con tu PAT personal`,
          `ChatGPT (Developer Mode). Conectores → Create → URL ${cmsUrl}/mcp → autenticación OAuth con tu usuario; el rol y las marcas se resuelven en cada solicitud`,
          `Claude. Customize → Connectors → Add custom connector → URL ${cmsUrl}/mcp → autenticación OAuth con tu usuario y sus membresías`,
          'Icono del conector. Usa el PNG del favicon del sitio (menos de 10 KB) que genera /app al crear el token de cliente',
          `Copia templates/frontend/blog-via-mcp.mdc al proyecto web y cambia el handle a ${handle}`,
          'Antes de redactar. brand_list si hay varias marcas y después brand_get_context con el site elegido',
          'Crear. blog_get_workflow → pregunta easy o guided → ChatGPT genera textos e imágenes → blog_create_draft + blog_update_post + subida de medios → confirmación → blog_publish o blog_schedule_post. MCP no genera con APIs del CMS.',
          'Editar. blog_get_post + blog_update_post (mismo slug). Nunca create_draft para editar',
          'Look de /blog. En la landing (vista SPA o generate-blog-pages.mjs + CSS). No en el CMS'
        ]
      },
      {
        id: 'edit',
        title: '5. Cómo se edita (no lo mezcles)',
        steps: [
          'Contenido del post. MCP o dashboard. blog_get_brand_context → update → publish. Nunca commits de artículos al git del frontend',
          'Look de /blog y la ficha. En esta landing. SPA. vistas en src/. HTML estático. generate-blog-pages.mjs + CSS',
          'Encender o apagar. CMS /app/admin → Sitio → interruptor Blog en la web pública. Guardar dispara rebuild. Los posts siguen en el CMS'
        ]
      },
      {
        id: 'verify',
        title: '6. Comprobar el flujo',
        steps: [
          'Publica un borrador de prueba (dashboard o MCP)',
          'Confirma que Coolify dispara rebuild del frontend',
          `Abre ${domain}/blog/{slug} tras el deploy`,
          `Abre ${cmsUrl}/app/social-pack/{slug} si el post tiene socialPack`,
          `GET ${cmsUrl}/api/sites/${handle}/posts debe listar el post published`,
          'Con el interruptor apagado esa lista sale vacía y /blog desaparece del siguiente rebuild'
        ]
      }
    ],
    agentContentWorkflow: {
      create: [
        'brand_get_context',
        'brand_prepare_image_generation',
        'Pregunta al humano si prefiere un flujo guiado o directo',
        'ChatGPT genera contenido y píxeles finales; content_create_batch distingue title de la campaña, items[].title del post e items[].brief del contexto. Antes de crear, lista las campañas y pregunta si se reutiliza una o se crea otra. content_update_item guarda cambios y content_upload_media conserva el archivo con preparationId',
        'Comparte la revisión en la app v2 y espera la confirmación humana antes de aprobar',
        'content_update_item para cambios sobre el mismo itemId',
        'content_approve para aprobar y content_schedule para programar según la acción del usuario',
        'Solo a pedido: ChatGPT genera copy + carrusel, sube cada medio con content_upload_media y actualiza la variante v2; nunca uses APIs de IA del CMS'
      ],
      edit: [
        'brand_get_context',
        'content_list_items / content_get_batch',
        'content_update_item con el mismo itemId',
        'Si editas un published, vuelve a revisión y confirma cuándo aprobarlo de nuevo'
      ],
      forbidden: [
        'Commitear posts editoriales al git del frontend',
        'Usar content_create_batch para editar un item existente',
        'Parar porque content_upload_media no es invocable. Usa su carga por contentBase64 o trozos',
        'Pasar /mnt/data como imageUrl',
        'Enviar contentBase64 recortado sin trocear. Si el host recorta, uploadId + chunkIndex + chunkCount'
      ]
    },
    envCheatSheet: {
      cms: {
        PORT: '3040',
        ADMIN_TOKEN: 'secreto largo',
        DEFAULT_SITE: handle,
        CMS_PUBLIC_URL: cmsUrl
      },
      frontend: {
        BLOG_CMS_URL: cmsUrl,
        BLOG_CMS_SITE: handle,
        BLOG_SITE_URL: domain
      }
    },
    templatePaths: {
      bootstrap: 'templates/frontend/escarlet-blog.mjs',
      runtime: `${cmsUrl}/runtime/v1/manifest.json`,
      syncScript: 'templates/frontend/sync-blog-cms.mjs',
      cursorRule: 'templates/frontend/blog-via-mcp.mdc',
      siteSeed: 'templates/site/',
      docs: 'docs/ONBOARDING.md'
    },
    relatedDocs: ['docs/ONBOARDING.md', 'docs/DEPLOY.md', 'docs/HANDOFF.md', '.cursor/skills/escarlet-blog-cms/SKILL.md']
  }
  const replacements = [
    ['blog_get_brand_context', 'brand_get_context'],
    ['blog_get_workflow', 'content_list_plans'],
    ['blog_list_posts', 'content_list_items'],
    ['blog_get_post', 'content_get_batch'],
    ['blog_create_draft', 'content_create_batch'],
    ['blog_update_post', 'content_update_item'],
    ['blog_publish', 'content_approve'],
    ['blog_request_changes', 'content_update_item'],
    ['blog_schedule_post', 'content_schedule'],
    ['blog_cancel_schedule', 'content_cancel'],
    ['blog_list_calendar', 'content_list_calendar'],
    ['blog_unpublish', 'content_cancel'],
    ['blog_delete_post', 'content_cancel'],
    ['social_save_pack', 'content_create_batch'],
    ['social_list_packs', 'content_list_items'],
    ['social_get_pack', 'content_get_batch'],
    ['blog_save_social_pack', 'content_update_item'],
    ['blog_update_brand_file', 'la gestión del brand kit en la app v2'],
    ['blog_import_brand_zip', 'la importación del brand kit desde la app v2']
  ]
  const normalize = (value) => {
    if (typeof value === 'string') return replacements.reduce((text, [legacy, current]) => text.replaceAll(legacy, current), value)
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
    return value
  }
  return normalize(playbook)
}

export function renderOnboardingMarkdown(playbook = getOnboardingPlaybook()) {
  const lines = [
    `# Onboarding Blog CMS: ${playbook.site.handle}`,
    '',
    playbook.summary,
    '',
    '## Arquitectura',
    '',
    `- CMS. ${playbook.architecture.cms}`,
    `- MCP. ${playbook.architecture.mcp}`,
    `- App. ${playbook.architecture.app}`,
    `- API pública. ${playbook.architecture.publicApi}`,
    '',
    'Flujo.',
    ...playbook.architecture.flow.map((s) => `- ${s}`),
    ''
  ]

  for (const phase of playbook.phases) {
    lines.push(`## ${phase.title}`, '')
    for (const step of phase.steps) lines.push(`- ${step}`)
    if (phase.notes?.length) {
      lines.push('', 'Notas.')
      for (const n of phase.notes) lines.push(`- ${n}`)
    }
    lines.push('')
  }

  lines.push(
    '## Flujo de contenido (agente)',
    '',
    'Crear.',
    ...playbook.agentContentWorkflow.create.map((s) => `- ${s}`),
    '',
    'Editar.',
    ...playbook.agentContentWorkflow.edit.map((s) => `- ${s}`),
    '',
    'Prohibido.',
    ...playbook.agentContentWorkflow.forbidden.map((s) => `- ${s}`),
    ''
  )

  return lines.join('\n')
}
