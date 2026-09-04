/**
 * Playbook de onboarding multi-sitio (humano + MCP).
 * Un solo CMS central. Cada web es un {handle} con su brand kit y webhook.
 */

export const CMS_PUBLIC_URL_DEFAULT = 'https://blog-cms.escarlet.cc'

/**
 * @param {{ handle?: string, domain?: string, name?: string, cmsUrl?: string }} [opts]
 */
export function getOnboardingPlaybook(opts = {}) {
  const handle = String(opts.handle || '{handle}').trim() || '{handle}'
  const name = String(opts.name || handle).trim()
  const domain = String(opts.domain || 'https://tu-dominio.com').replace(/\/$/, '')
  const cmsUrl = String(opts.cmsUrl || process.env.CMS_PUBLIC_URL || CMS_PUBLIC_URL_DEFAULT).replace(
    /\/$/,
    ''
  )

  return {
    summary:
      'CMS central white-label. Creas un site (handle), conectas el frontend con sync + env, y pegas el Deploy Webhook de Coolify en el dashboard. Los posts viven en el CMS. El agente publica por MCP. El frontend solo hace pull en build.',
    architecture: {
      cms: cmsUrl,
      mcp: `${cmsUrl}/mcp`,
      mcpChatGpt: `${cmsUrl}/mcp`,
      admin: `${cmsUrl}/admin`,
      publicApi: `${cmsUrl}/api/sites/${handle}/posts`,
      flow: [
        'Agente → MCP (blog_* tools)',
        'CMS guarda posts + media + brand kit',
        'blog_publish → POST Deploy Webhook Coolify del frontend',
        'Build del frontend → sync-blog-cms.mjs descarga posts published'
      ]
    },
    site: { handle, name, domain },
    phases: [
      {
        id: 'cms-site',
        title: '1. Dar de alta el site en el CMS',
        steps: [
          `CLI local. npm run site:init -- --handle ${handle} --name "${name}" --domain ${domain}`,
          `O MCP. blog_create_site con handle, name, domain (y webhook si ya lo tienes)`,
          'Rellena el brand kit (voice, visual-style, image-guide, keywords, AGENT.md) en /admin → Brand kit o con blog_update_brand_file',
          'Sube 2–4 fotos de referencia (moodboard) con kind=reference'
        ]
      },
      {
        id: 'frontend',
        title: '2. Conectar el proyecto web (Vue/Vite u otro)',
        steps: [
          `Copia templates/frontend/sync-blog-cms.mjs a scripts/ del proyecto web`,
          'Añade el sync al prebuild o al inicio del build (node scripts/sync-blog-cms.mjs && …)',
          'Exporta posts desde src/data/blog.generated.js (o adapta la ruta OUT_FILE)',
          'Mantén un fallback vacío o mínimo para builds offline',
          'Añade src/data/blog.generated.js al .gitignore',
          'Copia templates/frontend/generate-blog-social-packs.mjs (env BLOG_SITE_URL / BLOG_PACKS_*)',
          'En package.json. blog:packs + en build. sync && blog:packs && …',
          'Copia templates/frontend/blog-social-packs.mdc al proyecto',
          'robots.txt Disallow /admin. Salida public/admin/blog-packs/',
          `Coolify (app del frontend). BLOG_CMS_URL=${cmsUrl} y BLOG_CMS_SITE=${handle}`,
          `Opcional. BLOG_SITE_URL=${domain}`
        ]
      },
      {
        id: 'coolify-webhook',
        title: '3. Webhook de deploy Coolify (contenido → rebuild)',
        steps: [
          'En Coolify abre la app del FRONTEND (la web pública, no el CMS)',
          'Webhooks → Deploy Webhook (auth required). Copia la URL',
          'Copia también un API token de Coolify con permiso Deploy',
          `CMS /admin → tab Sitio (site ${handle}) → pega Deploy webhook + Token API Coolify`,
          'Pulsa Probar webhook. Tiene que responder OK',
          'Al publicar un post, el CMS hace POST al webhook y Coolify reconstruye la web'
        ],
        notes: [
          'Git push = cambios de código. Webhook = solo contenido del blog.',
          'Usa el webhook de la app de producción del cliente, no una preview suelta.',
          'Formato típico. https://coolify.escarlet.cc/api/v1/deploy?uuid=... (sin force=false. En Coolify 4.1 ese string dispara un build sin caché)'
        ]
      },
      {
        id: 'agents',
        title: '4. Cursor / Hermes / ChatGPT / Claude',
        steps: [
          `MCP escarlet-blog → url ${cmsUrl}/mcp + Authorization Bearer ADMIN_TOKEN (o token de sitio)`,
          `ChatGPT (Developer Mode). Conectores → Create → URL ${cmsUrl}/mcp → autenticación OAuth. Al autorizar pega el token de sitio o ADMIN_TOKEN`,
          `Claude. Customize → Connectors → Add custom connector → URL ${cmsUrl}/mcp → autenticación OAuth. Al autorizar pega el token de sitio o ADMIN_TOKEN`,
          'Icono del conector. Usa el PNG del favicon del sitio (menos de 10 KB) que genera el dashboard al crear el token de cliente',
          `Copia templates/frontend/blog-via-mcp.mdc al proyecto web y cambia el handle a ${handle}`,
          'Antes de redactar. blog_get_brand_context',
          'Crear. blog_create_draft → blog_update_post → blog_validate_seo → blog_publish',
          'Editar. blog_get_post + blog_update_post (mismo slug). Nunca create_draft para editar'
        ]
      },
      {
        id: 'verify',
        title: '5. Comprobar el flujo',
        steps: [
          'Publica un borrador de prueba (dashboard o MCP)',
          'Confirma que Coolify dispara rebuild del frontend',
          `Abre ${domain}/blog/{slug} tras el deploy`,
          `Abre ${domain}/admin/blog-packs/{slug} si el post tiene socialPack`,
          `GET ${cmsUrl}/api/sites/${handle}/posts debe listar el post published`
        ]
      }
    ],
    agentContentWorkflow: {
      create: [
        'blog_get_brand_context',
        'Pregunta al humano lo de postFields',
        'blog_create_draft (solo slug nuevo)',
        'blog_update_post (body, metas, socialPack según socialPackChannels; Instagram con slides subidas)',
        'blog_upload_media (kind post o social). contentBase64 o blob con el PNG completo. 2–3 MB valen. Si recorta, uploadId a trozos. El CMS comprime a JPEG',
        'blog_validate_seo',
        'blog_publish → review o published según requiresHumanApproval',
        'Comparte previewUrl absoluto al humano',
        'Tras rebuild del frontend. indica https://dominio/admin/blog-packs/{slug}'
      ],
      edit: [
        'blog_get_brand_context',
        'blog_list_posts / blog_get_post',
        'blog_update_post con el mismo slug (o originalSlug + slug si renombras)',
        'Con aprobación humana, un published baja a review al editar'
      ],
      forbidden: [
        'Commitear posts editoriales al git del frontend',
        'Usar blog_create_draft para editar un post existente',
        'Pasar /mnt/data, sandbox: o file:// como imageUrl (leer el archivo y enviar contentBase64 o trozos)',
        'Enviar contentBase64 recortado. Si pasa, usa uploadId con chunkIndex y chunkCount'
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
      syncScript: 'templates/frontend/sync-blog-cms.mjs',
      cursorRule: 'templates/frontend/blog-via-mcp.mdc',
      siteSeed: 'templates/site/',
      docs: 'docs/ONBOARDING.md'
    },
    relatedDocs: ['docs/ONBOARDING.md', 'docs/DEPLOY.md', 'docs/HANDOFF.md', '.cursor/skills/escarlet-blog-cms/SKILL.md']
  }
}

export function renderOnboardingMarkdown(playbook = getOnboardingPlaybook()) {
  const lines = [
    `# Onboarding Blog CMS — ${playbook.site.handle}`,
    '',
    playbook.summary,
    '',
    '## Arquitectura',
    '',
    `- CMS. ${playbook.architecture.cms}`,
    `- MCP. ${playbook.architecture.mcp}`,
    `- Admin. ${playbook.architecture.admin}`,
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
