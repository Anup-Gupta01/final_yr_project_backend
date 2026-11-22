import { Property } from '../models/Property.js'
import { User } from '../models/User.js'
import { Booking } from '../models/Booking.js'
import { notFound, forbidden } from '../utils/AppError.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function buildPagination(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const requested = Number(query.limit) || DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT)
  return { page, limit, skip: (page - 1) * limit }
}

// ── Stats ──────────────────────────────────────────────────────────────────
export async function getAdminStats() {
  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalLandlords,
    totalProperties,
    pendingProperties,
    verifiedProperties,
    totalBookings,
    pendingBookings,
    acceptedBookings,
  ] = await Promise.all([
    User.countDocuments({ role: 'tenant' }),
    User.countDocuments({ role: 'tenant', status: 'active' }),
    User.countDocuments({ status: 'suspended' }),
    User.countDocuments({ role: 'landlord' }),
    Property.countDocuments(),
    Property.countDocuments({ verificationStatus: 'pending' }),
    Property.countDocuments({ verificationStatus: 'verified' }),
    Booking.countDocuments(),
    Booking.countDocuments({ status: 'pending' }),
    Booking.countDocuments({ status: 'accepted' }),
  ])

  return {
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalLandlords,
    totalProperties,
    pendingApproval: pendingProperties,
    verifiedProperties,
    totalBookings,
    pendingBookings,
    acceptedBookings,
  }
}

// ── Users ──────────────────────────────────────────────────────────────────
export async function getAllUsers(query) {
  const { page, limit, skip } = buildPagination(query)

  const filter = {}
  // Optionally filter by role
  if (query.role) filter.role = query.role
  if (query.status) filter.status = query.status
  if (query.q) {
    const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ name: pattern }, { email: pattern }]
  }

  const [docs, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ])

  // Count bookings per tenant
  const tenantIds = docs.filter(u => u.role === 'tenant').map(u => u._id)
  const bookingCounts = await Booking.aggregate([
    { $match: { tenant: { $in: tenantIds } } },
    { $group: { _id: '$tenant', count: { $sum: 1 } } },
  ])
  const bookingMap = Object.fromEntries(bookingCounts.map(b => [String(b._id), b.count]))

  // Count properties per landlord
  const landlordIds = docs.filter(u => u.role === 'landlord').map(u => u._id)
  const propertyCounts = await Property.aggregate([
    { $match: { landlord: { $in: landlordIds } } },
    { $group: { _id: '$landlord', count: { $sum: 1 } } },
  ])
  const propertyMap = Object.fromEntries(propertyCounts.map(p => [String(p._id), p.count]))

  const users = docs.map(u => ({
    id: u._id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    profileImage: u.profileImage,
    joinedAt: u.createdAt,
    bookings: bookingMap[String(u._id)] ?? 0,
    // landlord-specific
    properties: propertyMap[String(u._id)] ?? 0,
    businessName: u.name, // no business name field in schema, use name as fallback
    verified: u.status === 'active', // treat active landlords as verified for display
    type: u.role === 'tenant' ? 'Tenant' : u.role === 'landlord' ? 'Landlord' : 'Admin',
    lastActive: u.updatedAt,
  }))

  return {
    users,
    pagination: {
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + docs.length < total,
    },
  }
}

// ── Properties ─────────────────────────────────────────────────────────────
export async function getAllProperties(query) {
  const { page, limit, skip } = buildPagination(query)

  const filter = {}
  if (query.status) filter.verificationStatus = query.status
  if (query.city) filter['location.city'] = new RegExp(`^${query.city}$`, 'i')
  if (query.q) {
    const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [
      { title: pattern },
      { 'location.city': pattern },
      { 'location.address': pattern },
    ]
  }

  const [docs, total] = await Promise.all([
    Property.find(filter)
      .populate('landlord', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Property.countDocuments(filter),
  ])

  const properties = docs.map(p => {
    const pub = p.toPublicJSON()
    return {
      ...pub,
      // Extra admin fields
      approved: p.verificationStatus === 'verified',
      verificationStatus: p.verificationStatus,
      availabilityStatus: p.availabilityStatus,
      landlordName: p.landlord?.name ?? 'Unknown',
      landlordEmail: p.landlord?.email ?? '',
      city: p.location?.city ?? '',
      locality: p.location?.address ?? '',
      propertyType: p.type,
      securityDeposit: p.deposit ?? 0,
      price: pub.rent ? Math.min(...Object.values(pub.rent).filter(v => typeof v === 'number' && v > 0)) : 0,
    }
  })

  return {
    properties,
    pagination: {
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + docs.length < total,
    },
  }
}

// ── Bookings ───────────────────────────────────────────────────────────────
export async function getAllBookings(query) {
  const { page, limit, skip } = buildPagination(query)

  const filter = {}
  if (query.status) filter.status = query.status

  const [docs, total] = await Promise.all([
    Booking.find(filter)
      .populate('tenant', 'name email phone')
      .populate({ path: 'property', populate: { path: 'landlord', select: 'name email' } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Booking.countDocuments(filter),
  ])

  const bookings = docs.map(b => ({
    id: b._id,
    status: b.status,
    tenantName: b.tenant?.name ?? 'Unknown',
    tenantEmail: b.tenant?.email ?? '',
    tenantType: b.userType ?? 'Tenant',
    propertyTitle: b.property?.title ?? 'Property',
    propertyId: b.property?._id,
    city: b.property?.location?.city ?? '',
    roomType: b.occupancyType,
    rent: b.monthlyRent ?? 0,
    moveInDate: b.moveInDate ? new Date(b.moveInDate).toLocaleDateString('en-IN') : '',
    requestedOn: b.createdAt,
    respondedOn: b.approvedAt ?? b.rejectedAt ?? null,
    rejectionReason: b.rejectionReason ?? null,
    paymentStatus: b.paymentStatus ?? null,
    landlordName: b.property?.landlord?.name ?? 'Landlord',
  }))

  return {
    bookings,
    pagination: {
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + docs.length < total,
    },
  }
}

// ── Property moderation ────────────────────────────────────────────────────
export async function approvePropertyById(id) {
  const property = await Property.findById(id).populate('landlord', 'name email')
  if (!property) throw notFound('Property not found.')

  property.verificationStatus = 'verified'
  await property.save()

  return property.toPublicJSON()
}

export async function rejectPropertyById(id, reason) {
  const property = await Property.findById(id).populate('landlord', 'name email')
  if (!property) throw notFound('Property not found.')

  property.verificationStatus = 'rejected'
  if (reason) property.rejectionReason = String(reason).slice(0, 500)
  await property.save()

  return property.toPublicJSON()
}

// ── User moderation ────────────────────────────────────────────────────────
export async function suspendUserById(id) {
  const user = await User.findById(id)
  if (!user) throw notFound('User not found.')
  if (user.role === 'admin') throw forbidden('Cannot suspend an admin account.')

  user.status = 'suspended'
  await user.save()
  return user.toPublicJSON()
}

export async function unsuspendUserById(id) {
  const user = await User.findById(id)
  if (!user) throw notFound('User not found.')

  user.status = 'active'
  await user.save()
  return user.toPublicJSON()
}
