/**
 * Shared helpers for driving a spaces-enabled PDS — used by the local pilot
 * (run.ts) and by the PDS-agnostic demo scripts (setup-space, read-space),
 * which target either the local dev-env or Bluesky's hosted alpha PDS.
 */
import { AtpAgent } from '@atproto/api'
import { P256Keypair } from '@atproto/crypto'
import {
  MAC_HEADER,
  RECORD_MAC_TYPE,
  WANT_MAC_HEADER,
  createSpaceSigHeaders,
  encapsulate,
  formatWantMacHeader,
  parseMacHeader,
  verifyRecord,
} from '@atproto/space'

export type CredentialAttempt =
  | { ok: true; credential: string; key: P256Keypair }
  | { ok: false; error: string; message?: string }

export const login = async (pdsUrl: string, identifier: string, password: string): Promise<AtpAgent> => {
  const agent = new AtpAgent({ service: pdsUrl })
  await agent.login({ identifier, password })
  return agent
}

export const createSpaceWithManagingApp = async (
  agent: AtpAgent,
  opts: { type: string; skey: string; managingApp: string },
): Promise<string> => {
  const created = await agent.com.atproto.simplespace.createSpace({
    // `spaceType` since the alpha's 2026-10-01 release.
    spaceType: opts.type,
    skey: opts.skey,
    readPolicy: { $type: 'com.atproto.simplespace.defs#managingAppPolicy', managingApp: opts.managingApp },
    // Only Ben writes here. A member-list policy over a list nobody is on
    // refuses everyone else, and Ben needs no entry: he is the space authority,
    // whom the host admits without consulting the managing app.
    writePolicy: { $type: 'com.atproto.simplespace.defs#memberListPolicy' },
    appAccess: { $type: 'com.atproto.simplespace.defs#open' },
  })
  return created.data.uri
}

export const writeGatedPost = async (
  agent: AtpAgent,
  opts: { space: string; repo: string; collection: string; text: string; image?: Uint8Array },
): Promise<{ uri: string; rkey: string }> => {
  const record: Record<string, unknown> = {
    $type: opts.collection,
    text: opts.text,
    createdAt: new Date().toISOString(),
  }
  if (opts.image) {
    // An ordinary blob on the creator's PDS; embedding it in a space record is
    // what puts it behind the doorman.
    const blob = await agent.com.atproto.repo.uploadBlob(opts.image, { encoding: 'image/png' })
    record.image = blob.data.blob
  }
  const post = await agent.com.atproto.space.createRecord({
    space: opts.space as never,
    repo: opts.repo as never,
    collection: opts.collection,
    record: record as never,
  })
  const uri = String(post.data.uri)
  return { uri, rkey: uri.split('/').pop() as string }
}

/**
 * The doorman transaction: delegation token → space credential.
 *
 * Since the alpha's 2026-10-22 release everything travels in the body. The
 * credential is bound to a fresh P-256 key we name as `credentialKid`, and
 * every later request that uses it is signed with that key.
 */
export const requestSpaceCredential = async (
  agent: AtpAgent,
  pdsUrl: string,
  space: string,
): Promise<CredentialAttempt> => {
  const delegation = await agent.com.atproto.space.getDelegationToken({ space: space as never })
  const key = await P256Keypair.create()
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.space.getSpaceCredential`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ space, credentialKid: key.did(), delegationToken: delegation.data.token }),
  })
  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    return { ok: false, error: String(body.error), message: body.message as string | undefined }
  }
  return { ok: true, credential: body.credential as string, key }
}

/** The credential presented to the repo being read, signed by the key it is bound to. */
const credentialHeaders = (key: P256Keypair, credential: string, repo: string) =>
  createSpaceSigHeaders(key, {
    authorization: `Atproto-Space-Credential ${credential}`,
    audience: repo as `did:${string}:${string}`,
  })

/**
 * The author's `#atproto_kem` key, as a did:key. A repo host authenticates a
 * getRecord response with a MAC keyed by a secret only the reader and the
 * author's host can derive from it.
 */
export const resolveKemKey = async (did: string, plcUrl = 'https://plc.directory'): Promise<string> => {
  if (did.startsWith('did:plc:')) {
    // The operation itself, not the rendered document: the operation carries
    // the key as a did:key everywhere, while the rendered document depends on
    // the directory — the dev-env's PLC still renders the legacy uncompressed
    // `EcdsaSecp256r1VerificationKey2019` form, which encapsulate() refuses.
    const data = (await (await fetch(`${plcUrl}/${did}/data`)).json()) as {
      verificationMethods?: Record<string, string>
    }
    const kem = data.verificationMethods?.atproto_kem
    if (!kem) throw new Error(`${did} publishes no #atproto_kem key`)
    return kem
  }
  const doc = (await (await fetch(`https://${did.slice('did:web:'.length)}/.well-known/did.json`)).json()) as {
    verificationMethod?: { id: string; type?: string; publicKeyMultibase?: string }[]
  }
  const kem = doc.verificationMethod?.find((m) => m.id === `${did}#atproto_kem` || m.id === '#atproto_kem')
  if (kem?.type !== 'Multikey' || !kem.publicKeyMultibase) throw new Error(`${did} publishes no Multikey #atproto_kem key`)
  return `did:key:${kem.publicKeyMultibase}`
}

/**
 * One gated record, verified. getRecord is MAC-bearing: the request carries a
 * key share for a fresh shared secret, and the record is accepted only if the
 * MAC the host returns covers exactly the URI we asked for and the CID its
 * value encodes to.
 */
export const readGatedRecord = async (
  pdsUrl: string,
  opts: {
    credential: string
    key: P256Keypair
    space: string
    repo: string
    collection: string
    rkey: string
    kemKey: string
  },
): Promise<Record<string, unknown>> => {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.space.getRecord`)
  url.searchParams.set('space', opts.space)
  url.searchParams.set('repo', opts.repo)
  url.searchParams.set('collection', opts.collection)
  url.searchParams.set('rkey', opts.rkey)
  const { keyShare, sharedSecret } = await encapsulate(opts.kemKey)
  const res = await fetch(url, {
    headers: {
      ...(await credentialHeaders(opts.key, opts.credential, opts.repo)),
      [WANT_MAC_HEADER]: formatWantMacHeader(RECORD_MAC_TYPE, keyShare),
    },
  })
  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`getRecord failed: ${JSON.stringify(body)}`)

  const uri = `${opts.space}/${opts.repo}/${opts.collection}/${opts.rkey}`
  const mac = parseMacHeader(res.headers.get(MAC_HEADER) ?? undefined, RECORD_MAC_TYPE)
  const record = body as { uri: string; cid: string; value: never }
  if (!(await verifyRecord(record, { uri, sharedSecret, mac }))) {
    throw new Error(`getRecord returned a record its MAC does not vouch for: ${record.uri}`)
  }
  return body
}

export const getSpaceBlob = async (
  pdsUrl: string,
  opts: { credential: string; key: P256Keypair; space: string; repo: string; cid: string },
): Promise<Uint8Array> => {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.space.getBlob`)
  url.searchParams.set('space', opts.space)
  url.searchParams.set('repo', opts.repo)
  url.searchParams.set('cid', opts.cid)
  // Blobs carry no MAC: the signature on the credential is all getBlob asks for.
  const res = await fetch(url, { headers: await credentialHeaders(opts.key, opts.credential, opts.repo) })
  if (!res.ok) throw new Error(`space getBlob failed: ${res.status} ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}

export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    console.error(`missing env: ${name}`)
    process.exit(1)
  }
  return value
}
