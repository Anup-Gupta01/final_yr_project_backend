import mongoose from 'mongoose'

/** A user's report about a listing or a landlord, reviewed by an admin. */
export const REPORT_TARGETS = ['property', 'landlord']
export const REPORT_REASONS = ['fake_listing', 'wrong_information', 'price_issue', 'fraud', 'inappropriate', 'other']
export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed']

const reportSchema = new mongoose.Schema(
  {
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Denormalised label so the admin queue reads well even if the target is later deleted.
    targetLabel: { type: String, default: '' },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: REPORT_STATUSES, default: 'open' },
    resolutionNote: { type: String, trim: true, maxlength: 500, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

reportSchema.index({ status: 1, createdAt: -1 })
reportSchema.index({ reportedBy: 1, targetType: 1, targetId: 1, status: 1 })

reportSchema.methods.toPublicJSON = function toPublicJSON() {
  const reporter = this.reportedBy?.name
    ? { id: this.reportedBy._id, name: this.reportedBy.name, email: this.reportedBy.email }
    : { id: this.reportedBy }
  return {
    id: this._id,
    targetType: this.targetType,
    targetId: this.targetId,
    targetLabel: this.targetLabel,
    reason: this.reason,
    details: this.details,
    status: this.status,
    resolutionNote: this.resolutionNote,
    reportedBy: reporter,
    resolvedAt: this.resolvedAt,
    createdAt: this.createdAt,
  }
}

export const Report = mongoose.model('Report', reportSchema)
