/**
 * Magic-link email delivery: Resend when RESEND_API_KEY is set, else console / ops paste.
 */
export async function sendMagicLinkEmail({ to, link, site }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  const from = String(process.env.RESEND_FROM || 'Escarlet CMS <onboarding@resend.dev>').trim()
  const subject = `Acceso al CMS (${site})`
  const text = `Abre este enlace para entrar (caduca en 15 minutos):\n\n${link}\n`

  if (!apiKey) {
    console.log(`[magic-link] RESEND_API_KEY unset. Ops paste for ${to || 'unknown'}:\n${link}`)
    return { ok: true, transport: 'console', link, pasted: true }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [String(to || '').trim()],
      subject,
      text
    })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Resend failed: HTTP ${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`)
    err.status = 502
    throw err
  }
  return { ok: true, transport: 'resend', link }
}
