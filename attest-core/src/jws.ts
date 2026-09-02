import { parseDidKey, verifySignature, type Keypair } from '@atproto/crypto'
import { AttestError } from './errors.js'

export const SUPPORTED_ALGS = ['ES256K', 'ES256'] as const
export type SupportedAlg = (typeof SUPPORTED_ALGS)[number]

export interface JwsHeader {
  typ: string
  alg: SupportedAlg
  kid: string
}

export interface DecodedJws {
  header: JwsHeader
  payload: Record<string, unknown>
  /** The bytes the signature covers: utf8("{b64url(header)}.{b64url(payload)}"). */
  signingInput: Uint8Array
  sig: Uint8Array
}

const b64urlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

const b64urlDecode = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new AttestError('MALFORMED', 'invalid base64url segment')
  return new Uint8Array(Buffer.from(s, 'base64url'))
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** Produce a compact JWS over `payload`, signed by `signer`. */
export const signCompact = async (
  header: JwsHeader,
  payload: Record<string, unknown>,
  signer: Keypair,
): Promise<string> => {
  if (signer.jwtAlg !== header.alg) {
    throw new AttestError('BAD_ALG', `signer is ${signer.jwtAlg} but header declares ${header.alg}`)
  }
  const h = b64urlEncode(utf8(JSON.stringify(header)))
  const p = b64urlEncode(utf8(JSON.stringify(payload)))
  const sig = await signer.sign(utf8(`${h}.${p}`))
  return `${h}.${p}.${b64urlEncode(sig)}`
}

/** Decode a compact JWS without verifying it. */
export const decodeCompact = (token: string): DecodedJws => {
  const parts = token.split('.')
  if (parts.length !== 3) throw new AttestError('MALFORMED', 'not a compact JWS')
  const [h, p, s] = parts
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(Buffer.from(b64urlDecode(h)).toString('utf8'))
    payload = JSON.parse(Buffer.from(b64urlDecode(p)).toString('utf8'))
  } catch {
    throw new AttestError('MALFORMED', 'header or payload is not valid JSON')
  }
  if (
    typeof header !== 'object' || header === null ||
    typeof (header as JwsHeader).typ !== 'string' ||
    typeof (header as JwsHeader).alg !== 'string' ||
    typeof (header as JwsHeader).kid !== 'string'
  ) {
    throw new AttestError('MALFORMED', 'header must carry typ, alg, kid')
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new AttestError('MALFORMED', 'payload must be an object')
  }
  return {
    header: header as JwsHeader,
    payload: payload as Record<string, unknown>,
    signingInput: utf8(`${h}.${p}`),
    sig: b64urlDecode(s),
  }
}

/**
 * Verify a decoded JWS signature against a public key given as a did:key.
 * Checks that the key's algorithm matches the header's declared alg.
 */
export const verifyCompact = async (jws: DecodedJws, didKey: string): Promise<boolean> => {
  if (!(SUPPORTED_ALGS as readonly string[]).includes(jws.header.alg)) {
    throw new AttestError('BAD_ALG', `unsupported alg ${jws.header.alg}`)
  }
  const { jwtAlg } = parseDidKey(didKey)
  if (jwtAlg !== jws.header.alg) {
    throw new AttestError('BAD_ALG', `key is ${jwtAlg} but header declares ${jws.header.alg}`)
  }
  return verifySignature(didKey, jws.signingInput, jws.sig)
}
