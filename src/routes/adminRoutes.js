import { Router } from 'express'
import {
  getStats,
  listUsers,
  listProperties,
  listBookings,
  approveProperty,
  rejectProperty,
  suspendUser,
  unsuspendUser,
} from '../controllers/adminController.js'
import { protect } from '../middleware/authMiddleware.js'
import { authorize } from '../middleware/roleMiddleware.js'
import { param } from 'express-validator'
import { handleValidation } from '../middleware/validationMiddleware.js'

const router = Router()

// All admin routes require authentication + admin role
router.use(protect, authorize('admin'))

const idParam = [param('id').isMongoId().withMessage('Invalid ID.'), handleValidation]

router.get('/stats',           getStats)
router.get('/users',           listUsers)
router.get('/properties',      listProperties)
router.get('/bookings',        listBookings)

router.patch('/properties/:id/approve', idParam, approveProperty)
router.patch('/properties/:id/reject',  idParam, rejectProperty)

router.patch('/users/:id/suspend',   idParam, suspendUser)
router.patch('/users/:id/unsuspend', idParam, unsuspendUser)

export default router
