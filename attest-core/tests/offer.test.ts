import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORIGINATION_WINDOW_MONTHS,
  coverageFor,
  deliveryRateAt,
  findTier,
  isShareWithinBand,
  originationActive,
  originationWindowMonths,
  purchasablePrices,
  purchasableTiers,
  requiresCoverageDisclosure,
  shouldOffer,
} from '../src/offer.js'
import type { AppShare, GatedSpace, OfferRecord } from '../src/types.js'

const PHOTOS: GatedSpace = {
  space: 'at://did:plc:creator/space/blue.flashes.gallery/3k2',
  name: 'Photos',
  contentTypes: ['blue.flashes.photo', 'app.bsky.feed.post'],
}

describe('coverage (SPEC §2.1)', () => {
  it('is 1 when the app renders everything declared', () => {
    const c = coverageFor(PHOTOS, ['blue.flashes.photo', 'app.bsky.feed.post', 'extra.type'])
    expect(c.ratio).toBe(1)
    expect(c.missing).toEqual([])
    expect(c.undeclared).toBe(false)
  })

  it('is partial when the app renders some of it', () => {
    const c = coverageFor(PHOTOS, ['blue.flashes.photo'])
    expect(c.ratio).toBe(0.5)
    expect(c.covered).toEqual(['blue.flashes.photo'])
    expect(c.missing).toEqual(['app.bsky.feed.post'])
  })

  it('is 0 when the app renders none of it', () => {
    expect(coverageFor(PHOTOS, ['pub.leaflet.document']).ratio).toBe(0)
  })

  it('treats an absent declaration as unknown, not empty', () => {
    // Omitting contentTypes must degrade to pre-§2.1 behaviour: offer it.
    const c = coverageFor({ space: 'at://x/space/y/z', name: 'Unknown' }, [])
    expect(c.undeclared).toBe(true)
    expect(c.ratio).toBe(1)
    expect(shouldOffer({ space: 'at://x/space/y/z', name: 'Unknown' }, [])).toBe(true)
  })

  it('does not let duplicate declared types skew the ratio', () => {
    const dupes: GatedSpace = { ...PHOTOS, contentTypes: ['a', 'a', 'b'] }
    expect(coverageFor(dupes, ['a']).ratio).toBe(0.5)
  })

  it('withholds the offer only at coverage 0', () => {
    expect(shouldOffer(PHOTOS, ['blue.flashes.photo'])).toBe(true)
    expect(shouldOffer(PHOTOS, ['pub.leaflet.document'])).toBe(false)
  })

  it('requires disclosure exactly on partial coverage', () => {
    expect(requiresCoverageDisclosure(PHOTOS, ['blue.flashes.photo'])).toBe(true)
    expect(requiresCoverageDisclosure(PHOTOS, PHOTOS.contentTypes!)).toBe(false)
    expect(requiresCoverageDisclosure(PHOTOS, [])).toBe(false)
  })
})

describe('purchasability (SPEC §2)', () => {
  const offer: OfferRecord = {
    tiers: [
      {
        id: 'gold',
        name: 'Gold',
        prices: [
          { lookupKey: 'default', value: 500, currency: 'EUR', period: 'month' },
          { lookupKey: 'launch', value: 400, currency: 'EUR', period: 'month', archived: true },
        ],
      },
      { id: 'retired', name: 'Retired', archived: true, prices: [{ value: 900, currency: 'EUR' }] },
      { id: 'priceless', name: 'No price', prices: [{ value: 100, currency: 'EUR', archived: true }] },
      { id: 'empty', name: 'No prices at all' },
    ],
    authorizedIssuers: ['did:web:pay.example.com'],
    createdAt: '2026-03-01T10:00:00.000Z',
  }

  it('excludes archived tiers, and tiers with no live price', () => {
    expect(purchasableTiers(offer).map((t) => t.id)).toEqual(['gold'])
  })

  it('hides archived prices from new purchases', () => {
    expect(purchasablePrices(offer.tiers[0]).map((p) => p.lookupKey)).toEqual(['default'])
  })

  it('still resolves an archived tier, so old credentials stay readable', () => {
    // The whole reason withdrawal archives rather than deletes.
    expect(findTier(offer, 'retired')?.name).toBe('Retired')
  })
})

describe('the notice period on a rate cut (SPEC §2.2)', () => {
  const pendingCut: AppShare = {
    rate: 200,
    previousRate: 800,
    effectiveFrom: '2026-10-01T00:00:00.000Z',
  }

  it('keeps the old rate until the cut lands', () => {
    expect(deliveryRateAt(pendingCut, new Date('2026-09-30T23:59:59Z'))).toBe(800)
  })

  it('applies the new rate from the effective moment', () => {
    expect(deliveryRateAt(pendingCut, new Date('2026-10-01T00:00:00Z'))).toBe(200)
  })

  it('applies an increase immediately, since it carries no previousRate', () => {
    expect(deliveryRateAt({ rate: 900 }, new Date('2026-09-03T00:00:00Z'))).toBe(900)
  })

  it('does not hand the app the lower number on an unparseable date', () => {
    const broken: AppShare = { rate: 200, previousRate: 800, effectiveFrom: 'not-a-date' }
    expect(deliveryRateAt(broken, new Date('2026-09-03T00:00:00Z'))).toBe(200)
  })

  it('is 0 when the creator declares no share', () => {
    expect(deliveryRateAt(undefined)).toBe(0)
  })
})

describe('the origination window (SPEC §2.2)', () => {
  const converted = new Date('2026-01-15T00:00:00Z')

  it('defaults when the creator declares no window', () => {
    expect(originationWindowMonths({ rate: 400 })).toBe(DEFAULT_ORIGINATION_WINDOW_MONTHS)
  })

  it('pays inside the window and stops outside it', () => {
    const share: AppShare = { rate: 400, originationWindowMonths: 12 }
    expect(originationActive(converted, share, new Date('2027-01-14T00:00:00Z'))).toBe(true)
    expect(originationActive(converted, share, new Date('2027-01-15T00:00:00Z'))).toBe(false)
  })

  it('never pays when the creator sets a zero window', () => {
    expect(originationActive(converted, { rate: 400, originationWindowMonths: 0 }, converted)).toBe(false)
  })
})

describe('the band (SPEC §2.2)', () => {
  it('accepts a rate inside it', () => {
    expect(isShareWithinBand({ rate: 1500 })).toBe(true)
    expect(isShareWithinBand({ rate: 0 })).toBe(true)
  })

  it('rejects a rate above it, and a pending rate above it', () => {
    expect(isShareWithinBand({ rate: 1501 })).toBe(false)
    expect(isShareWithinBand({ rate: 400, previousRate: 9000 })).toBe(false)
  })

  it('rejects negative and fractional basis points', () => {
    expect(isShareWithinBand({ rate: -1 })).toBe(false)
    expect(isShareWithinBand({ rate: 12.5 })).toBe(false)
  })
})
