import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AttestError,
  verifyEntitlementCredential,
  verifyVoucher,
  type OfferRecord,
  type VerifierDeps,
} from '../src/index.js'

interface VectorCase {
  name: string
  token: string
  issuerDidKey: string
  offer: OfferRecord
  badge?: { repoOwner: string; subject: string }
  verifyAt: string
  expected: string
}

const vectors = JSON.parse(readFileSync(new URL('../vectors/v0.json', import.meta.url), 'utf8')) as {
  cases: VectorCase[]
}

const depsFor = (c: VectorCase): VerifierDeps => ({
  resolveVerificationMethod: async () => c.issuerDidKey,
  getOffer: async () => c.offer,
  now: () => new Date(c.verifyAt),
})

describe('committed interop vectors verify as documented', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const run = c.badge
      ? verifyVoucher(c.token, { supporter: c.badge.repoOwner, creator: c.badge.subject }, depsFor(c))
      : verifyEntitlementCredential(c.token, depsFor(c))
    if (c.expected === 'OK') {
      await expect(run).resolves.toBeTruthy()
    } else {
      const outcome = await run.then(
        () => 'OK',
        (err) => (err instanceof AttestError ? err.code : Promise.reject(err)),
      )
      expect(outcome).toBe(c.expected)
    }
  })
})
