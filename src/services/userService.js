import { User } from '../models/User.js'
import { Property } from '../models/Property.js'
import { badRequest, unauthorized } from '../utils/AppError.js'

/**
 * Update a user's editable profile fields.
 * Only name, phone, and profileImage are editable here.
 */
export async function updateUserProfile(user, { name, phone, profileImage }) {
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      throw badRequest('Name must be between 2 and 80 characters.')
    }
    user.name = name.trim()
  }

  if (phone !== undefined) {
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      throw badRequest('Please provide a valid 10-digit Indian mobile number.')
    }
    user.phone = phone
  }

  if (profileImage !== undefined) {
    user.profileImage = profileImage || null
  }

  await user.save()
  return user.toPublicJSON()
}

/**
 * Change a user's password after verifying the current one.
 */
export async function changeUserPassword(user, { currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw badRequest('Both current and new passwords are required.')
  }

  // We need the hash to compare — re-fetch with select('+passwordHash')
  const freshUser = await User.findById(user._id).select('+passwordHash')
  if (!freshUser) throw badRequest('User not found.')

  const matches = await freshUser.comparePassword(currentPassword)
  if (!matches) {
    throw unauthorized('Current password is incorrect.')
  }

  if (newPassword.length < 8) {
    throw badRequest('New password must be at least 8 characters.')
  }

  await freshUser.setPassword(newPassword)
  await freshUser.save()
}

/**
 * Toggle a property in the user's favorites list.
 * Returns { favorited: boolean, favoritesCount: number }
 */
export async function toggleUserFavorite(user, propertyId) {
  const freshUser = await User.findById(user._id)

  const idx = freshUser.favorites.findIndex((id) => id.toString() === propertyId)
  let favorited

  if (idx === -1) {
    freshUser.favorites.push(propertyId)
    favorited = true
  } else {
    freshUser.favorites.splice(idx, 1)
    favorited = false
  }

  await freshUser.save()
  return { favorited, favoritesCount: freshUser.favorites.length }
}

/**
 * Return all favorited properties as full property objects.
 * Only verified, non-deleted properties are included.
 */
export async function getUserFavorites(user) {
  const freshUser = await User.findById(user._id).populate({
    path: 'favorites',
    model: Property,
    match: { verificationStatus: 'verified' },
  })

  return (freshUser?.favorites ?? []).filter(Boolean)
}
