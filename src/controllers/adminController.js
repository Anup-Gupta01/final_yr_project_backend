import {
  getAllUsers,
  getAllProperties,
  getAllBookings,
  approvePropertyById,
  rejectPropertyById,
  suspendUserById,
  unsuspendUserById,
  getAdminStats,
} from '../services/adminService.js'

/**
 * Admin endpoints — all require `protect` + `authorize('admin')`.
 */

// GET /api/admin/stats
export async function getStats(req, res) {
  const stats = await getAdminStats()
  res.status(200).json({ success: true, data: { stats } })
}

// GET /api/admin/users
export async function listUsers(req, res) {
  const { users, pagination } = await getAllUsers(req.query)
  res.status(200).json({ success: true, data: { users, pagination } })
}

// GET /api/admin/properties
export async function listProperties(req, res) {
  const { properties, pagination } = await getAllProperties(req.query)
  res.status(200).json({ success: true, data: { properties, pagination } })
}

// GET /api/admin/bookings
export async function listBookings(req, res) {
  const { bookings, pagination } = await getAllBookings(req.query)
  res.status(200).json({ success: true, data: { bookings, pagination } })
}

// PATCH /api/admin/properties/:id/approve
export async function approveProperty(req, res) {
  const property = await approvePropertyById(req.params.id)
  res.status(200).json({
    success: true,
    message: 'Property approved. It is now publicly visible.',
    data: { property },
  })
}

// PATCH /api/admin/properties/:id/reject
export async function rejectProperty(req, res) {
  const property = await rejectPropertyById(req.params.id, req.body.reason)
  res.status(200).json({
    success: true,
    message: 'Property rejected.',
    data: { property },
  })
}

// PATCH /api/admin/users/:id/suspend
export async function suspendUser(req, res) {
  const user = await suspendUserById(req.params.id)
  res.status(200).json({ success: true, message: 'User suspended.', data: { user } })
}

// PATCH /api/admin/users/:id/unsuspend
export async function unsuspendUser(req, res) {
  const user = await unsuspendUserById(req.params.id)
  res.status(200).json({ success: true, message: 'User reinstated.', data: { user } })
}
