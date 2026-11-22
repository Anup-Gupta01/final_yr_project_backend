import mongoose from 'mongoose'

/**
 * One payment attempt against a booking, made through Razorpay.
 *
 * A row is created when the server creates a Razorpay order ("created"),
 * and only becomes "success" after the server has verified Razorpay's
 * signature (checkout callback) or a signed webhook. A browser saying
 * "it worked" is never enough on its own.
 */
export const PAYMENT_RESULTS = ['created', 'pending', 'success', 'failed']
export const PAYMENT_PROVIDERS = ['razorpay']

const paymentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },

    // Rupees, derived on the server from the booking (first month + deposit).
    amount: { type: Number, required: true, min: [1, 'Payment amount must be positive.'] },
    currency: { type: String, default: 'INR' },

    provider: { type: String, enum: PAYMENT_PROVIDERS, default: 'razorpay' },
    mode: { type: String, enum: ['test', 'live'], default: 'test' },

    paymentStatus: { type: String, enum: PAYMENT_RESULTS, default: 'created' },

    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null, select: false },
    method: { type: String, default: null },

    signatureVerifiedAt: { type: Date, default: null },
    confirmedVia: { type: String, enum: ['checkout', 'webhook', null], default: null },
    webhookEventIds: { type: [String], default: [] },

    paymentDate: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
)

// One successful payment per booking; failed attempts may pile up beside it.
paymentSchema.index(
  { booking: 1 },
  {
    unique: true,
    partialFilterExpression: { paymentStatus: 'success' },
    name: 'one_successful_payment_per_booking',
  },
)
paymentSchema.index({ paymentStatus: 1, createdAt: -1 })

paymentSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    booking: this.booking?._id ?? this.booking,
    tenant: this.tenant?.name ? { id: this.tenant._id, name: this.tenant.name, email: this.tenant.email } : this.tenant,
    property: this.property?.title ? { id: this.property._id, title: this.property.title } : this.property,
    amount: this.amount,
    currency: this.currency,
    provider: this.provider,
    mode: this.mode,
    status: this.paymentStatus,
    razorpayOrderId: this.razorpayOrderId,
    razorpayPaymentId: this.razorpayPaymentId,
    method: this.method,
    confirmedVia: this.confirmedVia,
    paymentDate: this.paymentDate,
    failureReason: this.failureReason,
    createdAt: this.createdAt,
  }
}

export const Payment = mongoose.model('Payment', paymentSchema)
