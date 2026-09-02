import { verifySignature } from '@atproto/crypto'

/**
 * Minimal verification of atproto inter-service auth JWTs (the shape a feed
 * generator or space authority signs with its own key): claims iss, aud, exp,
 * and — per the atproto spec and this project's lexicons — lxm naming the
 * method being called. Key material is resolved through an injected lookup so
 * the mock never touches the network.
 */
export interface ServiceJwtChecks {
  /**
   * Exact audience, or a predicate. The spaces PDS addresses a managing app by
   * its full service identifier (`did#fragment`), so audience checks must
   * accept both the bare DID and fragment-bearing forms of it.
   */
  expectedAud: string | ((aud: string) => boolean)
  expectedLxm: string
  /** iss DID → did:key, or null if unknown. */
  resolveDidKey: (iss: string) => string | null
  now?: Date
  skewSeconds?: number
}

export class ServiceAuthError extends Error {}

const b64urlJson = (segment: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    throw new ServiceAuthError('malformed JWT segment')
  }
}

/** Returns the verified caller DID (`iss`), or throws ServiceAuthError. */
export const verifyServiceJwt = async (token: string, checks: ServiceJwtChecks): Promise<string> => {
  const parts = token.split('.')
  if (parts.length !== 3) throw new ServiceAuthError('not a compact JWT')
  const [h, p, s] = parts
  const header = b64urlJson(h)
  const payload = b64urlJson(p)
  const { iss, aud, exp, lxm } = payload as { iss?: string; aud?: string; exp?: number; lxm?: string }

  if (typeof header.alg !== 'string') throw new ServiceAuthError('missing alg')
  if (typeof iss !== 'string' || !iss.startsWith('did:')) throw new ServiceAuthError('missing iss')
  const audOk =
    typeof checks.expectedAud === 'function'
      ? typeof aud === 'string' && checks.expectedAud(aud)
      : aud === checks.expectedAud
  if (!audOk) throw new ServiceAuthError('wrong aud')
  if (lxm !== checks.expectedLxm) throw new ServiceAuthError('wrong lxm')
  const nowSec = Math.floor((checks.now ?? new Date()).getTime() / 1000)
  const skew = checks.skewSeconds ?? 300
  if (!Number.isInteger(exp) || (exp as number) < nowSec - skew) throw new ServiceAuthError('expired')

  const didKey = checks.resolveDidKey(iss)
  if (!didKey) throw new ServiceAuthError('unknown service')
  const ok = await verifySignature(
    didKey,
    new TextEncoder().encode(`${h}.${p}`),
    new Uint8Array(Buffer.from(s, 'base64url')),
  )
  if (!ok) throw new ServiceAuthError('bad signature')
  return iss
}
