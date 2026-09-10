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
      'CMS central white-label. Creas un site (handle), conectas el frontend (Vite/SPA o WordPress) y pegas el webhook de rebuild/sync desde /app. Los posts viven en el CMS y el agente trabaja por MCP.',
    architecture: {
      cms: cmsUrl,
      mcp: `${cmsUrl}/mcp`,
      mcpChatGpt: `${cmsUrl}/mcp`,
      app: `${cmsUrl}/app`,
      publicApi: `${cmsUrl}/api/sites/${handle}/posts`,
      embedSession: `${cmsUrl}/api/embed/session`,
      flow: [
        'Agente → MCP (blog_* tools)',
        'CMS guarda posts + media + brand kit',
        'blog_publish → webhook del frontend (Coolify rebuild o sync WordPress)',
        'Vite/SPA. Build → escarlet-blog.mjs baja sync y packs HTML',
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
          `O MCP. blog_create_site con handle, name, domain (y webhook si ya lo tienes)`,
          'Rellena el brand kit (voice, visual-style, image-guide, keywords, AGENT.md) en /app/admin o con blog_update_brand_file',
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
          `Ajustes. CMS URL ${cmsUrl}, handle ${handle}, token de sitio (CMS → Sitio → Generar)`,
          'Copia la URL /wp-json/escarlet-blog/v1/sync y el secreto Bearer al CMS → Sitio (webhook + token)',
          'Probar webhook en el CMS. Debe responder OK y sincronizar posts a /blog',
          'Panel y packs. En wp-admin → Escarlet Blog → Abrir panel Escarlet (SSO a /app). Los packs se usan en el CMS. WP no genera HTML de packs'
        ],
        notes: [
          'Vite y WordPress pueden convivir como frontends distintos (handles distintos). Un solo CMS.',
          'POST /api/embed/session (Bearer site token) crea el enlace de un solo uso que abre /app'
        ]
      },
      {
        id: 'agents',
        title: '4. Cursor / Hermes / ChatGPT / Claude',
        steps: [
          `MCP escarlet-blog → url ${cmsUrl}/mcp + Authorization Bearer ADMIN_TOKEN (o token de sitio)`,
          `ChatGPT (Developer Mode). Conectores → Create → URL ${cmsUrl}/mcp → autenticación OAuth. Al autorizar pega token de usuario, sesión, agencia, sitio o ADMIN_TOKEN; el rol y los sitios quedan acotados al token`,
          `Claude. Customize → Connectors → Add custom connector → URL ${cmsUrl}/mcp → autenticación OAuth. Usa los mismos tokens y permisos acotados`,
          'Icono del conector. Usa el PNG del favicon del sitio (menos de 10 KB) que genera /app al crear el token de cliente',
          `Copia templates/frontend/blog-via-mcp.mdc al proyecto web y cambia el handle a ${handle}`,
          'Antes de redactar. blog_get_brand_context',
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
        'blog_get_brand_context',
        'blog_get_workflow',
        'Pregunta al humano si prefiere easy o guided',
        'ChatGPT genera contenido y portada; blog_create_draft + blog_update_post guardan el contenido y las herramientas de medios guardan las imágenes',
        'En guided. Comparte appPreviewUrl y espera la revisión; en easy pide confirmación antes de publicar',
        'blog_update_post para cambios con el mismo slug',
        'blog_publish con direct: true → published o scheduled según la acción del usuario',
        'Solo a pedido: ChatGPT genera copy + carrusel y blog_save_social_pack los guarda sin APIs de IA del CMS'
      ],
      edit: [
        'blog_get_brand_context',
        'blog_list_posts / blog_get_post',
        'blog_update_post con el mismo slug (o originalSlug + slug si renombras)',
        'Si editas un published y quieres mantenerlo en vivo, usa keepPublished: true; si no, confirma cuándo volver a publicar'
      ],
      forbidden: [
        'Commitear posts editoriales al git del frontend',
        'Usar blog_create_draft para editar un post existente',
        'Parar porque blog_upload_media_file no es invocable. Usa blog_upload_media (B/C)',
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
