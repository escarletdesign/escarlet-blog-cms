import { runGenerateOperation } from './ai-gateway.mjs'
import { generateImageOptions } from './ai-image.mjs'
import { createDraft, getPost, updatePost, uploadMedia } from './cms-ops.mjs'
import { assertSafeAiPrompt } from './ai-security.mjs'
import { normalizeSocialPack } from './social-pack-host.mjs'
import { buildCoverBrief, buildCoverPrompt, chooseSocialTemplate } from './visual-system.mjs'
import { renderSlidePng } from './instagram-renderer.mjs'
import { createHash } from 'node:crypto'
import { issueGenerationReceipt } from './generation-provenance.mjs'

const MAX_TITLE_CHARS = 72

function cleanTitle(value, fallback = 'Nuevo artículo') {
  const title = String(value || '')
    .split(/\r?\n/)[0]
    .replace(/^\s*(?:#+\s*|[-*•]|\d+[.)])\s*/, '')
    .replace(/^(?:t[ií]tulo sugerido|suggested title|propuesta editorial)\s+para\s+[^:]{1,90}:\s*/i, '')
    .replace(/^(?:t[ií]tulo(?: sugerido| propuesto)?|suggested title|propuesta editorial)\s*[:\-]\s*/i, '')
    .replace(/^['"“”]+|['"“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .replace(/[,:;.!?\-\s]+$/, '')
    .trim()
  return title || fallback
}

function plainText(value, max = 12_000) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function socialSources(socialPack, post) {
  const body = plainText(post?.bodyHtml)
  const provided = Array.isArray(socialPack?.instagramSlides) ? socialPack.instagramSlides : []
  if (provided.length) return provided
  return [
    { headline: post?.title, body: post?.excerptEs || body.slice(0, 180) },
    { headline: 'La idea clave', body: body.slice(180, 420) || post?.excerptEs || post?.title },
    { headline: 'Cómo aplicarlo', body: body.slice(420, 660) || post?.title },
    { headline: 'Para recordar', body: body.slice(660, 900) || post?.excerptEs || post?.title }
  ]
}

function withCanonicalArticleUrl(socialPack, articleUrl) {
  const canonical = String(articleUrl || '').trim()
  if (!canonical || !socialPack || typeof socialPack !== 'object') return socialPack
  const next = Object.fromEntries(
    Object.entries(socialPack).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() && !value.includes(canonical)
        ? `${value}\n\n${canonical}`
        : value
    ])
  )
  if (next.instagramStory && typeof next.instagramStory === 'object') {
    next.instagramStory = { ...next.instagramStory, linkUrl: canonical }
  }
  return next
}

export async function generateSocialPackImages({ site, post, socialPack, auth } = {}) {
  const sources = socialSources(socialPack, post)
  const slides = []
  const warnings = []
  const template = chooseSocialTemplate({ site, preferredId: socialPack?.visualSystem?.templateId || '' }) || { id: 'editorial' }
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index] || {}
    const headline = plainText(source.headline || source.title || post?.title, 80) || 'Idea editorial'
    const body = plainText(source.body || source.text, 240)
    const isEdgeSlide = index === 0 || index === sources.length - 1
    try {
      const image = await generateImageOptions({
        auth,
        site,
        prompt: `Crea únicamente un fondo visual para la slide ${index + 1} de ${sources.length} de un carrusel editorial para Instagram. Concepto del slide: ${headline}. No incluyas el texto del slide ni ninguna palabra. Tratamiento obligatorio: ${isEdgeSlide ? 'carbón, cian, oro o bloques cálidos con gradiente suave' : 'fondo blanco, gris o desaturado y evita colores saturados y papel crema'}. Deja zonas respirables para montar tipografía después.`,
        slug: `${post?.slug || 'post'}-carousel-${index + 1}`,
        title: headline,
        alt: headline,
        allowText: false,
        imageRole: 'instagram-carousel-background',
        backgroundStyle: isEdgeSlide ? 'brand-color' : 'light-or-grayscale',
        mediaKind: 'social',
        optionCount: 1,
        persist: false
      })
      const background = image.mediaOptions?.[0]
      const rendered = renderSlidePng({
        site,
        templateId: template.id,
        slide: { headline, body },
        backgroundBase64: background?.contentBase64 || ''
      })
      const receipt = await issueGenerationReceipt({
        site,
        preparationId: background?.brandPreparation?.preparationId,
        usedReferences: background?.generationEvidence,
        generatedResultId: `rendered:${post?.slug || 'post'}:${index + 1}`,
        generatedFileHash: createHash('sha256').update(rendered).digest('hex'),
        assetType: background?.brandPreparation?.assetType,
        route: background?.brandPreparation?.route,
        textRendered: true,
        templateId: template.id,
        renderedBy: 'content-system/instagram-renderer',
        textContent: { headline, body }
      })
      const uploaded = await uploadMedia({
        site,
        filename: `${post?.slug || 'post'}-ig-${String(index + 1).padStart(2, '0')}.png`,
        contentBase64: `data:image/png;base64,${rendered.toString('base64')}`,
        alt: headline,
        kind: 'social',
        requireBrandGrounding: true,
        brandPreparationId: background?.brandPreparation?.preparationId,
        generationReceiptId: receipt.receiptId,
        brandAssetType: background?.brandPreparation?.assetType,
        brandRoute: background?.brandPreparation?.route,
        textRendered: true,
        templateId: template.id,
        renderedBy: 'content-system/instagram-renderer',
        textContent: { headline, body },
        membershipUserId: auth?.userId || ''
      })
      const media = uploaded.media
      slides.push({
        ...source,
        headline,
        body,
        imageUrl: media?.url || media?.path || source.imageUrl || '',
        alt: source.alt || headline,
        backgroundStyle: isEdgeSlide ? 'brand-color' : 'light-or-grayscale',
        templateId: template.id,
        backgroundMediaId: background?.id || `generated:${post?.slug || 'post'}:bg-${String(index + 1).padStart(2, '0')}`,
        backgroundSource: 'ai',
        renderedBy: 'content-system/instagram-renderer',
        textRendered: true
      })
    } catch (error) {
      warnings.push(`Slide ${index + 1}: ${error instanceof Error ? error.message : 'No se pudo generar la imagen.'}`)
      slides.push({
        ...source,
        headline,
        body,
        imageUrl: source.imageUrl || '',
        alt: source.alt || headline,
        backgroundStyle: isEdgeSlide ? 'brand-color' : 'light-or-grayscale',
        templateId: template.id,
        backgroundMediaId: `generated:${post?.slug || 'post'}:bg-${String(index + 1).padStart(2, '0')}`,
        backgroundSource: 'ai',
        renderedBy: 'content-system/instagram-renderer',
        textRendered: false
      })
    }
  }
  return {
    socialPack: {
      ...(socialPack || {}),
      instagramSlides: slides,
      visualSystem: { version: '2.2.0', templateId: template.id, textRenderedBy: 'content-system/instagram-renderer' }
    },
    warnings
  }
}

/**
 * Generates the same title/body/summary/meta sequence used by the easy PWA
 * wizard. Brand context is applied by the AI gateway and never returned.
 */
export async function generateAssistedContent({ site, auth, idea, model } = {}) {
  const safeIdea = assertSafeAiPrompt(idea, { field: 'idea', maxChars: 8_000 })
  if (!safeIdea) throw Object.assign(new Error('Falta la idea del artículo.'), { status: 400 })

  const titleResult = await runGenerateOperation({
    site,
    auth,
    operation: 'title',
    prompt: `Crea un título concreto de máximo ${MAX_TITLE_CHARS} caracteres para este artículo. Devuelve solo el título, sin comillas ni etiquetas. Idea: ${safeIdea}`,
    model,
    internalBrand: true
  })
  const title = cleanTitle(titleResult.content, cleanTitle(safeIdea))
  const bodyResult = await runGenerateOperation({
    site,
    auth,
    operation: 'body',
    prompt: `Redacta un artículo completo en Markdown, con subtítulos y varios párrafos. Mantén exactamente esta idea y no hables del proceso. Idea: ${safeIdea}\nTítulo: ${title}`,
    post: { title },
    model,
    internalBrand: true
  })
  const bodyHtml = String(bodyResult.content || safeIdea).trim()
  const summaryResult = await runGenerateOperation({
    site,
    auth,
    operation: 'summary',
    prompt: `Escribe un resumen fiel de una o dos frases para este artículo. No inventes información ni cambies el tema.\nTítulo: ${title}\nContenido: ${bodyHtml}`,
    post: { title, bodyHtml },
    model,
    internalBrand: true
  })
  const excerptEs = plainText(summaryResult.content || safeIdea, 500)
  const metaResult = await runGenerateOperation({
    site,
    auth,
    operation: 'meta-description',
    prompt: `Escribe una meta descripción SEO fiel de máximo 155 caracteres. Devuelve solo la descripción.\nTítulo: ${title}\nResumen: ${excerptEs}\nContenido: ${bodyHtml}`,
    post: { title, bodyHtml, excerptEs },
    model,
    internalBrand: true
  })
  const metaDescriptionEs = plainText(metaResult.content || excerptEs, 155)
    .replace(/^['"“”]+|['"“”]+$/g, '')
    .trim()
  return { title, bodyHtml, excerptEs, metaDescriptionEs }
}

/**
 * Creates a draft from a broad idea and optionally generates/persists its
 * cover image using the complete server-side brand kit and references.
 */
export async function createAssistedPost({
  site,
  auth,
  idea,
  model,
  author,
  slug,
  generateImage = true
} = {}) {
  const generated = await generateAssistedContent({ site, auth, idea, model })
  const created = await createDraft({
    site,
    title: generated.title,
    slug: slug || generated.title,
    author,
    contentSource: auth?.role === 'client' ? 'client' : 'agency',
    ownerId: auth?.userId || '',
    membershipUserId: auth?.userId || ''
  })
  let saved = await updatePost({
    ...created.post,
    site,
    originalSlug: created.post.slug,
    slug: created.post.slug,
    title: generated.title,
    bodyHtml: generated.bodyHtml,
    excerptEs: generated.excerptEs,
    metaDescription: { ...(created.post.metaDescription || {}), es: generated.metaDescriptionEs },
    direct: true,
    ownerId: auth?.userId || '',
    membershipUserId: auth?.userId || ''
  })
  const warnings = []
  if (generateImage) {
    try {
      const visualBrief = buildCoverBrief({
        site,
        title: generated.title,
        summary: generated.excerptEs,
        topic: plainText(generated.bodyHtml, 2_400),
        mode: 'automatic'
      })
      const imagePrompt = buildCoverPrompt(visualBrief)
      const image = await generateImageOptions({
        auth,
        site,
        prompt: imagePrompt,
        slug: saved.post.slug,
        title: generated.title,
        alt: generated.title,
        imageRole: 'post-cover',
        mediaKind: 'post',
        optionCount: 1,
        size: process.env.OPENAI_IMAGE_COVER_SIZE || '1536x1024'
      })
      const mediaOptions = image.mediaOptions || []
      const first = mediaOptions[0]
      if (first) {
        const gallery = [...(Array.isArray(saved.post.imageGallery) ? saved.post.imageGallery : []), ...mediaOptions].slice(-30)
        saved = await updatePost({
          site,
          originalSlug: saved.post.slug,
          slug: saved.post.slug,
          imageUrl: first.url || first.path || '',
          imageThumbUrl: first.thumbUrl || first.thumbPath || '',
          imageAlt: first.alt || generated.title,
          imageGallery: gallery,
          visualBrief,
          direct: true,
          keepPublished: true,
          ownerId: auth?.userId || '',
          membershipUserId: auth?.userId || ''
        })
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'No se pudo generar la portada.')
    }
  }
  return {
    mode: 'assisted',
    post: saved.post,
    generated,
    warnings,
    next: ['Confirma el contenido con el usuario.', 'Para publicar llama blog_publish con direct=true.', 'Guarda el Social Pack generado externamente con blog_save_social_pack; si no hay artículo, usa social_save_pack.']
  }
}

export async function generatePostImageForPost({
  site,
  auth,
  slug,
  description = '',
  source = 'both',
  optionCount = 1
} = {}) {
  const current = (await getPost(site, slug)).post
  const safeSource = ['content', 'description', 'both'].includes(String(source)) ? String(source) : 'both'
  const safeDescription = assertSafeAiPrompt(description, { field: 'description', maxChars: 4_000 })
  if (safeSource === 'description' && !safeDescription) {
    throw Object.assign(new Error('Falta la descripción para generar la imagen.'), { status: 400 })
  }
  const content = `${current.title}\n${current.excerptEs || ''}\n${plainText(current.bodyHtml, 4_000)}`.trim()
  const promptParts = []
  if (safeSource === 'content' || safeSource === 'both') promptParts.push(`Usa el contenido del post como concepto visual:\n${content}`)
  if ((safeSource === 'description' || safeSource === 'both') && safeDescription) promptParts.push(`Descripción específica del usuario:\n${safeDescription}`)
  const visualBrief = buildCoverBrief({
    site,
    title: current.title,
    summary: current.excerptEs,
    topic: `${promptParts.join('\n\n') || content}`.slice(0, 4_000),
    mode: optionCount > 1 ? 'exploration' : 'automatic'
  })
  const prompt = buildCoverPrompt(visualBrief).slice(0, 4_000)
  const generated = await generateImageOptions({
    auth,
    site,
    prompt,
    slug: current.slug,
    title: current.title,
    alt: current.title,
    imageRole: 'post-cover',
    mediaKind: 'post',
    optionCount,
    size: process.env.OPENAI_IMAGE_COVER_SIZE || '1536x1024'
  })
  const mediaOptions = generated.mediaOptions || []
  const first = mediaOptions[0]
  if (!first) throw Object.assign(new Error('No se generó ninguna imagen.'), { status: 502 })
  const gallery = [...(Array.isArray(current.imageGallery) ? current.imageGallery : []), ...mediaOptions].slice(-30)
  const saved = await updatePost({
    site,
    originalSlug: slug,
    slug,
    imageUrl: first.url || first.path || '',
    imageThumbUrl: first.thumbUrl || first.thumbPath || '',
    imageAlt: first.alt || current.title,
    imageGallery: gallery,
    visualBrief,
    direct: true,
    keepPublished: true,
    ownerId: auth?.userId || current.ownerId || '',
    membershipUserId: auth?.userId || ''
  })
  return { post: saved.post, mediaOptions, prompt: generated.prompt }
}

/**
 * Generates social copy and, when requested, four server-side Instagram
 * slides that use the site's visual references. The resulting pack is saved
 * on the existing post and never depends on the PWA staying open.
 */
export async function generateSocialPackForPost({
  site,
  auth,
  slug,
  model,
  articleUrl = '',
  includeImages = true
} = {}) {
  const current = (await getPost(site, slug)).post
  const canonicalUrl = String(articleUrl || '').trim()
  const prompt = `Genera un social pack para ${current.title}. Incluye este enlace canónico en los textos que admitan enlaces: ${canonicalUrl}. Devuelve solo el contenido para los canales activos y no incluyas explicaciones.`
  const generated = await runGenerateOperation({
    site,
    auth,
    operation: 'social-pack',
    prompt,
    post: { ...current, articleUrl: canonicalUrl },
    model,
    internalBrand: true
  })
  let socialPack = normalizeSocialPack(generated.socialPack || {}, current.title)
  const warnings = []
  if (includeImages) {
    const completed = await generateSocialPackImages({ site, post: current, socialPack, auth })
    socialPack = completed.socialPack
    warnings.push(...completed.warnings)
  }
  // Add the canonical URL to copy after slide prompts are built so a long URL
  // is not accidentally rendered as text inside an Instagram image.
  socialPack = withCanonicalArticleUrl(socialPack, canonicalUrl)
  const saved = await updatePost({
    site,
    originalSlug: slug,
    slug,
    socialPack,
    direct: true,
    keepPublished: true,
    ownerId: auth?.userId || current.ownerId || '',
    membershipUserId: auth?.userId || ''
  })
  return {
    post: saved.post,
    socialPack: saved.post.socialPack || socialPack,
    warnings,
    provider: generated.provider,
    mode: generated.mode
  }
}
