import crypto from 'node:crypto'
import { User } from '../models/User.js'
import { Property, PUBLIC_AVAILABILITY_STATUSES } from '../models/Property.js'
import { badRequest, notFound, unauthorized } from '../utils/AppError.js'
import { clientUrl, isProduction } from '../config/env.js'
import { isEmailConfigured } from '../integrations/email.js'
import { emailPasswordReset } from './mailService.js'

const LANDLORD_FIELDS = 'name phone profileImage'

/** A tenant's saved listings that are still publicly visible. */
export async function getFavorites(user) {
  const fresh = await User.findById(user._id).select('favorites')
  const properties = await Property.find({
    _id: { $in: fresh?.favorites ?? [] },
    verificationStatus: 'verified',
    availabilityStatus: { $in: PUBLIC_AVAILABILITY_STATUSES },
  }).populate('landlord', LANDLORD_FIELDS)

  return properties.map((p) => p.toPublicJSON())
}

/** Adds or removes a listing from favourites. Returns the new state. */
export async function toggleFavorite(user, propertyId, desired) {
  const property = await Property.findById(propertyId).select('verificationStatus')
  if (!property || property.verificationStatus !== 'verified') {
    throw notFound('Property not found.')
  }

  const fresh = await User.findById(user._id).select('favorites')
  const isSaved = fresh.favorites.some((id) => String(id) === String(propertyId))
  const shouldSave = typeof desired === 'boolean' ? desired : !isSaved

  const update = shouldSave ? { $addToSet: { favorites: propertyId } } : { $pull: { favorites: propertyId } }
  const updated = await User.findByIdAndUpdate(user._id, update, { new: true }).select('favorites')

  return { favorited: shouldSave, favoritesCount: updated.favorites.length, favoriteIds: updated.favorites.map(String) }
}

export async function updateProfile(user, { name, phone, profileImage }) {
  const fresh = await User.findById(user._id)
  if (name !== undefined) fresh.name = name
  if (phone !== undefined) fresh.phone = phone
  if (profileImage !== undefined) fresh.profileImage = profileImage || null
  await fresh.save()
  return fresh.toPublicJSON()
}

export async function changePassword(user, { currentPassword, newPassword }) {
  const fresh = await User.findById(user._id).select('+passwordHash')
  const ok = await fresh.comparePassword(currentPassword)
  if (!ok) {
    throw badRequest('Your current password is incorrect.', { currentPassword: 'Current password is incorrect.' }, 'WRONG_PASSWORD')
  }
  if (currentPassword === newPassword) {
    throw badRequest('Choose a password different from the current one.', { newPassword: 'Must differ from the current password.' })
  }
  await fresh.setPassword(newPassword)
  await fresh.save()
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const RESET_WINDOW_MS = 30 * 60 * 1000

/**
 * Starts a password reset. Always answers the same way whether or not
 * the email exists, so the endpoint cannot be used to discover accounts.
 *
 * When email delivery is not configured, development builds return the
 * link in the response (and say so); production never does.
 */
export async function requestPasswordReset(email) {
  const user = await User.findOne({ email: String(email).toLowerCase() })
  const result = { emailConfigured: isEmailConfigured() }

  if (!user || user.status === 'suspended') return result

  const token = crypto.randomBytes(32).toString('hex')
  user.resetPasswordTokenHash = hashToken(token)
  user.resetPasswordExpires = new Date(Date.now() + RESET_WINDOW_MS)
  await user.save()

  const resetUrl = `${clientUrl}/reset-password?token=${token}`
  const delivery = await emailPasswordReset({ user, resetUrl })

  if (!delivery?.sent && !isProduction) {
    result.devResetUrl = resetUrl
  }
  return result
}

export async function resetPassword({ token, password }) {
  const user = await User.findOne({
    resetPasswordTokenHash: hashToken(String(token)),
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordTokenHash +resetPasswordExpires +passwordHash')

  if (!user) {
    throw unauthorized('This reset link is invalid or has expired. Please request a new one.', 'RESET_TOKEN_INVALID')
  }

  await user.setPassword(password)
  user.resetPasswordTokenHash = null
  user.resetPasswordExpires = null
  await user.save()
}
