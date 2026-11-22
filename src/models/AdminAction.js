import mongoose from 'mongoose'

/**
 * Audit trail for moderation: who did what to which record, and the state
 * before and after. Written by the admin service, never by a client.
 */
const adminActionSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetType: { type: String, enum: ['user', 'property', 'booking', 'report'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    targetLabel: { type: String, default: '' },
    from: { type: String, default: null },
    to: { type: String, default: null },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

adminActionSchema.index({ createdAt: -1 })

adminActionSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    admin: this.admin?.name ? { id: this.admin._id, name: this.admin.name } : { id: this.admin },
    action: this.action,
    targetType: this.targetType,
    targetId: this.targetId,
    targetLabel: this.targetLabel,
    from: this.from,
    to: this.to,
    note: this.note,
    createdAt: this.createdAt,
  }
}

export const AdminAction = mongoose.model('AdminAction', adminActionSchema)
