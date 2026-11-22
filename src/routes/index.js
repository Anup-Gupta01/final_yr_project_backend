import { Router } from 'express'
import authRoutes from './authRoutes.js'
import propertyRoutes from './propertyRoutes.js'
import bookingRoutes from './bookingRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import {
  adminRoutes,
  landlordRoutes,
  passwordResetRoutes,
  paymentRoutes,
  recommendationRoutes,
  reportRoutes,
  uploadRoutes,
  userRoutes,
} from './featureRoutes.js'

/**
 * Single place where API modules are mounted. As later phases add
 * payments, landlord dashboards and admin moderation, they get
 * registered here and nowhere else.
 */
const router = Router()

router.use('/auth', authRoutes)
router.use('/properties', propertyRoutes)
router.use('/bookings', bookingRoutes)
router.use('/notifications', notificationRoutes)
router.use('/auth', passwordResetRoutes)
router.use('/users', userRoutes)
router.use('/uploads', uploadRoutes)
router.use('/payments', paymentRoutes)
router.use('/recommendations', recommendationRoutes)
router.use('/reports', reportRoutes)
router.use('/landlord', landlordRoutes)
router.use('/admin', adminRoutes)

export default router
