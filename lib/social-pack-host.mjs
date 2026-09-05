/**
 * CMS-canonical Social Pack host (product-restructure F2).
 * Prefer CMS payloads over Vite-generated /admin/blog-packs artifacts.
 * Legacy generator: templates/frontend/generate-blog-social-packs.mjs
 */
import { getCanonicalUrl, getSocialPackChannels } from './site-config.mjs'
import { isProductRestructureV1 } from './product-flags.mjs'

export const PACK_SOURCE_CMS = 'cms'
export const PACK_SOURCE_VITE = 'vite'

/** Filename kept on disk for dual-run / local cache; removed from RUNTIME_FILES. */
export const LEGACY_PACK_GENERATOR = 'generate-blog-social-packs.mjs'

export function isCmsSocialPackHostEnabled() {
  return isProductRestructureV1()
}

/**
 * Precedence: CMS wins when enabled; Vite may remain legacy until landings drop it.
 * @param {{ cmsHostEnabled?: boolean, viteLegacyAvailable?: boolean }} [opts]
 * @returns {'cms'|'vite'|null}
 */
export function resolveSocialPackSource(opts = {}) {
  const cms = Object.prototype.hasOwnProperty.call(opts, 'cmsHostEnabled')
    ? Boolean(opts.cmsHostEnabled)
    : isCmsSocialPackHostEnabled()
  const viteLegacy =
    opts.viteLegacyAvailable === undefined ? true : Boolean(opts.viteLegacyAvailable)
  if (cms) return PACK_SOURCE_CMS
  if (viteLegacy) return PACK_SOURCE_VITE
  return null
}

export function normalizeSocialPack(socialPack, title = '') {
  const raw = socialPack && typeof socialPack === 'object' ? socialPack : {}
  const slides = Array.isArray(raw.instagramSlides)
    ? raw.instagramSlides
        .map((slide) => ({
          imageUrl: String(slide?.imageUrl || '').trim(),
          alt: String(slide?.alt || '').trim(),
          headline: String(slide?.headline || '').trim(),
          body: String(slide?.body || '').trim()
        }))
        .filter((slide) => slide.imageUrl || slide.headline || slide.body)
    : []
  return {
    substackTitle: String(raw.substackTitle || title || '').trim(),
    substackBody: String(raw.substackBody || '').trim(),
    linkedin: String(raw.linkedin || '').trim(),
    x: String(raw.x || '').trim(),
    videoScript: String(raw.videoScript || '').trim(),
    instagramCaption: String(raw.instagramCaption || '').trim(),
    instagramSlides: slides
  }
}

export function hasSocialPackContent(post, channels) {
  const pack = post?.socialPack || {}
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  const ch = channels || {}
  return Boolean(
    (ch.substack && (pack.substackBody || pack.substackTitle)) ||
      (ch.linkedin && pack.linkedin) ||
      (ch.x && pack.x) ||
      (ch.videoScript && pack.videoScript) ||
      (ch.instagramCarousel && (pack.instagramCaption || slides.length))
  )
}

function channelsPresent(pack, channels) {
  const slides = Array.isArray(pack.instagramSlides) ? pack.instagramSlides : []
  return {
    substack: Boolean(channels.substack && (pack.substackBody || pack.substackTitle)),
    linkedin: Boolean(channels.linkedin && pack.linkedin),
    x: Boolean(channels.x && pack.x),
    videoScript: Boolean(channels.videoScript && pack.videoScript),
    instagramCarousel: Boolean(
      channels.instagramCarousel && (pack.instagramCaption || slides.length)
    )
  }
}

/**
 * Canonical CMS Social Pack payload for one post.
 * @returns {object|null} null when post has no pack content for enabled channels
 */
export function buildSocialPackPayload(post, siteConfig, options = {}) {
  if (!post) return null
  const channels = getSocialPackChannels(siteConfig)
  if (!hasSocialPackContent(post, channels) && !options.includeEmpty) return null
  const socialPack = normalizeSocialPack(post.socialPack, post.title)
  const present = channelsPresent(socialPack, channels)
  const source = resolveSocialPackSource({
    cmsHostEnabled: options.cmsHostEnabled,
    viteLegacyAvailable: options.viteLegacyAvailable
  })
  return {
    source: source || PACK_SOURCE_CMS,
    site: post.site,
    slug: post.slug,
    title: post.title || '',
    status: post.status || '',
    authorName: post.authorName || '',
    datePublished: post.datePublished || '',
    imageUrl: post.imageUrl || '',
    imageAlt: post.imageAlt || '',
    articleUrl: siteConfig ? getCanonicalUrl(siteConfig, post.slug) : '',
    socialPackChannels: channels,
    socialPack,
    channelsPresent: present
  }
}

export function listSocialPackSummaries(posts, siteConfig, options = {}) {
  const channels = getSocialPackChannels(siteConfig)
  const source = resolveSocialPackSource({
    cmsHostEnabled: options.cmsHostEnabled,
    viteLegacyAvailable: options.viteLegacyAvailable
  })
  return (posts || [])
    .filter((post) => hasSocialPackContent(post, channels))
    .map((post) => {
      const socialPack = normalizeSocialPack(post.socialPack, post.title)
      return {
        source: source || PACK_SOURCE_CMS,
        site: post.site,
        slug: post.slug,
        title: post.title || '',
        status: post.status || '',
        authorName: post.authorName || '',
        datePublished: post.datePublished || '',
        imageUrl: post.imageUrl || '',
        imageAlt: post.imageAlt || '',
        channelsPresent: channelsPresent(socialPack, channels)
      }
    })
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Lightweight CMS-hosted pack page (copy-first). Uses admin design tokens.
 */
export function renderSocialPackPageHtml(payload) {
  if (!payload) return ''
  const pack = payload.socialPack || {}
  const present = payload.channelsPresent || {}
  const blocks = []

  if (present.substack) {
    blocks.push(channelCard('Substack', [
      fieldBlock('Título', pack.substackTitle, 'substack-title'),
      fieldBlock('Cuerpo', pack.substackBody, 'substack-body')
    ].join('\n')))
  }
  if (present.linkedin) {
    blocks.push(channelCard('LinkedIn', fieldBlock('Post', pack.linkedin, 'linkedin')))
  }
  if (present.x) {
    blocks.push(channelCard('X', fieldBlock('Tuit', pack.x, 'x-post')))
  }
  if (present.videoScript) {
    blocks.push(channelCard('Guion de vídeo', fieldBlock('Guion', pack.videoScript, 'video-script')))
  }
  if (present.instagramCarousel) {
    const slides = (pack.instagramSlides || [])
      .map(
        (slide, i) => `<figure class="pack-slide">
  ${slide.imageUrl ? `<img src="${escapeHtml(slide.imageUrl)}" alt="${escapeHtml(slide.alt || '')}" loading="lazy" />` : ''}
  <figcaption>
    <strong>Slide ${i + 1}</strong>
    ${slide.headline ? `<p>${escapeHtml(slide.headline)}</p>` : ''}
    ${slide.body ? `<p>${escapeHtml(slide.body)}</p>` : ''}
  </figcaption>
</figure>`
      )
      .join('\n')
    blocks.push(
      channelCard(
        'Instagram',
        [
          fieldBlock('Caption', pack.instagramCaption, 'ig-caption'),
          slides ? `<div class="pack-slides">${slides}</div>` : ''
        ].join('\n')
      )
    )
  }

  const media = payload.imageUrl
    ? `<aside class="pack-media card">
  <h2>Imagen</h2>
  <img src="${escapeHtml(payload.imageUrl)}" alt="${escapeHtml(payload.imageAlt || payload.title)}" />
  <p class="muted">${escapeHtml(payload.imageAlt || '')}</p>
  <div class="actions">
    <a class="btn btn-primary" href="${escapeHtml(payload.imageUrl)}" target="_blank" rel="noopener noreferrer">Abrir imagen</a>
  </div>
</aside>`
    : ''

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Social Pack · ${escapeHtml(payload.title)}</title>
  <link rel="stylesheet" href="/admin.css" />
  <style>
    .pack-page { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    .pack-page .eyebrow { font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0 0 0.4rem; }
    .pack-layout { display: grid; gap: 1rem; grid-template-columns: 1fr; }
    @media (min-width: 860px) { .pack-layout { grid-template-columns: 1.4fr 0.8fr; align-items: start; } }
    .pack-channel { margin-bottom: 1rem; }
    .pack-field { margin: 0 0 0.85rem; }
    .pack-field pre { white-space: pre-wrap; word-break: break-word; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; margin: 0.35rem 0 0.5rem; font: inherit; font-size: 0.9rem; }
    .pack-slides { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .pack-slide img { width: 100%; height: auto; border-radius: 8px; display: block; }
    .pack-media img { width: 100%; border-radius: 8px; }
    .pack-source { display: inline-block; margin-top: 0.35rem; font-size: 0.8rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="pack-page pico">
    <p class="eyebrow">Social Pack · CMS</p>
    <h1>${escapeHtml(payload.title)}</h1>
    <p class="muted">${escapeHtml(payload.authorName || '')} · ${escapeHtml(payload.datePublished || '')}</p>
    ${
      payload.articleUrl
        ? `<p><a href="${escapeHtml(payload.articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(payload.articleUrl)}</a></p>`
        : ''
    }
    <span class="pack-source">Fuente · ${escapeHtml(payload.source || PACK_SOURCE_CMS)}</span>
    <div class="pack-layout" style="margin-top:1.25rem">
      <div>${blocks.join('\n') || '<p class="muted">Sin canales con contenido.</p>'}</div>
      ${media}
    </div>
  </div>
  <script>
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-copy')
        var el = document.getElementById(id)
        if (!el) return
        try {
          await navigator.clipboard.writeText(el.textContent || '')
          btn.textContent = 'Copiado'
          setTimeout(function () { btn.textContent = 'Copiar' }, 1200)
        } catch (e) {}
      })
    })
  </script>
</body>
</html>`
}

function fieldBlock(label, text, id) {
  return `<div class="pack-field">
  <label>${escapeHtml(label)}</label>
  <pre id="${escapeHtml(id)}">${escapeHtml(text || '')}</pre>
  <button type="button" class="btn" data-copy="${escapeHtml(id)}">Copiar</button>
</div>`
}

function channelCard(title, inner) {
  return `<section class="card pack-channel">
  <h2 class="card-title">${escapeHtml(title)}</h2>
  ${inner}
</section>`
}

export function renderSocialPackIndexHtml(summaries, { siteLabel = '' } = {}) {
  const rows = (summaries || []).length
    ? summaries
        .map(
          (item) => {
            const chips = Object.entries(item.channelsPresent || {})
              .filter(([, on]) => on)
              .map(([key]) => key)
              .join(', ')
            const cover = item.imageUrl
              ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block;border-radius:10px 10px 0 0" />`
              : `<div style="width:100%;aspect-ratio:16/10;background:linear-gradient(145deg,#dceee4,#e8e4dc);border-radius:10px 10px 0 0"></div>`
            return `<li class="card" style="list-style:none;padding:0;overflow:hidden;max-width:320px">
  <a href="/admin/blog-packs/${encodeURIComponent(item.slug)}?site=${encodeURIComponent(item.site || '')}" style="color:inherit;text-decoration:none">
    ${cover}
    <div style="padding:0.9rem 1rem 1rem">
      <strong>${escapeHtml(item.title)}</strong>
      <p class="muted" style="margin:0.35rem 0 0">${escapeHtml(item.datePublished || '')} · ${escapeHtml(chips)}</p>
    </div>
  </a>
</li>`
          }
        )
        .join('\n')
    : '<li class="muted">Aún no hay Social Packs con contenido.</li>'

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Social Pack · ${escapeHtml(siteLabel || 'CMS')}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/admin.css" />
</head>
<body>
  <div class="pack-page pico" style="max-width:960px;margin:0 auto;padding:1.5rem 1rem 3rem">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem">
      <img src="/favicon.svg" alt="" width="36" height="36" />
      <div>
        <p class="eyebrow" style="margin:0;font-size:0.75rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Social Pack · CMS</p>
        <h1 style="margin:0.15rem 0 0">Packs de redes${siteLabel ? ` · ${escapeHtml(siteLabel)}` : ''}</h1>
      </div>
    </div>
    <p class="muted">Servidos desde el CMS. Elige un pack para copiar textos y piezas.</p>
    <ul style="padding:0;margin:1.25rem 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem">${rows}</ul>
  </div>
</body>
</html>`
}
