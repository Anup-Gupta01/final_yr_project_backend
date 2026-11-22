import { Property } from '../models/Property.js'
import { Booking } from '../models/Booking.js'
import { Payment } from '../models/Payment.js'

/** Everything the landlord dashboard shows, computed from real records. */
export async function getLandlordDashboard(landlord) {
  const id = landlord._id
  const [properties, statusRows, revenueRows, recent] = await Promise.all([
    Property.find({ landlord: id }).select('title verificationStatus availabilityStatus totalRooms availableRooms rentMin images location.city'),
    Booking.aggregate([{ $match: { landlord: id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { landlord: id, paymentStatus: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Booking.find({ landlord: id }).sort({ createdAt: -1 }).limit(5).populate('tenant', 'name email phone').populate('property', 'title images location'),
  ])

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.n]))
  const totalRooms = properties.reduce((s, p) => s + (p.totalRooms ?? 0), 0)
  const freeRooms = properties.reduce((s, p) => s + (p.availableRooms ?? 0), 0)
  const count = (fn) => properties.filter(fn).length

  return {
    stats: {
      totalProperties: properties.length,
      verifiedProperties: count((p) => p.verificationStatus === 'verified'),
      pendingVerification: count((p) => p.verificationStatus === 'pending'),
      rejectedProperties: count((p) => ['rejected', 'suspended'].includes(p.verificationStatus)),
      occupiedProperties: count((p) => ['booked', 'occupied'].includes(p.availabilityStatus)),
      totalRooms,
      occupiedRooms: totalRooms - freeRooms,
      occupancyRate: totalRooms ? Math.round(((totalRooms - freeRooms) / totalRooms) * 100) : 0,
      pendingRequests: byStatus.pending ?? 0,
      awaitingPayment: byStatus.payment_pending ?? 0,
      confirmedBookings: (byStatus.paid ?? 0) + (byStatus.booked ?? 0) + (byStatus.occupied ?? 0) + (byStatus.completed ?? 0),
      totalRequests: Object.values(byStatus).reduce((a, b) => a + b, 0),
      revenue: revenueRows[0]?.total ?? 0,
      paymentsReceived: revenueRows[0]?.count ?? 0,
    },
    recentRequests: recent.map((b) => b.toPublicJSON()),
  }
}
