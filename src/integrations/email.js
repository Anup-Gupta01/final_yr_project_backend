import { env, isProduction } from '../config/env.js'

/**
 * Transactional email through Resend's REST API.
 *
 * Optional: without RESEND_API_KEY nothing is sent and the call reports
 * { sent: false }. Callers decide what that means for the user; email
 * failure never rolls back the business action that triggered it.
 */
export function isEmailConfigured() {
  return Boolean(env.email.resendApiKey)
}

export async function sendEmail({ to, subject, html, idempotencyKey }) {
  if (!isEmailConfigured()) {
    if (!isProduction && process.env.NODE_ENV !== 'test') {
      console.info(`[email skipped: RESEND_API_KEY not set] to=${to} subject="${subject}"`)
    }
    return { sent: false, reason: 'not_configured' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.resendApiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: env.email.from, to: [to], subject, html }),
    })

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('Resend rejected an email:', response.status, body?.message)
      return { sent: false, reason: 'provider_error' }
    }
    return { sent: true, id: body.id }
  } catch (error) {
    console.error('Could not reach Resend:', error.message)
    return { sent: false, reason: 'network_error' }
  }
}

/** A plain, readable email layout shared by every message. */
export function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#4f46e5;color:#fff;padding:18px 24px;font-size:20px;font-weight:700">StaySphere</div>
    <div style="padding:24px"><h2 style="margin:0 0 12px;font-size:18px">${title}</h2>${bodyHtml}</div>
    <div style="padding:14px 24px;font-size:12px;color:#6b7280;border-top:1px solid #f0f0f0">You received this because you have a StaySphere account.</div>
  </div></body></html>`
}
