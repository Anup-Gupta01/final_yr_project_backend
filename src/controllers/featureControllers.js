import { env } from '../config/env.js'
import * as users from '../services/userService.js'
import * as payments from '../services/paymentService.js'
import * as recommendations from '../services/recommendationService.js'
import * as admin from '../services/adminService.js'
import * as reports from '../services/reportService.js'
import { getLandlordDashboard } from '../services/landlordService.js'
import { badRequest } from '../utils/AppError.js'

/**
 * Thin controllers for the user, payment, recommendation, report,
 * landlord and admin modules. All rules live in the services.
 */
const ok = (res, data, message, status = 200) => res.status(status).json({ success: true, ...(message ? { message } : {}), data })

// ── Users ─────────────────────────────────────────────────────────────────
export const getFavorites = async (req, res) => ok(res, { properties: await users.getFavorites(req.user) })
export const toggleFavorite = async (req, res) => ok(res, await users.toggleFavorite(req.user, req.params.id))
export const removeFavorite = async (req, res) => ok(res, await users.toggleFavorite(req.user, req.params.id, false))
export const updateProfile = async (req, res) => ok(res, { user: await users.updateProfile(req.user, req.body) }, 'Profile updated.')
export async function changePassword(req, res) {
  await users.changePassword(req.user, req.body)
  ok(res, {}, 'Password changed.')
}
export async function forgotPassword(req, res) {
  const result = await users.requestPasswordReset(req.body.email)
  ok(res, result, 'If an account exists for that email, a reset link has been sent.')
}
export async function resetPassword(req, res) {
  await users.resetPassword(req.body)
  ok(res, {}, 'Password updated. You can now sign in.')
}

// ── Uploads ───────────────────────────────────────────────────────────────
export function uploadImages(req, res) {
  if (!req.files?.length) throw badRequest('Choose at least one image.', { images: 'No file received.' })
  const base = env.publicApiUrl || `${req.protocol}://${req.get('host')}`
  ok(res, { urls: req.files.map((f) => `${base}/uploads/properties/${f.filename}`) }, 'Images uploaded.', 201)
}

// ── Payments ──────────────────────────────────────────────────────────────
export const paymentConfig = async (_req, res) => ok(res, payments.getPaymentConfig())
export const createOrder = async (req, res) => ok(res, await payments.createOrder(req.body.bookingId, req.user), 'Order created.', 201)
export const verifyPayment = async (req, res) => ok(res, await payments.verifyPayment(req.body, req.user), 'Payment verified. Your booking is confirmed.')
export const paymentFailed = async (req, res) => ok(res, { payment: await payments.recordFailure(req.body, req.user) })
export const myPayments = async (req, res) => ok(res, { payments: await payments.listMyPayments(req.user) })
export const bookingPayments = async (req, res) => ok(res, await payments.paymentsForBooking(req.params.bookingId, req.user))
export async function webhook(req, res) {
  const result = await payments.handleWebhook(req.body, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'))
  ok(res, result)
}

// ── Recommendations ───────────────────────────────────────────────────────
export const getPreferences = async (req, res) => ok(res, { preferences: await recommendations.getPreferences(req.user) })
export const savePreferences = async (req, res) => ok(res, { preferences: await recommendations.savePreferences(req.user, req.body) }, 'Preferences saved.')
export const getRecommendations = async (req, res) => ok(res, await recommendations.getRecommendations(req.user))
export const getSimilar = async (req, res) => ok(res, { properties: await recommendations.getSimilarProperties(req.params.propertyId, Number(req.query.limit) || 4) })

// ── Reports ───────────────────────────────────────────────────────────────
export const createReport = async (req, res) => ok(res, { report: await reports.createReport(req.user, req.body) }, 'Thanks. Our team will review this report.', 201)
export const myReports = async (req, res) => ok(res, { reports: await reports.listMyReports(req.user) })

// ── Landlord ──────────────────────────────────────────────────────────────
export const landlordDashboard = async (req, res) => ok(res, await getLandlordDashboard(req.user))

// ── Admin ─────────────────────────────────────────────────────────────────
export const adminStats = async (_req, res) => ok(res, { stats: await admin.getStats() })
export const adminActivity = async (_req, res) => ok(res, { activity: await admin.getRecentActivity() })
export const adminUsers = async (req, res) => ok(res, await admin.listUsers(req.query))
export const adminSuspendUser = async (req, res) => ok(res, { user: await admin.suspendUser(req.user, req.params.id, req.body?.reason) }, 'User suspended.')
export const adminUnsuspendUser = async (req, res) => ok(res, { user: await admin.unsuspendUser(req.user, req.params.id) }, 'User reinstated.')
export const adminProperties = async (req, res) => ok(res, await admin.listProperties(req.query))
export const adminApproveProperty = async (req, res) => ok(res, { property: await admin.moderateProperty(req.user, req.params.id, 'verified') }, 'Listing approved.')
export const adminRejectProperty = async (req, res) => ok(res, { property: await admin.moderateProperty(req.user, req.params.id, 'rejected', req.body?.reason) }, 'Listing rejected.')
export const adminSuspendProperty = async (req, res) => ok(res, { property: await admin.moderateProperty(req.user, req.params.id, 'suspended', req.body?.reason) }, 'Listing suspended.')
export const adminBookings = async (req, res) => ok(res, await admin.listBookings(req.query))
export const adminPayments = async (req, res) => ok(res, await admin.listPayments(req.query))
export const adminReports = async (req, res) => ok(res, await admin.listReports(req.query))
export const adminUpdateReport = async (req, res) => ok(res, { report: await admin.updateReport(req.user, req.params.id, req.body) }, 'Report updated.')
export const adminAnalytics = async (_req, res) => ok(res, await admin.getAnalytics())
