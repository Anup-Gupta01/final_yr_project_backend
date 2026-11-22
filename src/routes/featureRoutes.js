import { Router } from 'express'
import * as c from '../controllers/featureControllers.js'
import * as v from '../validators/featureValidators.js'
import { handleValidation as done } from '../middleware/validationMiddleware.js'
import { protect } from '../middleware/authMiddleware.js'
import { authorize } from '../middleware/roleMiddleware.js'
import { authLimiter, paymentLimiter } from '../middleware/rateLimiter.js'
import { propertyImages } from '../middleware/uploadMiddleware.js'

// ── /api/users ────────────────────────────────────────────────────────────
export const userRoutes = Router()
userRoutes.use(protect)
userRoutes.get('/favorites', authorize('tenant'), c.getFavorites)
userRoutes.post('/favorites/:id', authorize('tenant'), v.idParam(), done, c.toggleFavorite)
userRoutes.delete('/favorites/:id', authorize('tenant'), v.idParam(), done, c.removeFavorite)
userRoutes.patch('/profile', v.profileRules, done, c.updateProfile)
userRoutes.patch('/password', authLimiter, v.changePasswordRules, done, c.changePassword)

// ── /api/auth (password reset additions) ──────────────────────────────────
export const passwordResetRoutes = Router()
passwordResetRoutes.post('/forgot-password', authLimiter, v.forgotPasswordRules, done, c.forgotPassword)
passwordResetRoutes.post('/reset-password', authLimiter, v.resetPasswordRules, done, c.resetPassword)

// ── /api/uploads ──────────────────────────────────────────────────────────
export const uploadRoutes = Router()
uploadRoutes.post('/property-images', protect, authorize('landlord'), propertyImages, c.uploadImages)

// ── /api/payments (the webhook is mounted separately, before JSON parsing) ─
export const paymentRoutes = Router()
paymentRoutes.get('/config', c.paymentConfig)
paymentRoutes.use(protect)
paymentRoutes.post('/create-order', authorize('tenant'), paymentLimiter, v.createOrderRules, done, c.createOrder)
paymentRoutes.post('/verify', authorize('tenant'), paymentLimiter, v.verifyPaymentRules, done, c.verifyPayment)
paymentRoutes.post('/failed', authorize('tenant'), v.paymentFailedRules, done, c.paymentFailed)
paymentRoutes.get('/my', authorize('tenant'), c.myPayments)
paymentRoutes.get('/booking/:bookingId', v.idParam('bookingId'), done, c.bookingPayments)

// ── /api/recommendations ──────────────────────────────────────────────────
export const recommendationRoutes = Router()
recommendationRoutes.get('/similar/:propertyId', v.idParam('propertyId'), done, c.getSimilar)
recommendationRoutes.use(protect, authorize('tenant'))
recommendationRoutes.get('/preferences', c.getPreferences)
recommendationRoutes.put('/preferences', c.savePreferences)
recommendationRoutes.get('/', c.getRecommendations)

// ── /api/reports ──────────────────────────────────────────────────────────
export const reportRoutes = Router()
reportRoutes.use(protect, authorize('tenant', 'landlord'))
reportRoutes.post('/', v.reportRules, done, c.createReport)
reportRoutes.get('/mine', c.myReports)

// ── /api/landlord ─────────────────────────────────────────────────────────
export const landlordRoutes = Router()
landlordRoutes.get('/dashboard', protect, authorize('landlord'), c.landlordDashboard)

// ── /api/admin ────────────────────────────────────────────────────────────
export const adminRoutes = Router()
adminRoutes.use(protect, authorize('admin'))
adminRoutes.get('/stats', c.adminStats)
adminRoutes.get('/dashboard', c.adminStats)
adminRoutes.get('/activity', c.adminActivity)
adminRoutes.get('/analytics', c.adminAnalytics)
adminRoutes.get('/users', c.adminUsers)
adminRoutes.patch('/users/:id/suspend', v.reasonRules, done, c.adminSuspendUser)
adminRoutes.patch('/users/:id/unsuspend', v.idParam(), done, c.adminUnsuspendUser)
adminRoutes.get('/properties', c.adminProperties)
adminRoutes.patch('/properties/:id/approve', v.idParam(), done, c.adminApproveProperty)
adminRoutes.patch('/properties/:id/verify', v.idParam(), done, c.adminApproveProperty)
adminRoutes.patch('/properties/:id/reject', v.reasonRules, done, c.adminRejectProperty)
adminRoutes.patch('/properties/:id/suspend', v.reasonRules, done, c.adminSuspendProperty)
adminRoutes.get('/bookings', c.adminBookings)
adminRoutes.get('/payments', c.adminPayments)
adminRoutes.get('/reports', c.adminReports)
adminRoutes.patch('/reports/:id', v.reportUpdateRules, done, c.adminUpdateReport)
