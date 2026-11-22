import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { env } from '../config/env.js'

/**
 * Razorpay adapter.
 *
 * Everything that talks to Razorpay lives here, so the payment service
 * only deals in plain objects. Keys come from the environment; when they
 * are missing, isConfigured() is false and the API answers with a clear
 * "payments not configured" error instead of pretending to succeed.
 */

let client = null

export function isConfigured() {
  return Boolean(env.razorpay.keyId && env.razorpay.keySecret)
}

export function isWebhookConfigured() {
  return Boolean(env.razorpay.webhookSecret)
}

/** "test" for rzp_test_ keys, "live" for rzp_live_ keys. */
export function mode() {
  if (!env.razorpay.keyId) return null
  return env.razorpay.keyId.startsWith('rzp_live_') ? 'live' : 'test'
}

function getClient() {
  if (!client) {
    client = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret })
  }
  return client
}

/** Tests replace the SDK client so they never call Razorpay over the network. */
export function setClientForTests(fake) {
  client = fake
}

/**
 * Creates an order. `amountPaise` is an integer in the smallest currency
 * unit, which is what Razorpay expects (₹1 = 100 paise).
 */
export async function createOrder({ amountPaise, receipt, notes }) {
  return getClient().orders.create({
    amount: amountPaise,
    currency: env.razorpay.currency,
    receipt,
    notes,
  })
}

/** Reads a payment from Razorpay, used to confirm its status server-side. */
export async function fetchPayment(paymentId) {
  return getClient().payments.fetch(paymentId)
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * Checkout signature check, exactly as Razorpay documents it:
 * HMAC-SHA256 of "<order_id>|<payment_id>" with the key secret.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return safeEqualHex(expected, signature)
}

/** Webhook signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex')
  return safeEqualHex(expected, signature)
}
