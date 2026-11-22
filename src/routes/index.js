import { Router } from 'express'
import authRoutes from './authRoutes.js'
import propertyRoutes from './propertyRoutes.js'
import bookingRoutes from './bookingRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import adminRoutes from './adminRoutes.js'
import userRoutes from './userRoutes.js'

/**
 * Single place where API modules are mounted.
 */
const router = Router()

router.use('/auth', authRoutes)
router.use('/properties', propertyRoutes)
router.use('/bookings', bookingRoutes)
router.use('/notifications', notificationRoutes)
router.use('/admin', adminRoutes)
router.use('/users', userRoutes)

export default router
