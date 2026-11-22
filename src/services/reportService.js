import { Report } from '../models/Report.js'
import { Property } from '../models/Property.js'
import { User } from '../models/User.js'
import { conflict, notFound } from '../utils/AppError.js'

/** A signed-in user reports a listing or a landlord for admin review. */
export async function createReport(user, { targetType, targetId, reason, details }) {
  let label = ''
  if (targetType === 'property') {
    const property = await Property.findById(targetId).select('title')
    if (!property) throw notFound('Property not found.')
    label = property.title
  } else {
    const landlord = await User.findOne({ _id: targetId, role: 'landlord' }).select('name')
    if (!landlord) throw notFound('Landlord not found.')
    label = landlord.name
  }

  const open = await Report.findOne({ reportedBy: user._id, targetType, targetId, status: { $in: ['open', 'reviewing'] } })
  if (open) throw conflict('You have already reported this. Our team is reviewing it.', 'DUPLICATE_REPORT')

  const report = await Report.create({ reportedBy: user._id, targetType, targetId, targetLabel: label, reason, details })
  return report.toPublicJSON()
}

export async function listMyReports(user) {
  const reports = await Report.find({ reportedBy: user._id }).sort({ createdAt: -1 }).limit(50)
  return reports.map((r) => r.toPublicJSON())
}
