/**
 * Tests for payments (Razorpay), favourites, profile, password reset,
 * recommendations, reports, the landlord dashboard and admin moderation.
 *
 * Razorpay is replaced by a fake client so no network call is made, but
 * signatures are computed exactly as Razorpay computes them, so the real
 * verification code is exercised.
 *
 * Runs against its own throwaway database (staysphere_test_features).
 */
import test, { after, before, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { resolveTestUri } from './testDatabase.js'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = resolveTestUri('staysphere_test_features')
process.env.JWT_SECRET = 'test-secret-do-not-use-anywhere-else'
process.env.RAZORPAY_KEY_ID = 'rzp_test_fakekey123'
process.env.RAZORPAY_KEY_SECRET = 'fake_key_secret_for_tests'
process.env.RAZORPAY_WEBHOOK_SECRET = 'fake_webhook_secret_for_tests'
process.env.RESEND_API_KEY = ''

const mongoose = (await import('mongoose')).default
const { createApp } = await import('../src/app.js')
const { connectDatabase } = await import('../src/config/db.js')
const { env } = await import('../src/config/env.js')
const razorpay = await import('../src/integrations/razorpay.js')
const { User } = await import('../src/models/User.js')
const { Property } = await import('../src/models/Property.js')
const { Booking } = await import('../src/models/Booking.js')
const { Payment } = await import('../src/models/Payment.js')
const { Report } = await import('../src/models/Report.js')
const { AdminAction } = await import('../src/models/AdminAction.js')
const { Notification } = await import('../src/models/Notification.js')

let baseUrl
let server
const tokens = {}
const ids = {}

let orderCounter = 0
razorpay.setClientForTests({
  orders: { create: async ({ amount, currency }) => ({ id: `order_test${++orderCounter}`, amount, currency }) },
  payments: { fetch: async (id) => ({ id, method: 'upi' }) },
})

const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex')

async function call(path, { method = 'GET', body, token, raw, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}

async function registerAndLogin(account) {
  await call('/api/auth/register', { method: 'POST', body: account })
  const { body } = await call('/api/auth/login', { method: 'POST', body: { email: account.email, password: account.password } })
  return body.data.token
}

const TENANT = { name: 'Arjun Sharma', email: 'tenant-f@test.com', phone: '9876543210', password: 'Password123', role: 'tenant' }
const TENANT2 = { name: 'Neha Singh', email: 'tenant2-f@test.com', phone: '9876543211', password: 'Password123', role: 'tenant' }
const LANDLORD = { name: 'Ramesh Patel', email: 'landlord-f@test.com', phone: '9812345678', password: 'Password123', role: 'landlord' }

async function makeProperty(overrides = {}) {
  const property = new Property({
    title: 'Sunrise PG near campus',
    description: 'A test listing that is long enough to pass the description validation rule.',
    type: 'PG',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 7000, double: 5000 },
    deposit: 14000,
    totalRooms: 3,
    availableRooms: 3,
    furnishing: 'Fully-furnished',
    amenities: ['WiFi', 'Mess/Food'],
    landlord: ids.landlord,
    verificationStatus: 'verified',
    availabilityStatus: 'available',
    location: { address: 'Civil Lines', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273001', geo: { type: 'Point', coordinates: [83.3732, 26.7606] } },
    ...overrides,
  })
  await property.save()
  return property
}

/** Creates a booking and has the landlord approve it, leaving it at payment_pending. */
async function approvedBooking(property, token = tokens.tenant) {
  const moveIn = new Date(Date.now() + 14 * 864e5).toISOString()
  const created = await call('/api/bookings', { method: 'POST', token, body: { propertyId: String(property._id), occupancyType: 'Single', moveInDate: moveIn } })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const approved = await call(`/api/bookings/${created.body.data.booking.id}/approve`, { method: 'PATCH', token: tokens.landlord })
  assert.equal(approved.body.data.booking.status, 'payment_pending')
  return created.body.data.booking.id
}

before(async () => {
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await Promise.all([Property.syncIndexes(), User.syncIndexes(), Booking.syncIndexes(), Payment.syncIndexes()])

  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  tokens.tenant = await registerAndLogin(TENANT)
  tokens.tenant2 = await registerAndLogin(TENANT2)
  tokens.landlord = await registerAndLogin(LANDLORD)

  const admin = new User({ name: 'Admin', email: 'admin-f@test.com', phone: '9000000000', role: 'admin' })
  await admin.setPassword('Password123')
  await admin.save()
  tokens.admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin-f@test.com', password: 'Password123' } })).body.data.token

  ids.tenant = (await User.findOne({ email: TENANT.email }))._id
  ids.tenant2 = (await User.findOne({ email: TENANT2.email }))._id
  ids.landlord = (await User.findOne({ email: LANDLORD.email }))._id
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), Property.deleteMany({}), Payment.deleteMany({}), Report.deleteMany({}), AdminAction.deleteMany({}), Notification.deleteMany({})])
  await User.updateMany({}, { favorites: [], status: 'active' })
})

// ── Payments ──────────────────────────────────────────────────────────────
describe('Razorpay payments', () => {
  test('config reports test mode and exposes only the key id', async () => {
    const { body } = await call('/api/payments/config')
    assert.equal(body.data.enabled, true)
    assert.equal(body.data.mode, 'test')
    assert.equal(body.data.keyId, 'rzp_test_fakekey123')
    assert.ok(!JSON.stringify(body).includes(process.env.RAZORPAY_KEY_SECRET))
  })

  test('without keys, creating an order fails clearly instead of faking success', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const saved = env.razorpay.keyId
    env.razorpay.keyId = ''
    try {
      const { status, body } = await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })
      assert.equal(status, 503)
      assert.equal(body.code, 'PAYMENTS_NOT_CONFIGURED')
    } finally {
      env.razorpay.keyId = saved
    }
  })

  test('order amount is first month plus deposit, computed on the server', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const { status, body } = await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId, amount: 1 } })
    assert.equal(status, 201)
    assert.equal(body.data.amountRupees, 7000 + 14000)
    assert.equal(body.data.amount, (7000 + 14000) * 100)
    assert.ok(body.data.orderId.startsWith('order_'))
  })

  test('only the booking tenant can create an order, and only at payment_pending', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const other = await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant2, body: { bookingId } })
    assert.equal(other.status, 403)

    const moveIn = new Date(Date.now() + 864e6).toISOString()
    const pending = await call('/api/bookings', { method: 'POST', token: tokens.tenant2, body: { propertyId: String(property._id), occupancyType: 'Single', moveInDate: moveIn } })
    const early = await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant2, body: { bookingId: pending.body.data.booking.id } })
    assert.equal(early.status, 409)
  })

  test('a forged signature is rejected and the booking stays unpaid', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    const { status, body } = await call('/api/payments/verify', {
      method: 'POST', token: tokens.tenant,
      body: { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_fake1', razorpay_signature: 'deadbeef' },
    })
    assert.equal(status, 400)
    assert.equal(body.code, 'SIGNATURE_INVALID')
    assert.equal((await Booking.findById(bookingId)).status, 'payment_pending')
  })

  test('a valid signature confirms the booking once, even if verified twice', async () => {
    const property = await makeProperty({ totalRooms: 1, availableRooms: 1 })
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    const payload = { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ok1', razorpay_signature: sign(order.orderId, 'pay_ok1') }

    const first = await call('/api/payments/verify', { method: 'POST', token: tokens.tenant, body: payload })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.data.bookingStatus, 'booked')
    assert.equal(first.body.data.payment.status, 'success')
    assert.equal(first.body.data.payment.method, 'upi')

    const second = await call('/api/payments/verify', { method: 'POST', token: tokens.tenant, body: payload })
    assert.equal(second.status, 200)

    const booking = await Booking.findById(bookingId)
    assert.equal(booking.status, 'booked')
    assert.equal(booking.history.filter((h) => h.to === 'booked').length, 1)
    // The last room was taken and paid for, so the listing is occupied.
    assert.equal((await Property.findById(property._id)).availabilityStatus, 'occupied')
    assert.equal(await Payment.countDocuments({ booking: bookingId, paymentStatus: 'success' }), 1)
  })

  test('a listing with rooms left stays available after a payment', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    await call('/api/payments/verify', { method: 'POST', token: tokens.tenant, body: { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ok2', razorpay_signature: sign(order.orderId, 'pay_ok2') } })
    const fresh = await Property.findById(property._id)
    assert.equal(fresh.availabilityStatus, 'available')
    assert.equal(fresh.availableRooms, 2)
  })

  test('a paid booking can no longer be cancelled by the tenant', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    await call('/api/payments/verify', { method: 'POST', token: tokens.tenant, body: { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_ok3', razorpay_signature: sign(order.orderId, 'pay_ok3') } })
    const { status, body } = await call(`/api/bookings/${bookingId}/cancel`, { method: 'PATCH', token: tokens.tenant, body: {} })
    assert.equal(status, 409)
    assert.equal(body.code, 'PAID_BOOKING')
  })

  test('webhook: bad signature rejected, valid event confirms, duplicate ignored', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh1', order_id: order.orderId, method: 'card' } } } })
    const good = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')

    const bad = await call('/api/payments/webhook', { method: 'POST', raw, headers: { 'x-razorpay-signature': 'nope' } })
    assert.equal(bad.status, 400)

    const ok = await call('/api/payments/webhook', { method: 'POST', raw, headers: { 'x-razorpay-signature': good, 'x-razorpay-event-id': 'evt_1' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.handled, true)
    assert.equal((await Booking.findById(bookingId)).status, 'booked')

    const dup = await call('/api/payments/webhook', { method: 'POST', raw, headers: { 'x-razorpay-signature': good, 'x-razorpay-event-id': 'evt_1' } })
    assert.equal(dup.body.data.handled, false)
    assert.equal((await Payment.findOne({ razorpayOrderId: order.orderId })).confirmedVia, 'webhook')
  })

  test('a failed checkout is recorded and the tenant can retry', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    const failed = await call('/api/payments/failed', { method: 'POST', token: tokens.tenant, body: { orderId: order.orderId, reason: 'Card declined' } })
    assert.equal(failed.body.data.payment.status, 'failed')
    const retry = await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })
    assert.equal(retry.status, 201)
    assert.notEqual(retry.body.data.orderId, order.orderId)
  })
})

// ── Users ─────────────────────────────────────────────────────────────────
describe('Favourites, profile and passwords', () => {
  test('a tenant can save, list and unsave a listing', async () => {
    const property = await makeProperty()
    const add = await call(`/api/users/favorites/${property._id}`, { method: 'POST', token: tokens.tenant })
    assert.equal(add.body.data.favorited, true)
    const list = await call('/api/users/favorites', { token: tokens.tenant })
    assert.equal(list.body.data.properties.length, 1)
    const remove = await call(`/api/users/favorites/${property._id}`, { method: 'POST', token: tokens.tenant })
    assert.equal(remove.body.data.favorited, false)
  })

  test('a landlord cannot use favourites and unverified listings cannot be saved', async () => {
    const property = await makeProperty({ verificationStatus: 'pending' })
    assert.equal((await call(`/api/users/favorites/${property._id}`, { method: 'POST', token: tokens.landlord })).status, 403)
    assert.equal((await call(`/api/users/favorites/${property._id}`, { method: 'POST', token: tokens.tenant })).status, 404)
  })

  test('profile update validates the phone number', async () => {
    const good = await call('/api/users/profile', { method: 'PATCH', token: tokens.tenant2, body: { name: 'Neha S.', phone: '9123456780' } })
    assert.equal(good.status, 200)
    assert.equal(good.body.data.user.name, 'Neha S.')
    const bad = await call('/api/users/profile', { method: 'PATCH', token: tokens.tenant2, body: { phone: '12345' } })
    assert.equal(bad.status, 400)
  })

  test('changing a password needs the current one', async () => {
    const wrong = await call('/api/users/password', { method: 'PATCH', token: tokens.tenant2, body: { currentPassword: 'Nope12345', newPassword: 'NewPass123' } })
    assert.equal(wrong.status, 400)
    const right = await call('/api/users/password', { method: 'PATCH', token: tokens.tenant2, body: { currentPassword: 'Password123', newPassword: 'NewPass123' } })
    assert.equal(right.status, 200)
    const login = await call('/api/auth/login', { method: 'POST', body: { email: TENANT2.email, password: 'NewPass123' } })
    assert.equal(login.status, 200)
    await call('/api/users/password', { method: 'PATCH', token: tokens.tenant2, body: { currentPassword: 'NewPass123', newPassword: 'Password123' } })
  })

  test('password reset: same answer for unknown emails, token works once', async () => {
    const unknown = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'nobody@test.com' } })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.body.data.devResetUrl, undefined)

    const known = await call('/api/auth/forgot-password', { method: 'POST', body: { email: TENANT.email } })
    const token = new URL(known.body.data.devResetUrl).searchParams.get('token')
    const reset = await call('/api/auth/reset-password', { method: 'POST', body: { token, password: 'Fresh12345' } })
    assert.equal(reset.status, 200)
    const again = await call('/api/auth/reset-password', { method: 'POST', body: { token, password: 'Other12345' } })
    assert.equal(again.status, 401)
    const login = await call('/api/auth/login', { method: 'POST', body: { email: TENANT.email, password: 'Fresh12345' } })
    assert.equal(login.status, 200)
    tokens.tenant = login.body.data.token
  })
})

// ── Recommendations ───────────────────────────────────────────────────────
describe('Content-based recommendations', () => {
  test('preferences round-trip in the frontend field names', async () => {
    const saved = await call('/api/recommendations/preferences', { method: 'PUT', token: tokens.tenant, body: { location: 'Gorakhpur', budgetMin: 4000, budgetMax: 8000, propertyType: ['PG'], occupancy: ['Single'], genderPreference: 'Female', amenities: ['WiFi'] } })
    assert.equal(saved.status, 200)
    const read = await call('/api/recommendations/preferences', { token: tokens.tenant })
    assert.equal(read.body.data.preferences.location, 'Gorakhpur')
    assert.deepEqual(read.body.data.preferences.propertyType, ['PG'])
  })

  test('the closest match ranks first, with a score and reasons', async () => {
    await makeProperty({ title: 'Matching PG in Gorakhpur' })
    await makeProperty({ title: 'Lucknow flat', type: 'Flat', occupancy: ['Double'], rent: { double: 18000 }, amenities: ['Gym', 'AC'], furnishing: 'Unfurnished', location: { address: 'Hazratganj', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', geo: { type: 'Point', coordinates: [80.94, 26.85] } } })
    await call('/api/recommendations/preferences', { method: 'PUT', token: tokens.tenant, body: { location: 'Gorakhpur', budgetMin: 5000, budgetMax: 8000, propertyType: ['PG'], occupancy: ['Single'], amenities: ['WiFi', 'Mess/Food'] } })

    const { body } = await call('/api/recommendations', { token: tokens.tenant })
    const top = body.data.recommendedForYou[0]
    assert.equal(top.title, 'Matching PG in Gorakhpur')
    assert.ok(top.matchScore > body.data.recommendedForYou[1].matchScore)
    assert.ok(top.matchReasons.some((r) => r.includes('Gorakhpur')))
    assert.ok(body.data.bestMatches.every((p) => p.title !== 'Lucknow flat'))
  })

  test('similar properties exclude the listing itself', async () => {
    const a = await makeProperty({ title: 'Similar PG listing A' })
    await makeProperty({ title: 'Similar PG listing B' })
    const { body } = await call(`/api/recommendations/similar/${a._id}`)
    assert.ok(body.data.properties.length >= 1)
    assert.ok(body.data.properties.every((p) => p.id !== String(a._id)))
  })
})

// ── Reports & admin ───────────────────────────────────────────────────────
describe('Reports and admin moderation', () => {
  test('non-admins are blocked from admin routes', async () => {
    assert.equal((await call('/api/admin/stats', { token: tokens.tenant })).status, 403)
    assert.equal((await call('/api/admin/stats', { token: tokens.landlord })).status, 403)
    assert.equal((await call('/api/admin/stats')).status, 401)
  })

  test('admin approves a pending listing, which becomes public and is audited', async () => {
    const property = await makeProperty({ verificationStatus: 'pending' })
    assert.equal((await call(`/api/properties/${property._id}`)).status, 404)
    const approve = await call(`/api/admin/properties/${property._id}/approve`, { method: 'PATCH', token: tokens.admin })
    assert.equal(approve.status, 200)
    assert.equal(approve.body.data.property.approved, true)
    assert.equal((await call(`/api/properties/${property._id}`)).status, 200)
    const log = await AdminAction.findOne({ targetId: property._id })
    assert.equal(log.from, 'pending')
    assert.equal(log.to, 'verified')
    assert.ok(await Notification.findOne({ user: ids.landlord, type: 'property_verified' }))
  })

  test('rejecting needs a reason, and the landlord sees it', async () => {
    const property = await makeProperty({ verificationStatus: 'pending' })
    const noReason = await call(`/api/admin/properties/${property._id}/reject`, { method: 'PATCH', token: tokens.admin, body: {} })
    assert.equal(noReason.status, 400)
    const rejected = await call(`/api/admin/properties/${property._id}/reject`, { method: 'PATCH', token: tokens.admin, body: { reason: 'Photos are blurry' } })
    assert.equal(rejected.body.data.property.rejectionReason, 'Photos are blurry')
  })

  test('suspending a user blocks their token immediately', async () => {
    const suspend = await call(`/api/admin/users/${ids.tenant2}/suspend`, { method: 'PATCH', token: tokens.admin, body: { reason: 'Spam' } })
    assert.equal(suspend.status, 200)
    assert.equal((await call('/api/auth/me', { token: tokens.tenant2 })).status, 403)
    await call(`/api/admin/users/${ids.tenant2}/unsuspend`, { method: 'PATCH', token: tokens.admin })
    assert.equal((await call('/api/auth/me', { token: tokens.tenant2 })).status, 200)
  })

  test('a report flows from tenant to admin resolution', async () => {
    const property = await makeProperty()
    const created = await call('/api/reports', { method: 'POST', token: tokens.tenant, body: { targetType: 'property', targetId: String(property._id), reason: 'wrong_information', details: 'Rent shown is lower than asked' } })
    assert.equal(created.status, 201)
    const dup = await call('/api/reports', { method: 'POST', token: tokens.tenant, body: { targetType: 'property', targetId: String(property._id), reason: 'fraud' } })
    assert.equal(dup.status, 409)

    const queue = await call('/api/admin/reports', { token: tokens.admin })
    assert.equal(queue.body.data.reports.length, 1)
    const resolved = await call(`/api/admin/reports/${created.body.data.report.id}`, { method: 'PATCH', token: tokens.admin, body: { status: 'resolved', resolutionNote: 'Landlord corrected the rent' } })
    assert.equal(resolved.body.data.report.status, 'resolved')
    assert.ok(await Notification.findOne({ user: ids.tenant, type: 'report_resolved' }))
  })

  test('stats and analytics reflect real records', async () => {
    const property = await makeProperty()
    const bookingId = await approvedBooking(property)
    const order = (await call('/api/payments/create-order', { method: 'POST', token: tokens.tenant, body: { bookingId } })).body.data
    await call('/api/payments/verify', { method: 'POST', token: tokens.tenant, body: { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_s1', razorpay_signature: sign(order.orderId, 'pay_s1') } })

    const stats = (await call('/api/admin/stats', { token: tokens.admin })).body.data.stats
    assert.equal(stats.confirmedBookings, 1)
    assert.equal(stats.paymentVolume, 21000)
    assert.equal(stats.landlords, 1)

    const analytics = (await call('/api/admin/analytics', { token: tokens.admin })).body.data
    assert.equal(analytics.monthly.length, 6)
    assert.equal(analytics.monthly.at(-1).revenue, 21000)

    const dash = (await call('/api/landlord/dashboard', { token: tokens.landlord })).body.data
    assert.equal(dash.stats.revenue, 21000)
    assert.equal(dash.stats.confirmedBookings, 1)
  })
})
