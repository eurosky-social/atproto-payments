import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createEntitlementCredential, createVoucher } from '@atproto-payments/attest-core'
import { Ledger } from './ledger.js'
import { ServiceAuthError, verifyServiceJwt } from './service-auth.js'
import type { IssuerIdentity } from './identity.js'

const GET_CREDENTIALS = 'network.eurosky.payments.getCredentials'
const CHECK_ENTITLEMENT = 'network.eurosky.payments.checkEntitlement'
const CHECK_USER_ACCESS = 'com.atproto.simplespace.checkUserAccess'

export interface MockIssuer {
  server: Server
  ledger: Ledger
  identity: IssuerIdentity
  /** Create a bearer session acting as `did` (what OAuth provides in real life). */
  createSession(did: string): string
  /** Register a service's key so its inter-service JWTs verify. */
  registerService(did: string, didKey: string): void
  /** Register a creator's offer facts the issuer needs (authorizedServices). */
  registerOffer(creator: string, offer: { authorizedServices?: string[] }): void
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

const xrpcError = (res: ServerResponse, status: number, error: string, message: string): void =>
  json(res, status, { error, message })

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const isDid = (s: unknown): s is string => typeof s === 'string' && s.startsWith('did:') && s.length > 8

/** Authority DID of a space URI: at://{spaceDid}/space/{spaceType}/{skey} */
const spaceAuthority = (space: string): string | null => {
  const m = /^at:\/\/([^/]+)\/space\/[^/]+\/[^/]+$/.exec(space)
  return m ? m[1] : null
}

export const createMockIssuer = (identity: IssuerIdentity): MockIssuer => {
  const ledger = new Ledger()
  const sessions = new Map<string, string>() // bearer token → DID
  const serviceKeys = new Map<string, string>() // service DID → did:key
  const offers = new Map<string, { authorizedServices: string[] }>() // creator DID → offer facts

  const bearerDid = (req: IncomingMessage): string | null => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return null
    return sessions.get(auth.slice('Bearer '.length)) ?? null
  }

  const serviceCaller = async (req: IncomingMessage, lxm: string): Promise<string | null> => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return null
    try {
      return await verifyServiceJwt(auth.slice('Bearer '.length), {
        // The spaces PDS addresses a managing app by its full service
        // identifier (did#fragment); direct callers may use the bare DID.
        expectedAud: (aud) => aud === identity.did || aud.startsWith(`${identity.did}#`),
        expectedLxm: lxm,
        resolveDidKey: (iss) => serviceKeys.get(iss) ?? null,
      })
    } catch (err) {
      if (err instanceof ServiceAuthError) return null
      throw err
    }
  }

  const mintCredential = (subject: string, creator: string, tier: string, periodEnd?: Date) =>
    createEntitlementCredential({
      signer: identity.keypair,
      kid: identity.kid,
      sub: subject,
      ctx: { creator, tier },
      periodEnd,
    })

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      console.error('unhandled', err)
      if (!res.headersSent) xrpcError(res, 500, 'InternalServerError', 'unexpected failure')
    })
  })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const { pathname } = url

    // ── XRPC: getCredentials — OAuth-as-supporter only ────────────────────
    if (req.method === 'GET' && pathname === `/xrpc/${GET_CREDENTIALS}`) {
      const subject = bearerDid(req)
      if (!subject) return xrpcError(res, 401, 'AuthenticationRequired', 'a supporter session is required')
      const creatorFilter = url.searchParams.get('creator') ?? undefined
      const active = ledger
        .activeAll(subject)
        .filter((e) => !creatorFilter || e.creator === creatorFilter)
      const credentials = await Promise.all(
        active.map(async (e) => {
          const token = await mintCredential(subject, e.creator, e.tier, e.periodEnd)
          const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
          return {
            token,
            creator: e.creator,
            tier: e.tier,
            expiresAt: new Date(exp * 1000).toISOString(),
          }
        }),
      )
      return json(res, 200, { credentials })
    }

    // ── XRPC: checkEntitlement — standing required (SPEC §5.2) ────────────
    if (req.method === 'GET' && pathname === `/xrpc/${CHECK_ENTITLEMENT}`) {
      const subject = url.searchParams.get('subject')
      const creator = url.searchParams.get('creator')
      const tier = url.searchParams.get('tier') ?? undefined
      if (!isDid(subject) || !isDid(creator)) {
        return xrpcError(res, 400, 'InvalidRequest', 'subject and creator must be DIDs')
      }

      const asSubject = bearerDid(req)
      let standing = asSubject === subject
      if (!standing) {
        const service = await serviceCaller(req, CHECK_ENTITLEMENT)
        standing = service !== null && (offers.get(creator)?.authorizedServices.includes(service) ?? false)
      }
      if (!standing) {
        // Uniform: no hint whether the subject or any entitlement exists.
        return xrpcError(res, 400, 'NoStanding', 'caller has no standing for this query')
      }

      const entitlement = ledger.active(subject, creator)
      if (!entitlement || (tier && entitlement.tier !== tier)) return json(res, 200, { active: false })
      return json(res, 200, {
        active: true,
        tier: entitlement.tier,
        ...(entitlement.periodEnd ? { expiresAt: entitlement.periodEnd.toISOString() } : {}),
      })
    }

    // ── XRPC: simplespace checkUserAccess — the managing-app socket ───────
    // Query per the permissioned-data branch lexicon: params space/user/clientId,
    // output {authorized}, service-authed by the space authority.
    if (req.method === 'GET' && pathname === `/xrpc/${CHECK_USER_ACCESS}`) {
      const space = url.searchParams.get('space')
      const user = url.searchParams.get('user')
      if (typeof space !== 'string' || !isDid(user)) {
        return xrpcError(res, 400, 'InvalidRequest', 'space (space-ref) and user (DID) are required')
      }
      const authority = spaceAuthority(space)
      if (!authority) return xrpcError(res, 400, 'InvalidRequest', 'space is not a valid space reference')
      // Only the space's own authority may ask (it calls us at credential-mint time).
      const caller = await serviceCaller(req, CHECK_USER_ACCESS)
      if (caller !== authority) {
        return xrpcError(res, 401, 'AuthenticationRequired', 'caller is not the space authority')
      }
      const creator = ledger.creatorForSpace(space)
      if (!creator) return json(res, 200, { authorized: false })
      return json(res, 200, { authorized: ledger.active(user, creator) !== null })
    }

    // ── Admin surface (demo-only, unauthenticated, bind to localhost) ─────
    if (pathname.startsWith('/admin/')) {
      const body = req.method === 'POST' ? await readBody(req) : {}
      switch (`${req.method} ${pathname}`) {
        case 'GET /admin/identity':
          return json(res, 200, { did: identity.did, kid: identity.kid, didKey: identity.didKey })
        case 'GET /admin/state':
          return json(res, 200, ledger.snapshot())
        case 'POST /admin/sessions': {
          if (!isDid(body.did)) return xrpcError(res, 400, 'InvalidRequest', 'did required')
          const token = randomBytes(16).toString('hex')
          sessions.set(token, body.did)
          return json(res, 200, { token, did: body.did })
        }
        case 'POST /admin/services': {
          if (!isDid(body.did) || typeof body.didKey !== 'string') {
            return xrpcError(res, 400, 'InvalidRequest', 'did and didKey required')
          }
          serviceKeys.set(body.did, body.didKey)
          return json(res, 200, { ok: true })
        }
        case 'POST /admin/offers': {
          if (!isDid(body.creator)) return xrpcError(res, 400, 'InvalidRequest', 'creator required')
          const services = Array.isArray(body.authorizedServices) ? body.authorizedServices : []
          offers.set(body.creator, { authorizedServices: services.filter(isDid) })
          return json(res, 200, { ok: true })
        }
        case 'POST /admin/entitlements': {
          const { subject, creator, tier } = body
          if (!isDid(subject) || !isDid(creator) || typeof tier !== 'string') {
            return xrpcError(res, 400, 'InvalidRequest', 'subject, creator, tier required')
          }
          const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : undefined
          return json(res, 200, {
            ok: true,
            entitlement: ledger.settle({ subject, creator, tier, periodEnd }),
          })
        }
        case 'POST /admin/lapse':
        case 'POST /admin/chargeback': {
          const { subject, creator } = body
          if (!isDid(subject) || !isDid(creator)) {
            return xrpcError(res, 400, 'InvalidRequest', 'subject and creator required')
          }
          const found =
            pathname === '/admin/lapse'
              ? ledger.lapse(subject, creator)
              : ledger.chargeback(subject, creator)
          return json(res, found ? 200 : 404, { ok: found })
        }
        case 'POST /admin/spaces': {
          if (typeof body.space !== 'string' || !isDid(body.creator)) {
            return xrpcError(res, 400, 'InvalidRequest', 'space and creator required')
          }
          ledger.mapSpace(body.space, body.creator)
          return json(res, 200, { ok: true })
        }
        case 'POST /admin/voucher': {
          const { subject, creator } = body
          if (!isDid(subject) || !isDid(creator)) {
            return xrpcError(res, 400, 'InvalidRequest', 'subject and creator required')
          }
          const token = await createVoucher({
            signer: identity.keypair,
            kid: identity.kid,
            sub: subject,
            crt: creator,
            tn: typeof body.tierName === 'string' ? body.tierName : undefined,
          })
          return json(res, 200, { token })
        }
      }
      return xrpcError(res, 404, 'NotFound', 'unknown admin endpoint')
    }

    return xrpcError(res, 404, 'MethodNotImplemented', `unknown route ${req.method} ${pathname}`)
  }

  return {
    server,
    ledger,
    identity,
    createSession: (did) => {
      const token = randomBytes(16).toString('hex')
      sessions.set(token, did)
      return token
    },
    registerService: (did, didKey) => void serviceKeys.set(did, didKey),
    registerOffer: (creator, offer) =>
      void offers.set(creator, { authorizedServices: offer.authorizedServices ?? [] }),
  }
}
