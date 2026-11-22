import { User } from '../models/User.js'
import { Property, PUBLIC_AVAILABILITY_STATUSES } from '../models/Property.js'
import { notFound } from '../utils/AppError.js'

/**
 * Content-based recommendations: TF-IDF feature vectors + cosine similarity.
 *
 * Every listing becomes a "document" of categorical tokens (city, type,
 * occupancy tiers, rent band, gender, furnishing, amenities). The
 * tenant's saved preferences, plus their favourites, become a query
 * document built from the same vocabulary. TF-IDF weighting makes rare
 * features (a gym, a particular city) count for more than near-universal
 * ones (WiFi), and cosine similarity ranks the listings.
 *
 * Kept behind this service so a separate Python/ML service can replace
 * it later without touching the routes or the React app.
 */

const LANDLORD_FIELDS = 'name phone profileImage'
const BAND = 2500 // rent band width in rupees

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_')
const band = (rent) => `rent:${Math.floor(rent / BAND)}`

/** Tokens describing a listing. */
function propertyTokens(p) {
  const tokens = [`city:${norm(p.location?.city)}`, `type:${norm(p.type)}`, `gender:${norm(p.gender)}`]
  if (p.furnishing) tokens.push(`furn:${norm(p.furnishing)}`)
  for (const occ of p.occupancy ?? []) tokens.push(`occ:${norm(occ)}`)
  for (const amenity of p.amenities ?? []) tokens.push(`amen:${norm(amenity)}`)
  const prices = Object.values(p.rent ?? {}).filter((v) => typeof v === 'number')
  for (const price of new Set(prices.map((v) => Math.floor(v / BAND)))) tokens.push(`rent:${price}`)
  return tokens
}

/** Tokens describing what the tenant asked for. Weighted by repetition. */
function preferenceTokens(prefs) {
  const tokens = []
  if (prefs.city) tokens.push(`city:${norm(prefs.city)}`, `city:${norm(prefs.city)}`)
  for (const t of prefs.propertyTypes ?? []) tokens.push(`type:${norm(t)}`)
  for (const o of prefs.occupancy ?? []) tokens.push(`occ:${norm(o)}`)
  if (prefs.gender && prefs.gender !== 'Any') tokens.push(`gender:${norm(prefs.gender)}`)
  tokens.push('gender:any')
  if (prefs.furnishing) tokens.push(`furn:${norm(prefs.furnishing)}`)
  for (const a of prefs.amenities ?? []) tokens.push(`amen:${norm(a)}`)
  if (prefs.budgetMin != null || prefs.budgetMax != null) {
    const lo = Math.floor((prefs.budgetMin ?? 0) / BAND)
    const hi = Math.floor((prefs.budgetMax ?? (prefs.budgetMin ?? 0) + 2 * BAND) / BAND)
    for (let b = lo; b <= Math.min(hi, lo + 20); b += 1) tokens.push(`rent:${b}`)
  }
  return tokens
}

function termFrequencies(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

/** Builds IDF weights over the candidate listings. */
function inverseDocumentFrequencies(docs) {
  const df = new Map()
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = docs.length
  const idf = new Map()
  for (const [t, count] of df) idf.set(t, Math.log((1 + n) / (1 + count)) + 1) // smoothed, as in scikit-learn
  return idf
}

function vectorize(tokens, idf) {
  const vector = new Map()
  for (const [t, f] of termFrequencies(tokens)) {
    const weight = idf.get(t)
    if (weight) vector.set(t, f * weight)
  }
  return vector
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [, v] of a) na += v * v
  for (const [, v] of b) nb += v * v
  for (const [t, v] of a) if (b.has(t)) dot += v * b.get(t)
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

const LABELS = { city: 'In', type: 'Type', occ: 'Room', gender: 'For', furn: '', amen: 'Has' }

/** Human-readable reasons from the strongest shared features. */
function reasonsFor(queryVec, propVec, property, prefs) {
  const shared = [...queryVec.keys()].filter((t) => propVec.has(t))
  shared.sort((x, y) => queryVec.get(y) * propVec.get(y) - queryVec.get(x) * propVec.get(x))
  const reasons = []
  let rentMentioned = false
  for (const t of shared) {
    const [kind, raw] = t.split(':')
    if (kind === 'rent') {
      if (!rentMentioned && prefs.budgetMax) reasons.push(`Within your ₹${Number(prefs.budgetMax).toLocaleString('en-IN')} budget`)
      rentMentioned = true
      continue
    }
    if (kind === 'gender' && raw === 'any') continue
    const value = raw.replace(/_/g, ' ')
    if (kind === 'city') reasons.push(`In ${property.location?.city ?? value}`)
    else if (kind === 'furn') reasons.push(value.replace(/\b\w/g, (c) => c.toUpperCase()))
    else reasons.push(`${LABELS[kind]} ${kind === 'amen' ? property.amenities.find((a) => norm(a) === raw) ?? value : value.replace(/\b\w/g, (c) => c.toUpperCase())}`.trim())
    if (reasons.length >= 5) break
  }
  return [...new Set(reasons)]
}

/** Converts stored preferences into the field names the React app uses, and back. */
export function toClientPreferences(p = {}) {
  return {
    location: p.city ?? '',
    budgetMin: p.budgetMin ?? null,
    budgetMax: p.budgetMax ?? null,
    propertyType: p.propertyTypes ?? [],
    occupancy: p.occupancy ?? [],
    genderPreference: p.gender ?? 'Any',
    furnishing: p.furnishing ?? '',
    amenities: p.amenities ?? [],
    savedAt: p.updatedAt ?? null,
  }
}

function fromClientPreferences(body = {}) {
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 20) : [])
  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)))
  return {
    city: String(body.location ?? body.city ?? '').trim().slice(0, 60),
    budgetMin: num(body.budgetMin),
    budgetMax: num(body.budgetMax),
    propertyTypes: list(body.propertyType ?? body.propertyTypes),
    occupancy: list(body.occupancy),
    gender: ['Any', 'Male', 'Female'].includes(body.genderPreference ?? body.gender) ? (body.genderPreference ?? body.gender) : 'Any',
    furnishing: String(body.furnishing ?? '').slice(0, 30),
    amenities: list(body.amenities),
    updatedAt: new Date(),
  }
}

export async function getPreferences(user) {
  const fresh = await User.findById(user._id).select('preferences')
  return toClientPreferences(fresh?.preferences)
}

export async function savePreferences(user, body) {
  const preferences = fromClientPreferences(body)
  const updated = await User.findByIdAndUpdate(user._id, { preferences }, { new: true }).select('preferences')
  return toClientPreferences(updated.preferences)
}

async function candidateListings() {
  return Property.find({
    verificationStatus: 'verified',
    availabilityStatus: { $in: PUBLIC_AVAILABILITY_STATUSES },
  }).populate('landlord', LANDLORD_FIELDS)
}

/** Scores every listing against the tenant's profile. */
function rank(candidates, queryTokens, prefs) {
  const docs = candidates.map(propertyTokens)
  const idf = inverseDocumentFrequencies(docs)
  const queryVec = vectorize(queryTokens, idf)

  return candidates.map((property, i) => {
    const vec = vectorize(docs[i], idf)
    const score = cosine(queryVec, vec)
    return {
      ...property.toPublicJSON(),
      matchScore: Math.round(score * 100),
      matchReasons: reasonsFor(queryVec, vec, property, prefs),
      _score: score,
    }
  }).sort((a, b) => b._score - a._score)
}

const strip = ({ _score, ...rest }) => rest

/**
 * The sections the recommendations page shows. Every list is ranked by
 * real similarity; none of them is padding.
 */
export async function getRecommendations(user) {
  const fresh = await User.findById(user._id).select('preferences favorites')
  const prefs = fresh?.preferences ?? {}
  const candidates = await candidateListings()

  if (!candidates.length) {
    return { hasPreferences: Boolean(prefs.updatedAt), preferences: toClientPreferences(prefs), recommendedForYou: [], bestMatches: [], basedOnPreferences: [], similarProperties: [], nearbyRecommendations: [] }
  }

  const favoriteIds = new Set((fresh?.favorites ?? []).map(String))
  const favorites = candidates.filter((c) => favoriteIds.has(String(c._id)))

  // Profile = stated preferences + features of saved listings (half weight via single repetition).
  const queryTokens = [...preferenceTokens(prefs), ...preferenceTokens(prefs), ...favorites.flatMap(propertyTokens)]
  const ranked = queryTokens.length ? rank(candidates, queryTokens, prefs) : []

  const notSaved = ranked.filter((p) => !favoriteIds.has(String(p.id)))
  const inBudget = notSaved.filter((p) => {
    const prices = Object.values(p.rent)
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    return (prefs.budgetMax == null || lo <= prefs.budgetMax) && (prefs.budgetMin == null || hi >= prefs.budgetMin)
  })

  // Similar to saved: rank against favourites only.
  const similar = favorites.length
    ? rank(candidates, favorites.flatMap(propertyTokens), prefs).filter((p) => !favoriteIds.has(String(p.id)))
    : []

  // Nearby: same city as the preference, ranked by similarity.
  const cityKey = norm(prefs.city)
  const nearby = cityKey ? notSaved.filter((p) => norm(p.location.city) === cityKey) : []

  return {
    hasPreferences: Boolean(prefs.updatedAt),
    preferences: toClientPreferences(prefs),
    recommendedForYou: notSaved.slice(0, 4).map(strip),
    bestMatches: inBudget.slice(0, 4).map(strip),
    basedOnPreferences: notSaved.slice(4, 10).map(strip),
    similarProperties: similar.slice(0, 4).map(strip),
    nearbyRecommendations: nearby.slice(0, 4).map(strip),
  }
}

/** Listings most similar to one listing ("you may also like"). */
export async function getSimilarProperties(propertyId, limit = 4) {
  const target = await Property.findById(propertyId)
  if (!target) throw notFound('Property not found.')
  const candidates = (await candidateListings()).filter((c) => String(c._id) !== String(propertyId))
  if (!candidates.length) return []
  return rank(candidates, propertyTokens(target), {}).slice(0, limit).map(strip)
}

// Exported for unit tests.
export const _internals = { propertyTokens, preferenceTokens, inverseDocumentFrequencies, vectorize, cosine }
