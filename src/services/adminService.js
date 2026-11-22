import { User } from '../models/User.js'
import { Property } from '../models/Property.js'
import { Booking } from '../models/Booking.js'
import { Payment } from '../models/Payment.js'
import { Report } from '../models/Report.js'
import { AdminAction } from '../models/AdminAction.js'
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js'
import { notify } from './notificationService.js'
import { emailPropertyModerated } from './mailService.js'

/**
 * Admin operations. Every state change is written to the AdminAction
 * audit trail with the before and after state.
 */

function page(query, fallback = 20) {
  const p = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(Math.max(1, Number(query.limit) || fallback), 200)
  return { page: p, limit, skip: (p - 1) * limit }
}
const pagination = ({ page: p, limit, skip }, total, count) => ({
  page: p, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: skip + count < total,
})
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function audit(admin, { action, targetType, target, label, from, to, note }) {
  try {
    await AdminAction.create({ admin: admin._id, action, targetType, targetId: target, targetLabel: label, from, to, note })
  } catch (error) {
    console.error('Audit write failed:', error.message)
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export async function getStats() {
  const count = (model, filter = {}) => model.countDocuments(filter)
  const [
    totalUsers, tenants, landlords, suspendedUsers,
    totalProperties, verifiedProperties, pendingApproval, rejectedProperties, suspendedProperties,
    availableProperties, occupiedProperties,
    totalBookings, pendingBookings, paymentPendingBookings, confirmedBookings, rejectedBookings, cancelledBookings,
    openReports, totalReports, paymentAgg,
  ] = await Promise.all([
    count(User, { role: { $ne: 'admin' } }), count(User, { role: 'tenant' }), count(User, { role: 'landlord' }),
    count(User, { status: 'suspended' }),
    count(Property), count(Property, { verificationStatus: 'verified' }), count(Property, { verificationStatus: 'pending' }),
    count(Property, { verificationStatus: 'rejected' }), count(Property, { verificationStatus: 'suspended' }),
    count(Property, { verificationStatus: 'verified', availabilityStatus: 'available' }),
    count(Property, { availabilityStatus: { $in: ['booked', 'occupied'] } }),
    count(Booking), count(Booking, { status: 'pending' }), count(Booking, { status: 'payment_pending' }),
    count(Booking, { status: { $in: ['paid', 'booked', 'occupied', 'completed'] } }),
    count(Booking, { status: 'rejected' }), count(Booking, { status: 'cancelled' }),
    count(Report, { status: { $in: ['open', 'reviewing'] } }), count(Report),
    Payment.aggregate([{ $match: { paymentStatus: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
  ])

  return {
    totalUsers, tenants, landlords, activeUsers: totalUsers - suspendedUsers, suspendedUsers,
    totalProperties, verifiedProperties, pendingApproval, rejectedProperties, suspendedProperties,
    availableProperties, occupiedProperties,
    totalBookings, pendingBookings, paymentPendingBookings, confirmedBookings, rejectedBookings, cancelledBookings,
    openReports, totalReports,
    paymentVolume: paymentAgg[0]?.total ?? 0,
    successfulPayments: paymentAgg[0]?.count ?? 0,
  }
}

export async function getRecentActivity(limit = 12) {
  const [actions, bookings] = await Promise.all([
    AdminAction.find().sort({ createdAt: -1 }).limit(limit).populate('admin', 'name'),
    Booking.find().sort({ updatedAt: -1 }).limit(limit).populate('tenant', 'name').populate('property', 'title'),
  ])
  const items = [
    ...actions.map((a) => ({ kind: 'admin', at: a.createdAt, text: `${a.admin?.name ?? 'Admin'} ${a.action.replace(/_/g, ' ')} ${a.targetLabel || a.targetType}`, ...a.toPublicJSON() })),
    ...bookings.map((b) => ({ kind: 'booking', at: b.updatedAt, id: b._id, status: b.status, text: `${b.tenant?.name ?? 'A tenant'}: ${b.property?.title ?? 'a property'} is ${b.status.replace(/_/g, ' ')}` })),
  ]
  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit)
}

// ── Users ─────────────────────────────────────────────────────────────────
export async function listUsers(query) {
  const p = page(query, 50)
  const filter = { role: { $ne: 'admin' } }
  if (query.role && ['tenant', 'landlord'].includes(query.role)) filter.role = query.role
  if (query.status) filter.status = query.status
  if (query.q) {
    const re = new RegExp(escape(query.q), 'i')
    filter.$or = [{ name: re }, { email: re }, { phone: re }]
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    User.countDocuments(filter),
  ])

  const ids = users.map((u) => u._id)
  const [propCounts, tenantBookings, landlordBookings] = await Promise.all([
    Property.aggregate([{ $match: { landlord: { $in: ids } } }, { $group: { _id: '$landlord', total: { $sum: 1 }, verified: { $sum: { $cond: [{ $eq: ['$verificationStatus', 'verified'] }, 1, 0] } } } }]),
    Booking.aggregate([{ $match: { tenant: { $in: ids } } }, { $group: { _id: '$tenant', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: { landlord: { $in: ids } } }, { $group: { _id: '$landlord', n: { $sum: 1 } } }]),
  ])
  const byId = (rows) => new Map(rows.map((r) => [String(r._id), r]))
  const props = byId(propCounts)
  const tb = byId(tenantBookings)
  const lb = byId(landlordBookings)

  return {
    users: users.map((u) => ({
      ...u.toPublicJSON(),
      id: String(u._id),
      propertiesCount: props.get(String(u._id))?.total ?? 0,
      verifiedPropertiesCount: props.get(String(u._id))?.verified ?? 0,
      bookingsCount: (u.role === 'landlord' ? lb : tb).get(String(u._id))?.n ?? 0,
    })),
    pagination: pagination(p, total, users.length),
  }
}

async function setUserStatus(admin, id, status, reason) {
  if (String(admin._id) === String(id)) throw forbidden('You cannot change your own account status.')
  const user = await User.findById(id)
  if (!user) throw notFound('User not found.')
  if (user.role === 'admin') throw forbidden('Admin accounts cannot be suspended here.')
  if (user.status === status) return user.toPublicJSON()

  const from = user.status
  user.status = status
  user.suspensionReason = status === 'suspended' ? (reason?.trim() || null) : null
  await user.save()

  await audit(admin, { action: status === 'suspended' ? 'suspended_user' : 'reinstated_user', targetType: 'user', target: user._id, label: user.email, from, to: status, note: reason })
  await notify({
    user: user._id,
    type: status === 'suspended' ? 'account_suspended' : 'account_reinstated',
    title: status === 'suspended' ? 'Account suspended' : 'Account reinstated',
    body: status === 'suspended' ? `Your account was suspended.${reason ? ` Reason: ${reason}` : ''}` : 'Your account is active again.',
  })
  return { ...user.toPublicJSON(), id: String(user._id) }
}

export const suspendUser = (admin, id, reason) => setUserStatus(admin, id, 'suspended', reason)
export const unsuspendUser = (admin, id) => setUserStatus(admin, id, 'active')

// ── Properties / moderation ───────────────────────────────────────────────
export async function listProperties(query) {
  const p = page(query, 50)
  const filter = {}
  if (query.verificationStatus) filter.verificationStatus = query.verificationStatus
  if (query.availabilityStatus) filter.availabilityStatus = query.availabilityStatus
  if (query.landlord && /^[a-fd]{24}$/i.test(query.landlord)) filter.landlord = query.landlord
  if (query.q) {
    const re = new RegExp(escape(query.q), 'i')
    filter.$or = [{ title: re }, { 'location.city': re }, { 'location.address': re }]
  }

  const [properties, total] = await Promise.all([
    Property.find(filter).sort({ verificationStatus: 1, createdAt: -1 }).skip(p.skip).limit(p.limit).populate('landlord', 'name email phone profileImage'),
    Property.countDocuments(filter),
  ])

  return {
    properties: properties.map((prop) => ({
      ...prop.toPublicJSON(),
      approved: prop.verificationStatus === 'verified',
      landlord: prop.landlord?.name
        ? { id: prop.landlord._id, name: prop.landlord.name, email: prop.landlord.email, phone: prop.landlord.phone }
        : { id: prop.landlord },
    })),
    pagination: pagination(p, total, properties.length),
  }
}

const MODERATION = {
  verified: { allowedFrom: ['pending', 'rejected', 'suspended'], action: 'verified_property', type: 'property_verified', title: 'Listing approved' },
  rejected: { allowedFrom: ['pending', 'verified'], action: 'rejected_property', type: 'property_rejected', title: 'Listing rejected' },
  suspended: { allowedFrom: ['verified', 'pending'], action: 'suspended_property', type: 'property_suspended', title: 'Listing suspended' },
}

export async function moderateProperty(admin, id, to, reason) {
  const rule = MODERATION[to]
  const property = await Property.findById(id)
  if (!property) throw notFound('Property not found.')

  const from = property.verificationStatus
  if (from === to) return property.toPublicJSON()
  if (!rule.allowedFrom.includes(from)) {
    throw conflict(`A ${from} listing cannot be ${to}.`, 'INVALID_PROPERTY_STATE')
  }
  if (to !== 'verified' && !reason?.trim()) {
    throw badRequest('Please give a reason so the landlord knows what to fix.', { reason: 'A reason is required.' })
  }

  property.verificationStatus = to
  if (to === 'verified') {
    property.verifiedAt = new Date()
    property.rejectionReason = null
    property.suspensionReason = null
    property.suspendedAt = null
  } else if (to === 'rejected') {
    property.rejectionReason = reason.trim()
  } else {
    property.suspensionReason = reason.trim()
    property.suspendedAt = new Date()
  }
  await property.save()

  await audit(admin, { action: rule.action, targetType: 'property', target: property._id, label: property.title, from, to, note: reason })
  await notify({
    user: property.landlord,
    type: rule.type,
    title: rule.title,
    body: `${property.title} was ${to === 'verified' ? 'approved and is now public' : `${to}${reason ? `: ${reason}` : ''}`}.`,
    relatedEntity: { kind: 'property', id: property._id },
  })
  emailPropertyModerated({ landlord: property.landlord, propertyTitle: property.title, status: to, reason, propertyId: property._id })

  await property.populate('landlord', 'name email phone profileImage')
  return { ...property.toPublicJSON(), approved: to === 'verified' }
}

// ── Bookings & payments ───────────────────────────────────────────────────
export async function listBookings(query) {
  const p = page(query, 50)
  const filter = {}
  if (query.status) filter.status = query.status
  const [bookings, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit)
      .populate('tenant', 'name email phone').populate('landlord', 'name email phone')
      .populate({ path: 'property', populate: { path: 'landlord', select: 'name phone profileImage' } }),
    Booking.countDocuments(filter),
  ])
  return { bookings: bookings.map((b) => b.toPublicJSON()), pagination: pagination(p, total, bookings.length) }
}

export async function listPayments(query) {
  const p = page(query, 50)
  const filter = query.status ? { paymentStatus: query.status } : {}
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).populate('tenant', 'name email').populate('property', 'title'),
    Payment.countDocuments(filter),
  ])
  return { payments: payments.map((x) => x.toPublicJSON()), pagination: pagination(p, total, payments.length) }
}

// ── Reports ───────────────────────────────────────────────────────────────
export async function listReports(query) {
  const p = page(query, 50)
  const filter = query.status ? { status: query.status } : {}
  const [reports, total] = await Promise.all([
    Report.find(filter).sort({ status: 1, createdAt: -1 }).skip(p.skip).limit(p.limit).populate('reportedBy', 'name email'),
    Report.countDocuments(filter),
  ])
  return { reports: reports.map((r) => r.toPublicJSON()), pagination: pagination(p, total, reports.length) }
}

const REPORT_FLOW = { open: ['reviewing', 'resolved', 'dismissed'], reviewing: ['resolved', 'dismissed'], resolved: [], dismissed: [] }

export async function updateReport(admin, id, { status, resolutionNote }) {
  const report = await Report.findById(id)
  if (!report) throw notFound('Report not found.')
  if (!REPORT_FLOW[report.status].includes(status)) {
    throw conflict(`A ${report.status} report cannot move to ${status}.`, 'INVALID_REPORT_STATE')
  }
  const from = report.status
  report.status = status
  if (resolutionNote !== undefined) report.resolutionNote = resolutionNote
  if (['resolved', 'dismissed'].includes(status)) {
    report.resolvedBy = admin._id
    report.resolvedAt = new Date()
    await notify({
      user: report.reportedBy,
      type: 'report_resolved',
      title: `Your report was ${status}`,
      body: `Your report about ${report.targetLabel || report.targetType} was ${status}.${resolutionNote ? ` ${resolutionNote}` : ''}`,
    })
  }
  await report.save()
  await audit(admin, { action: `${status}_report`, targetType: 'report', target: report._id, label: report.targetLabel, from, to: status, note: resolutionNote })
  await report.populate('reportedBy', 'name email')
  return report.toPublicJSON()
}

// ── Analytics ─────────────────────────────────────────────────────────────
export async function getAnalytics() {
  const since = new Date()
  since.setMonth(since.getMonth() - 5, 1)
  since.setHours(0, 0, 0, 0)
  const monthKey = { $dateToString: { format: '%Y-%m', date: '$createdAt' } }

  const [bookingsByMonth, revenueByMonth, usersByMonth, byCity, byType, byStatus, occupancy] = await Promise.all([
    Booking.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: monthKey, requests: { $sum: 1 }, confirmed: { $sum: { $cond: [{ $in: ['$status', ['paid', 'booked', 'occupied', 'completed']] }, 1, 0] } } } }]),
    Payment.aggregate([{ $match: { paymentStatus: 'success', createdAt: { $gte: since } } }, { $group: { _id: monthKey, revenue: { $sum: '$amount' } } }]),
    User.aggregate([{ $match: { createdAt: { $gte: since }, role: { $ne: 'admin' } } }, { $group: { _id: monthKey, tenants: { $sum: { $cond: [{ $eq: ['$role', 'tenant'] }, 1, 0] } }, landlords: { $sum: { $cond: [{ $eq: ['$role', 'landlord'] }, 1, 0] } } } }]),
    Property.aggregate([{ $group: { _id: '$location.city', listings: { $sum: 1 }, avgRent: { $avg: '$rentMin' } } }, { $sort: { listings: -1 } }, { $limit: 8 }]),
    Property.aggregate([{ $group: { _id: '$type', value: { $sum: 1 } } }, { $sort: { value: -1 } }]),
    Booking.aggregate([{ $group: { _id: '$status', value: { $sum: 1 } } }]),
    Property.aggregate([{ $match: { verificationStatus: 'verified' } }, { $group: { _id: null, total: { $sum: '$totalRooms' }, free: { $sum: '$availableRooms' } } }]),
  ])

  const months = []
  const cursor = new Date(since)
  for (let i = 0; i < 6; i += 1) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const find = (rows, key) => rows.find((r) => r._id === key) ?? {}
  const label = (key) => new Date(`${key}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' })

  const rooms = occupancy[0] ?? { total: 0, free: 0 }
  return {
    monthly: months.map((m) => ({
      month: label(m),
      requests: find(bookingsByMonth, m).requests ?? 0,
      confirmed: find(bookingsByMonth, m).confirmed ?? 0,
      revenue: find(revenueByMonth, m).revenue ?? 0,
      tenants: find(usersByMonth, m).tenants ?? 0,
      landlords: find(usersByMonth, m).landlords ?? 0,
    })),
    byCity: byCity.map((c) => ({ city: c._id, listings: c.listings, avgRent: Math.round(c.avgRent ?? 0) })),
    byType: byType.map((t) => ({ name: t._id, value: t.value })),
    bookingsByStatus: byStatus.map((s) => ({ name: s._id, value: s.value })),
    occupancy: { totalRooms: rooms.total, occupiedRooms: rooms.total - rooms.free, rate: rooms.total ? Math.round(((rooms.total - rooms.free) / rooms.total) * 100) : 0 },
  }
}
