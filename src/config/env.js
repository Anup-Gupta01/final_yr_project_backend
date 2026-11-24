import dotenv from 'dotenv'

dotenv.config()

/**
 * Reads an environment variable, falling back to a default.
 * Throws when a variable is required but missing, so the server fails
 * loudly at startup instead of misbehaving later.
 */
function read(name, { fallback = undefined, required = false } = {}) {
  const value = process.env[name]

  if (value === undefined || value === '') {
    if (required) {
      throw new Error(`Missing required environment variable: ${name}`)
    }
    return fallback
  }

  return value
}

export const env = {
  nodeEnv: read('NODE_ENV', { fallback: 'development' }),
  port: Number(read('PORT', { fallback: 5000 })),
  mongoUri: read('MONGODB_URI', { required: true }),
  jwtSecret: read('JWT_SECRET', { required: true }),
  jwtExpiresIn: read('JWT_EXPIRES_IN', { fallback: '7d' }),

  // The browser origins allowed to call this API.
  clientOrigins: read('CLIENT_ORIGINS', { fallback: 'http://localhost:5173' })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // Public URL of this API, used to build absolute links to uploaded images.
  publicApiUrl: read('PUBLIC_API_URL', { fallback: '' }).replace(/\/$/, ''),

  // ── Razorpay (optional: payments are disabled with a clear message when absent)
  razorpay: {
    // RAZORPAY_KEY / RAZORPAY_SECRET are accepted as shorter aliases.
    keyId: read('RAZORPAY_KEY_ID', { fallback: '' }) || read('RAZORPAY_KEY', { fallback: '' }),
    keySecret: read('RAZORPAY_KEY_SECRET', { fallback: '' }) || read('RAZORPAY_SECRET', { fallback: '' }),
    webhookSecret: read('RAZORPAY_WEBHOOK_SECRET', { fallback: '' }),
    currency: read('RAZORPAY_CURRENCY', { fallback: 'INR' }),
  },

  // ── Transactional email through Resend (optional)
  email: {
    resendApiKey: read('RESEND_API_KEY', { fallback: '' }),
    from: read('MAIL_FROM', { fallback: 'StaySphere <onboarding@resend.dev>' }),
  },
}

/** Frontend base URL for links in emails (password reset and so on). */
export const clientUrl = (read('CLIENT_URL', { fallback: '' }) || env.clientOrigins[0] || 'http://localhost:5173').replace(/\/$/, '')

export const isProduction = env.nodeEnv === 'production'
