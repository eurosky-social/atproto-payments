import type { AppShare, GatedSpace, OfferPrice, OfferRecord, OfferTier } from './types.js'

/** Ceiling on a creator-declared share, in basis points (SPEC §2.2). */
export const MAX_APP_SHARE_BP = 1500

/** What an issuer applies when a creator declares no window (SPEC §2.2). */
export const DEFAULT_ORIGINATION_WINDOW_MONTHS = 12

/** Result of matching a space's declared types against what an app renders. */
export interface Coverage {
  /** Declared types this app can render. */
  covered: string[]
  /** Declared types it cannot. */
  missing: string[]
  /** covered / declared, in [0, 1]. */
  ratio: number
  /**
   * True when the space declared nothing. Treated as coverage 1 so that
   * omitting `contentTypes` degrades to pre-§2.1 behaviour — absent means
   * *unknown*, not *empty*.
   */
  undeclared: boolean
}

/**
 * Coverage of one gated space for an app (SPEC §2.1).
 *
 * Pure set arithmetic on lexicon ids. Advisory: `contentTypes` never decides
 * access, only whether offering the space to this app's users makes sense.
 */
export function coverageFor(space: GatedSpace, renderable: Iterable<string>): Coverage {
  const declared = dedupe(space.contentTypes ?? [])
  if (declared.length === 0) {
    return { covered: [], missing: [], ratio: 1, undeclared: true }
  }
  const can = new Set(renderable)
  const covered = declared.filter((t) => can.has(t))
  const missing = declared.filter((t) => !can.has(t))
  return { covered, missing, ratio: covered.length / declared.length, undeclared: false }
}

/**
 * Whether an app should present this space for purchase at all (SPEC §2.1):
 * false only at coverage 0, where there is nothing it could show.
 */
export function shouldOffer(space: GatedSpace, renderable: Iterable<string>): boolean {
  return coverageFor(space, renderable).ratio > 0
}

/**
 * Whether checkout must disclose partial coverage (SPEC §2.1). Partial
 * coverage is a normal state in an interoperable network; concealing it sells
 * someone something they cannot fully use where they are standing.
 */
export function requiresCoverageDisclosure(space: GatedSpace, renderable: Iterable<string>): boolean {
  const c = coverageFor(space, renderable)
  return !c.undeclared && c.ratio > 0 && c.ratio < 1
}

/** Prices a supporter can actually buy: everything not archived (SPEC §2). */
export function purchasablePrices(tier: OfferTier): OfferPrice[] {
  return (tier.prices ?? []).filter((p) => !p.archived)
}

/**
 * Tiers an app may offer for sale (SPEC §2): not archived, and carrying at
 * least one unarchived price. A tier with no purchasable price should be
 * hidden rather than shown as unavailable.
 *
 * Archived tiers are deliberately still present in the record — outstanding
 * credentials reference their ids and must keep resolving.
 */
export function purchasableTiers(offer: OfferRecord): OfferTier[] {
  return offer.tiers.filter((t) => !t.archived && purchasablePrices(t).length > 0)
}

/** Look up a tier by id, archived included, for interpreting a credential. */
export function findTier(offer: OfferRecord, tierId: string): OfferTier | undefined {
  return offer.tiers.find((t) => t.id === tierId)
}

/**
 * The delivery rate in force right now, in basis points (SPEC §2.2).
 *
 * A pending reduction is readable from the record itself: while `effectiveFrom`
 * is still in the future, `previousRate` governs. That is the notice period —
 * an app that built an audience around a creator is not repriced overnight.
 * An increase needs no notice, so issuers simply publish it with no
 * `previousRate` and it applies at once.
 */
export function deliveryRateAt(share: AppShare | undefined, now: Date = new Date()): number {
  if (!share) return 0
  if (share.previousRate === undefined || !share.effectiveFrom) return share.rate
  const from = Date.parse(share.effectiveFrom)
  // An unparseable date must not silently hand the app the lower number.
  if (Number.isNaN(from)) return share.rate
  return now.getTime() < from ? share.previousRate : share.rate
}

/**
 * The origination rate to stamp on a subscription converting now (SPEC §2.2).
 *
 * Origination pays for a completed act, so the rate is fixed at conversion and
 * stored with the subscription; it never floats afterwards. A pending
 * reduction has not landed yet, which is why this shares `deliveryRateAt`.
 */
export function originationRateAt(share: AppShare | undefined, now: Date = new Date()): number {
  return deliveryRateAt(share, now)
}

/** Months the origination share trails, falling back to the issuer default. */
export function originationWindowMonths(share: AppShare | undefined): number {
  const declared = share?.originationWindowMonths
  return declared === undefined ? DEFAULT_ORIGINATION_WINDOW_MONTHS : declared
}

/**
 * Whether a subscription converted at `convertedAt` still earns its
 * originating app a share (SPEC §2.2). Bounded on purpose: it caps the
 * creator's exposure at rate x window, and stops an app being paid
 * indefinitely for a conversion after another app took over the serving.
 */
export function originationActive(
  convertedAt: Date,
  share: AppShare | undefined,
  now: Date = new Date(),
): boolean {
  const months = originationWindowMonths(share)
  if (months <= 0) return false
  const until = new Date(convertedAt.getTime())
  until.setUTCMonth(until.getUTCMonth() + months)
  return now.getTime() < until.getTime()
}

/**
 * Whether a creator-declared share is within the permitted band (SPEC §2.2).
 * The band is what keeps this a distribution cost rather than a bidding war
 * for placement, so an issuer rejects anything outside it.
 */
export function isShareWithinBand(share: AppShare, maxBp: number = MAX_APP_SHARE_BP): boolean {
  const rates = [share.rate, share.previousRate].filter((r): r is number => r !== undefined)
  return rates.every((r) => Number.isInteger(r) && r >= 0 && r <= maxBp)
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}
