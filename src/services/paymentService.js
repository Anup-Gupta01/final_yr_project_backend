import { Booking } from '../models/Booking.js'
import { Payment } from '../models/Payment.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/AppError.js'
import * as razorpay from '../integrations/razorpay.js'
import { env } from '../config/env.js'
import { confirmPaidBooking } from './bookingService.js'
import { notify } from './notificationService.js'
import { emailPaymentConfirmed } from './mailService.js'

/**
 * Razorpay payments for approved bookings.
 *
 *   1. createOrder   server creates a Razorpay order for an approved booking
 *   2. (browser)     React opens Razorpay Checkout with that order id
 *   3. verifyPayment server checks the checkout signature
 *   4. webhook       Razorpay confirms asynchronously (signed raw body)
 *
 * Steps 3 and 4 both end in finalizePayment(), which is idempotent: the
 * booking is confirmed once, whichever arrives first.
 */

function notConfigured() {
  return new AppError(503, 'Online payment is not configured on the server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend .env.', {
    code: 'PAYMENTS_NOT_CONFIGURED',
  })
}

/** What the booking costs to confirm: first month's rent plus the deposit. */
export function amountDueFor(booking) {
  return Math.round((booking.monthlyRent ?? 0) + (booking.securityDeposit ?? 0))
}

export function getPaymentConfig() {
  return {
    enabled: razorpay.isConfigured(),
    keyId: razorpay.isConfigured() ? env.razorpay.keyId : null,
    mode: razorpay.mode(),
    currency: env.razorpay.currency,
    webhookEnabled: razorpay.isWebhookConfigured(),
  }
}

async function loadTenantBooking(bookingId, tenant) {
  const booking = await Booking.findById(bookingId).populate('property', 'title images location')
  if (!booking) throw notFound('Booking not found.')
  if (String(booking.tenant) !== String(tenant._id)) {
    throw forbidden('You can only pay for your own booking.', 'NOT_OWNER')
  }
  return booking
}

export async function createOrder(bookingId, tenant) {
  if (!razorpay.isConfigured()) throw notConfigured()

  const booking = await loadTenantBooking(bookingId, tenant)

  if (booking.status !== 'payment_pending') {
    throw conflict(
      booking.status === 'booked' || booking.status === 'paid'
        ? 'This booking has already been paid.'
        : `A ${booking.status.replace('_', ' ')} booking cannot be paid for.`,
      'INVALID_BOOKING_STATE',
    )
  }

  const amount = amountDueFor(booking)
  if (amount < 1) throw badRequest('This booking has no amount to pay.', undefined, 'NOTHING_TO_PAY')

  let order
  try {
    order = await razorpay.createOrder({
      amountPaise: amount * 100,
      receipt: `bk_${booking._id}_${Date.now().toString(36)}`.slice(0, 40),
      notes: { bookingId: String(booking._id), tenantId: String(tenant._id) },
    })
  } catch (error) {
    const reason = error?.error?.description ?? error.message
    console.error('Razorpay order creation failed:', reason)
    throw new AppError(502, `Razorpay could not create the order: ${reason}`, { code: 'PAYMENT_PROVIDER_ERROR' })
  }

  const payment = await Payment.create({
    booking: booking._id,
    tenant: tenant._id,
    landlord: booking.landlord,
    property: booking.property._id,
    amount,
    currency: order.currency ?? env.razorpay.currency,
    mode: razorpay.mode() ?? 'test',
    razorpayOrderId: order.id,
    paymentStatus: 'created',
  })

  return {
    orderId: order.id,
    amount: order.amount, // paise, as Checkout expects
    amountRupees: amount,
    currency: payment.currency,
    keyId: env.razorpay.keyId,
    mode: payment.mode,
    paymentId: payment._id,
    booking: {
      id: booking._id,
      propertyTitle: booking.property.title,
      occupancyType: booking.occupancyType,
      monthlyRent: booking.monthlyRent,
      securityDeposit: booking.securityDeposit,
    },
    // Checkout expects the phone with its country code (all accounts are Indian mobiles).
    prefill: { name: tenant.name, email: tenant.email, contact: tenant.phone ? `+91${tenant.phone}` : undefined },
  }
}

/**
 * Marks a payment successful and confirms its booking, exactly once.
 * Safe to call from both the checkout callback and the webhook.
 */
async function finalizePayment(payment, { razorpayPaymentId, signature, method, via }) {
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, paymentStatus: { $ne: 'success' } },
    {
      paymentStatus: 'success',
      razorpayPaymentId,
      ...(signature ? { razorpaySignature: signature } : {}),
      method: method ?? null,
      signatureVerifiedAt: new Date(),
      confirmedVia: via,
      paymentDate: new Date(),
      failureReason: null,
    },
    { new: true },
  )

  // Someone else (checkout or webhook) already finalised it.
  if (!claimed) {
    return Booking.findById(payment.booking)
  }

  const booking = await Booking.findById(payment.booking).populate('property', 'title')
  if (booking && booking.status === 'payment_pending') {
    booking.transitionTo('paid', { by: booking.tenant, note: `Razorpay ${razorpayPaymentId} (${via})` })
    booking.paymentStatus = 'paid'
    await booking.save()
    await confirmPaidBooking(booking._id)

    await notify({
      user: booking.landlord,
      type: 'payment_received',
      title: 'Payment received',
      body: `Payment of ₹${claimed.amount.toLocaleString('en-IN')} received for ${booking.property?.title ?? 'your property'}.`,
      relatedEntity: { kind: 'payment', id: claimed._id },
    })

    emailPaymentConfirmed({
      tenant: booking.tenant,
      landlord: booking.landlord,
      propertyTitle: booking.property?.title ?? 'your booking',
      amount: claimed.amount,
      paymentId: razorpayPaymentId,
      bookingId: booking._id,
    })
  } else if (booking && booking.status !== 'booked') {
    // Money arrived for a booking that was cancelled meanwhile: keep the
    // record so an admin can refund it, but do not resurrect the booking.
    console.warn(`Payment ${razorpayPaymentId} succeeded for booking ${booking._id} in state ${booking.status}; needs manual refund.`)
  }

  return Booking.findById(payment.booking)
}

export async function verifyPayment({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, tenant) {
  if (!razorpay.isConfigured()) throw notConfigured()

  const payment = await Payment.findOne({ razorpayOrderId: orderId })
  if (!payment) throw notFound('No payment was started with that order.', 'ORDER_NOT_FOUND')
  if (String(payment.tenant) !== String(tenant._id)) {
    throw forbidden('This payment belongs to another account.', 'NOT_OWNER')
  }

  if (!razorpay.verifyPaymentSignature({ orderId, paymentId, signature })) {
    payment.paymentStatus = payment.paymentStatus === 'success' ? 'success' : 'failed'
    payment.failureReason = 'Signature verification failed'
    await payment.save()
    throw badRequest('Payment could not be verified. If money was deducted it will be confirmed automatically or refunded.', undefined, 'SIGNATURE_INVALID')
  }

  let method = null
  try {
    const remote = await razorpay.fetchPayment(paymentId)
    method = remote?.method ?? null
  } catch {
    // Not fatal: the signature already proves Razorpay issued this payment.
  }

  const booking = await finalizePayment(payment, { razorpayPaymentId: paymentId, signature, method, via: 'checkout' })
  const fresh = await Payment.findById(payment._id)
  return { payment: fresh.toPublicJSON(), bookingId: booking?._id, bookingStatus: booking?.status }
}

/** Records a failed or abandoned checkout so the tenant sees why and can retry. */
export async function recordFailure({ orderId, reason }, tenant) {
  const payment = await Payment.findOne({ razorpayOrderId: orderId })
  if (!payment) throw notFound('No payment was started with that order.', 'ORDER_NOT_FOUND')
  if (String(payment.tenant) !== String(tenant._id)) throw forbidden('This payment belongs to another account.', 'NOT_OWNER')
  if (payment.paymentStatus !== 'success') {
    payment.paymentStatus = 'failed'
    payment.failureReason = String(reason ?? 'Payment was not completed').slice(0, 300)
    await payment.save()
  }
  return payment.toPublicJSON()
}

/**
 * Razorpay webhook. `rawBody` must be the exact bytes Razorpay sent, or
 * the signature cannot match. Duplicate deliveries are ignored.
 */
export async function handleWebhook(rawBody, signature, eventId) {
  if (!razorpay.isWebhookConfigured()) {
    throw new AppError(503, 'Webhook secret is not configured.', { code: 'WEBHOOK_NOT_CONFIGURED' })
  }
  if (!signature || !razorpay.verifyWebhookSignature(rawBody, signature)) {
    throw badRequest('Invalid webhook signature.', undefined, 'SIGNATURE_INVALID')
  }

  const event = JSON.parse(rawBody.toString('utf8'))
  const entity = event?.payload?.payment?.entity
  const orderId = entity?.order_id ?? event?.payload?.order?.entity?.id
  if (!orderId) return { handled: false, reason: 'no order id' }

  const payment = await Payment.findOne({ razorpayOrderId: orderId })
  if (!payment) return { handled: false, reason: 'unknown order' }

  const id = eventId || `${event.event}:${entity?.id ?? orderId}`
  const fresh = await Payment.findOneAndUpdate(
    { _id: payment._id, webhookEventIds: { $ne: id } },
    { $push: { webhookEventIds: id } },
    { new: true },
  )
  if (!fresh) return { handled: false, reason: 'duplicate event' }

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    await finalizePayment(fresh, { razorpayPaymentId: entity?.id, method: entity?.method, via: 'webhook' })
    return { handled: true, event: event.event }
  }

  if (event.event === 'payment.failed' && fresh.paymentStatus !== 'success') {
    fresh.paymentStatus = 'failed'
    fresh.failureReason = entity?.error_description ?? 'Payment failed'
    await fresh.save()
    return { handled: true, event: event.event }
  }

  return { handled: false, reason: `ignored ${event.event}` }
}

export async function listMyPayments(tenant) {
  const payments = await Payment.find({ tenant: tenant._id }).sort({ createdAt: -1 }).limit(50).populate('property', 'title')
  return payments.map((p) => p.toPublicJSON())
}

export async function paymentsForBooking(bookingId, user) {
  const booking = await Booking.findById(bookingId)
  if (!booking) throw notFound('Booking not found.')
  const allowed = [String(booking.tenant), String(booking.landlord)].includes(String(user._id)) || user.role === 'admin'
  if (!allowed) throw notFound('Booking not found.')
  const payments = await Payment.find({ booking: booking._id }).sort({ createdAt: -1 })
  return { amountDue: amountDueFor(booking), payments: payments.map((p) => p.toPublicJSON()) }
}
