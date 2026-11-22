import { User } from '../models/User.js'
import { layout, sendEmail } from '../integrations/email.js'
import { clientUrl } from '../config/env.js'

/**
 * Business-event emails. Each takes plain ids/objects, loads what it
 * needs, and never throws: email is a side effect of an action that has
 * already succeeded.
 */

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

async function emailOf(userOrId) {
  if (userOrId?.email) return userOrId
  return User.findById(userOrId).select('name email')
}

async function safeSend(args) {
  try {
    return await sendEmail(args)
  } catch (error) {
    console.error('Email failed:', error.message)
    return { sent: false }
  }
}

export async function emailBookingRequested({ landlord, tenantName, propertyTitle, bookingId }) {
  const to = await emailOf(landlord)
  if (!to?.email) return
  await safeSend({
    to: to.email,
    subject: `New booking request for ${propertyTitle}`,
    idempotencyKey: `booking-requested-${bookingId}`,
    html: layout('You have a new booking request', `<p>${tenantName} has requested <b>${propertyTitle}</b>.</p>
      <p><a href="${clientUrl}/landlord/requests">Review the request</a></p>`),
  })
}

export async function emailBookingDecision({ tenant, propertyTitle, approved, reason, bookingId }) {
  const to = await emailOf(tenant)
  if (!to?.email) return
  await safeSend({
    to: to.email,
    subject: approved ? `Approved: ${propertyTitle}` : `Update on your request for ${propertyTitle}`,
    idempotencyKey: `booking-${approved ? 'approved' : 'rejected'}-${bookingId}`,
    html: approved
      ? layout('Your booking was approved', `<p>The landlord approved your request for <b>${propertyTitle}</b>. Complete the payment to confirm it.</p>
        <p><a href="${clientUrl}/user/booking/status/${bookingId}">Pay now</a></p>`)
      : layout('Your booking request was declined', `<p>Your request for <b>${propertyTitle}</b> was declined.${reason ? ` Reason: ${reason}` : ''}</p>
        <p><a href="${clientUrl}/user/properties">Browse other properties</a></p>`),
  })
}

export async function emailPaymentConfirmed({ tenant, landlord, propertyTitle, amount, paymentId, bookingId }) {
  const [t, l] = await Promise.all([emailOf(tenant), emailOf(landlord)])
  const body = `<p>Payment of <b>${rupees(amount)}</b> for <b>${propertyTitle}</b> was received and verified.</p>
    <p>Razorpay payment reference: <code>${paymentId}</code></p>`
  if (t?.email) {
    await safeSend({ to: t.email, subject: `Booking confirmed: ${propertyTitle}`, idempotencyKey: `paid-tenant-${bookingId}`, html: layout('Your booking is confirmed', body) })
  }
  if (l?.email) {
    await safeSend({ to: l.email, subject: `Payment received for ${propertyTitle}`, idempotencyKey: `paid-landlord-${bookingId}`, html: layout('A booking was paid', body) })
  }
}

export async function emailPropertyModerated({ landlord, propertyTitle, status, reason, propertyId }) {
  const to = await emailOf(landlord)
  if (!to?.email) return
  const verb = { verified: 'approved', rejected: 'rejected', suspended: 'suspended' }[status] ?? status
  await safeSend({
    to: to.email,
    subject: `Your listing was ${verb}: ${propertyTitle}`,
    idempotencyKey: `property-${status}-${propertyId}-${Date.now()}`,
    html: layout(`Listing ${verb}`, `<p>Your listing <b>${propertyTitle}</b> was ${verb} by the StaySphere team.${reason ? ` Note: ${reason}` : ''}</p>
      <p><a href="${clientUrl}/landlord/properties">View your listings</a></p>`),
  })
}

export async function emailPasswordReset({ user, resetUrl }) {
  return safeSend({
    to: user.email,
    subject: 'Reset your StaySphere password',
    html: layout('Reset your password', `<p>Hi ${user.name},</p><p>Use the link below to choose a new password. It expires in 30 minutes.</p>
      <p><a href="${resetUrl}">Reset password</a></p><p>If you did not ask for this, you can ignore this email.</p>`),
  })
}

export async function emailWelcome({ user }) {
  return safeSend({
    to: user.email,
    subject: 'Welcome to StaySphere',
    idempotencyKey: `welcome-${user._id ?? user.id}`,
    html: layout(`Welcome, ${user.name}`, `<p>Your ${user.role} account is ready.</p><p><a href="${clientUrl}/login">Sign in</a></p>`),
  })
}
