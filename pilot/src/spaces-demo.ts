/**
 * Shared helpers for driving a spaces-enabled PDS — used by the local pilot
 * (run.ts) and by the PDS-agnostic demo scripts (setup-space, read-space),
 * which target either the local dev-env or Bluesky's hosted alpha PDS.
 */
import { AtpAgent } from '@atproto/api'
import { JoseKey } from '@atproto/jwk-jose'
import { createDpopProof } from '@atproto/space'

export type CredentialAttempt =
  | { ok: true; credential: string; key: JoseKey }
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
    type: opts.type,
    skey: opts.skey,
    policy: { $type: 'com.atproto.simplespace.defs#managingAppPolicy', managingApp: opts.managingApp },
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

/** The doorman transaction: delegation token → DPoP-bound space credential. */
export const requestSpaceCredential = async (
  agent: AtpAgent,
  pdsUrl: string,
  space: string,
): Promise<CredentialAttempt> => {
  const delegation = await agent.com.atproto.space.getDelegationToken({ space: space as never })
  const key = await JoseKey.generate(['ES256'])
  const url = `${pdsUrl}/xrpc/com.atproto.space.getSpaceCredential`
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${delegation.data.token}`,
    },
    body: JSON.stringify({ space }),
  })
  request.headers.set('dpop', await createDpopProof(key, { htm: 'POST', htu: url }))
  const res = await fetch(request)
  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    return { ok: false, error: String(body.error), message: body.message as string | undefined }
  }
  return { ok: true, credential: body.credential as string, key }
}

export const readGatedRecord = async (
  pdsUrl: string,
  opts: { credential: string; key: JoseKey; space: string; repo: string; collection: string; rkey: string },
): Promise<Record<string, unknown>> => {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.space.getRecord`)
  url.searchParams.set('space', opts.space)
  url.searchParams.set('repo', opts.repo)
  url.searchParams.set('collection', opts.collection)
  url.searchParams.set('rkey', opts.rkey)
  const request = new Request(url, { headers: { authorization: `DPoP ${opts.credential}` } })
  request.headers.set(
    'dpop',
    await createDpopProof(opts.key, { htm: 'GET', htu: request.url, credential: opts.credential }),
  )
  const res = await fetch(request)
  const body = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`getRecord failed: ${JSON.stringify(body)}`)
  return body
}

export const getSpaceBlob = async (
  pdsUrl: string,
  opts: { credential: string; key: JoseKey; space: string; repo: string; cid: string },
): Promise<Uint8Array> => {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.space.getBlob`)
  url.searchParams.set('space', opts.space)
  url.searchParams.set('repo', opts.repo)
  url.searchParams.set('cid', opts.cid)
  const request = new Request(url, { headers: { authorization: `DPoP ${opts.credential}` } })
  request.headers.set(
    'dpop',
    await createDpopProof(opts.key, { htm: 'GET', htu: request.url, credential: opts.credential }),
  )
  const res = await fetch(request)
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
