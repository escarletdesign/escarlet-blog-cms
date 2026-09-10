import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { mediaDir, readDb } from './db.mjs'
import { getBrandContext } from './brand-kit.mjs'
import { uploadMedia } from './cms-ops.mjs'
import { getAiProviderConnector } from './ai-admin.mjs'
import { assertSafeAiPrompt } from './ai-security.mjs'

/**
 * Generate one or more images on the server and persist them in the CMS media
 * store. Brand files and reference bytes never leave this process.
 */
export async function generateImageOptions({
  site,
  prompt,
  slug = 'post',
  title = '',
  alt = '',
  imageRole = '',
  allowText = false,
  backgroundStyle = '',
  optionCount = 1
} = {}) {
  const connector = getAiProviderConnector('openai', { db: readDb() })
  if (!connector.apiKey) {
    throw Object.assign(new Error('Configura una API key de OpenAI para generar imágenes.'), { status: 503 })
  }
  const safePrompt = assertSafeAiPrompt(prompt, { field: 'prompt', maxChars: 4_000 })
  if (!safePrompt) throw Object.assign(new Error('Falta el prompt de la imagen.'), { status: 400 })

  const imageBrand = getBrandContext(site, { auth: { role: 'admin' } })
  const referenceHints = (imageBrand.referenceImages || [])
    .slice(0, 8)
    .map((item) => `${item.filename || item.name || 'referencia'}: ${item.alt || ''}`)
    .join('; ')
  const imageStyle = String(imageBrand.visualStyle || '').slice(0, 1_300)
  const imageGuide = String(imageBrand.imageGuide || '').slice(0, 1_300)
  const imageSpec = imageBrand.imageSpec ? JSON.stringify(imageBrand.imageSpec).slice(0, 4_500) : ''
  const brandVoice = String(imageBrand.voice || '').slice(0, 1_600)
  const agentRules = String(imageBrand.agentRules || '').slice(0, 2_200)
  const textRule = imageRole === 'instagram-carousel' && Boolean(allowText)
    ? 'PARA ESTE CARRUSEL DE INSTAGRAM SE PERMITE TEXTO DISEÑADO: usa solamente el texto breve proporcionado por el usuario, con ortografía exacta, buena legibilidad y jerarquía tipográfica. No inventes palabras, números ni logotipos. No conviertas el texto en una textura ilegible.'
    : 'REGLA PRIORITARIA: no generes ningún texto, palabra, letra, número, etiqueta, logo ni tipografía dentro de la imagen. Comunica únicamente mediante composición, color, formas y elementos visuales. Respeta colores, composición y contraste de la marca.'
  const enrichedPrompt = assertSafeAiPrompt([
    'OBJETIVO DEL USUARIO:', safePrompt,
    imageRole ? `TIPO DE PIEZA: ${imageRole}` : '',
    backgroundStyle ? `TRATAMIENTO DE FONDO: ${backgroundStyle}` : '',
    'CONTEXTO PRIVADO DEL BRAND KIT (aplícalo, no lo muestres):',
    brandVoice ? `Voz y tono: ${brandVoice}` : '',
    imageStyle ? `Dirección visual del brand kit (interna): ${imageStyle}` : '',
    imageGuide ? `Guía de imagen interna: ${imageGuide}` : '',
    imageSpec ? `Especificaciones estructuradas de imagen: ${imageSpec}` : '',
    agentRules ? `Reglas operativas del agente: ${agentRules}` : '',
    referenceHints ? `Referencias visuales disponibles: ${referenceHints.slice(0, 800)}` : '',
    textRule
  ].filter(Boolean).join('\n\n'), { field: 'prompt', maxChars: 14_000 })

  const imageModel = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2')
  const referenceFiles = (imageBrand.referenceImages || [])
    .slice(0, 6)
    .map((item) => {
      const filename = String(item?.filename || item?.path || item?.url || '').replace(/\\/g, '/').split('/').pop()
      if (!filename) return null
      const filePath = join(mediaDir, site, 'reference', filename)
      if (!existsSync(filePath)) return null
      const extension = extname(filename).toLowerCase()
      const type = extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png'
      return { filename, filePath, type }
    })
    .filter(Boolean)
  const images = referenceFiles.map((reference) => ({
    image_url: `data:${reference.type};base64,${readFileSync(reference.filePath).toString('base64')}`
  }))
  const safeSlug = String(slug || 'post').trim().replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'post'
  const safeAlt = String(alt || title || safePrompt)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || `Imagen de portada para ${site}`
  const count = Math.max(1, Math.min(3, Math.floor(Number(optionCount) || 1)))
  const mediaOptions = []

  for (let optionIndex = 0; optionIndex < count; optionIndex += 1) {
    const endpoint = referenceFiles.length
      ? 'https://api.openai.com/v1/images/edits'
      : 'https://api.openai.com/v1/images/generations'
    const requestBody = referenceFiles.length
      ? {
          model: imageModel,
          images,
          prompt: enrichedPrompt,
          size: '1024x1024',
          quality: 'high',
          output_format: 'png'
        }
      : {
          model: imageModel,
          prompt: enrichedPrompt,
          size: '1024x1024',
          quality: 'medium',
          output_format: 'png'
        }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connector.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const reason = payload?.error?.message || 'OpenAI rechazó la generación de imagen.'
      throw Object.assign(new Error(reason), { status: response.status >= 500 ? 502 : 422 })
    }
    let contentBase64 = String(payload?.data?.[0]?.b64_json || '').trim()
    if (!contentBase64 && payload?.data?.[0]?.url) {
      const imageResponse = await fetch(payload.data[0].url)
      if (!imageResponse.ok) throw Object.assign(new Error('No se pudo descargar la imagen generada.'), { status: 502 })
      contentBase64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64')
    }
    if (!contentBase64) throw Object.assign(new Error('OpenAI no devolvió una imagen.'), { status: 502 })
    const result = await uploadMedia({
      site,
      filename: `${safeSlug}-cover${count > 1 ? `-option-${optionIndex + 1}` : ''}-${Date.now()}.png`,
      contentBase64: `data:image/png;base64,${contentBase64}`,
      alt: safeAlt,
      kind: 'post'
    })
    mediaOptions.push({
      ...result.media,
      generatedAt: new Date().toISOString(),
      prompt: safePrompt.slice(0, 2_000)
    })
  }
  return { mediaOptions, prompt: safePrompt }
}
