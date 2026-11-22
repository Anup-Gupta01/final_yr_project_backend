import { body, param } from 'express-validator'
import { REPORT_REASONS, REPORT_STATUSES, REPORT_TARGETS } from '../models/Report.js'

const password = (field) =>
  body(field)
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Za-z]/).withMessage('Password must contain at least one letter.')
    .matches(/\d/).withMessage('Password must contain at least one number.')

export const idParam = (name = 'id') => [param(name).isMongoId().withMessage('Invalid id.')]

export const profileRules = [
  body('name').optional().trim().isLength({ min: 2, max: 80 }).withMessage('Name must be between 2 and 80 characters.'),
  body('phone').optional().trim().matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number.'),
  body('profileImage').optional({ values: 'falsy' }).isURL({ require_tld: false }).withMessage('Profile image must be a URL.'),
]

export const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Enter your current password.'),
  password('newPassword'),
]

export const forgotPasswordRules = [
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
]

export const resetPasswordRules = [
  body('token').isString().isLength({ min: 20 }).withMessage('Reset link is invalid.'),
  password('password'),
]

export const createOrderRules = [body('bookingId').isMongoId().withMessage('A valid booking is required.')]

export const verifyPaymentRules = [
  body('razorpay_order_id').isString().notEmpty().withMessage('Missing order id.'),
  body('razorpay_payment_id').isString().notEmpty().withMessage('Missing payment id.'),
  body('razorpay_signature').isString().notEmpty().withMessage('Missing signature.'),
]

export const paymentFailedRules = [
  body('orderId').isString().notEmpty().withMessage('Missing order id.'),
  body('reason').optional().isString().isLength({ max: 300 }),
]

export const reportRules = [
  body('targetType').isIn(REPORT_TARGETS).withMessage('Report a property or a landlord.'),
  body('targetId').isMongoId().withMessage('Invalid target.'),
  body('reason').isIn(REPORT_REASONS).withMessage('Choose a reason.'),
  body('details').optional().trim().isLength({ max: 1000 }).withMessage('Keep details under 1000 characters.'),
]

export const reportUpdateRules = [
  ...idParam(),
  body('status').isIn(REPORT_STATUSES.filter((s) => s !== 'open')).withMessage('Invalid status.'),
  body('resolutionNote').optional().trim().isLength({ max: 500 }),
]

export const reasonRules = [...idParam(), body('reason').optional().trim().isLength({ max: 300 }).withMessage('Keep the reason under 300 characters.')]
