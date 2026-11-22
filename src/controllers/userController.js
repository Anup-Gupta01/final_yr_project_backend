import { updateUserProfile, changeUserPassword, toggleUserFavorite, getUserFavorites } from '../services/userService.js'

/**
 * PATCH /api/users/profile
 * Update logged-in user's name, phone, profileImage.
 */
export async function updateProfile(req, res) {
  const { name, phone, profileImage } = req.body
  const user = await updateUserProfile(req.user, { name, phone, profileImage })
  res.json({ success: true, message: 'Profile updated.', data: { user } })
}

/**
 * PATCH /api/users/password
 * Change password — requires currentPassword + newPassword.
 */
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body
  await changeUserPassword(req.user, { currentPassword, newPassword })
  res.json({ success: true, message: 'Password changed successfully.' })
}

/**
 * POST /api/users/favorites/:propertyId
 * Toggle (add/remove) a property in the user's favorites list.
 */
export async function toggleFavorite(req, res) {
  const { propertyId } = req.params
  const result = await toggleUserFavorite(req.user, propertyId)
  res.json({ success: true, data: result })
}

/**
 * GET /api/users/favorites
 * Return the logged-in user's favorited properties (full objects).
 */
export async function getFavorites(req, res) {
  const properties = await getUserFavorites(req.user)
  res.json({ success: true, data: { properties } })
}
