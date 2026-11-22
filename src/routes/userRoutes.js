import { Router } from 'express'
import { protect } from '../middleware/authMiddleware.js'
import {
  updateProfile,
  changePassword,
  toggleFavorite,
  getFavorites,
} from '../controllers/userController.js'

const router = Router()

// All user routes require authentication
router.use(protect)

// Profile management
router.patch('/profile', updateProfile)
router.patch('/password', changePassword)

// Favorites
router.get('/favorites', getFavorites)
router.post('/favorites/:propertyId', toggleFavorite)

export default router
