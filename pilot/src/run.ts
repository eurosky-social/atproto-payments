/**
 * Spaces-alpha pilot (PLAN 2.7): the end-to-end story on real protocol
 * primitives, everything running locally —
 *
 *   1. a spaces-enabled PDS + PLC (@atproto/dev-env, spaces-alpha snapshot)
 *   2. the mock issuer as a managing app, registered on the local PLC
 *   3. Ben's subscriber space, policy managing-app → the issuer
 *   4. Anna denied → fake tip settles → Anna admitted → reads gated post
 *   5. lapse → next credential mint denied again
 *
 * Alpha surface; demo only. Never real money, never sensitive data.
 */
import { AtpAgent } from '@atproto/api'
import { Secp256k1Keypair } from '@atproto/crypto'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import { JoseKey } from '@atproto/jwk-jose'
import { createDpopProof } from '@atproto/space'
import * as plc from '@did-plc/lib'
import { createMockIssuer, type IssuerIdentity } from '@atproto-payments/mock-issuer'

const MOCK_PORT = 4025
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`
const SPACE_TYPE = 'network.eurosky.payments.subscribers'
const GATED_COLLECTION = 'network.eurosky.payments.gatedPost'

const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`)
const info = (msg: string) => console.log(`    ${msg}`)

type CredentialAttempt =
  | { ok: true; credential: string; key: JoseKey }
  | { ok: false; error: string; message?: string }

const main = async () => {
  step(1, 'Starting a local ATProto network (PLC + spaces-enabled PDS)…')
  const network = await TestNetworkNoAppView.create({})
  const sc = network.getSeedClient()
  const ben = await sc.createAccount('ben', {
    handle: 'ben.test',
    email: 'ben@test.invalid',
    password: 'ben-pass',
  })
  const anna = await sc.createAccount('anna', {
    handle: 'anna.test',
    email: 'anna@test.invalid',
    password: 'anna-pass',
  })
  info(`pds:  ${network.pds.url}`)
  info(`ben  (creator):   ${ben.did}`)
  info(`anna (supporter): ${anna.did}`)

  step(2, 'Registering the issuer on the local PLC (did:plc with a #payments_issuer service entry)…')
  const issuerKeypair = await Secp256k1Keypair.create()
  const plcClient = network.plc.getClient()
  const op = await plc.signOperation(
    {
      type: 'plc_operation',
      verificationMethods: {
        atproto: issuerKeypair.did(),
        payments_attest: issuerKeypair.did(),
      },
      rotationKeys: [issuerKeypair.did()],
      alsoKnownAs: [],
      services: {
        payments_issuer: { type: 'AtprotoPaymentIssuer', endpoint: MOCK_URL },
      },
      prev: null,
    },
    issuerKeypair,
  )
  const issuerDid = await plc.didForCreateOp(op)
  await plcClient.sendOperation(issuerDid, op)
  const managingApp = `${issuerDid}#payments_issuer`
  info(`issuer:       ${issuerDid}`)
  info(`managing app: ${managingApp}`)

  step(3, `Starting the mock issuer on ${MOCK_URL}…`)
  const identity: IssuerIdentity = {
    did: issuerDid,
    kid: `${issuerDid}#payments_attest`,
    didKey: issuerKeypair.did(),
    keypair: issuerKeypair,
  }
  const issuer = createMockIssuer(identity)
  await new Promise<void>((resolve) => issuer.server.listen(MOCK_PORT, '127.0.0.1', resolve))
  // The PDS signs its checkUserAccess call with Ben's repo signing key
  // (iss = the space authority = Ben). Register it so the call verifies.
  const benSigningKey = await network.pds.ctx.actorStore.keypair(ben.did)
  issuer.registerService(ben.did, benSigningKey.did())
  info('issuer up; ben registered as a known space authority')

  step(4, 'Ben creates his subscriber space, gated by policy managing-app → the issuer…')
  const benAgent = new AtpAgent({ service: network.pds.url })
  await benAgent.login({ identifier: ben.handle, password: 'ben-pass' })
  const created = await benAgent.com.atproto.simplespace.createSpace({
    type: SPACE_TYPE,
    skey: 'self',
    policy: { $type: 'com.atproto.simplespace.defs#managingAppPolicy', managingApp },
    appAccess: { $type: 'com.atproto.simplespace.defs#open' },
  })
  const spaceUri: string = created.data.uri
  info(`space: ${spaceUri}`)
  issuer.ledger.mapSpace(spaceUri, ben.did)

  step(5, 'Ben writes a subscriber-only post into the space…')
  const post = await benAgent.com.atproto.space.createRecord({
    space: spaceUri as never,
    repo: ben.did as never,
    collection: GATED_COLLECTION,
    record: {
      $type: GATED_COLLECTION,
      text: 'Gold members: the new photo series drops Friday. 📸',
      createdAt: new Date().toISOString(),
    },
  })
  const rkey = String(post.data.uri).split('/').pop() as string
  info(`gated record: ${post.data.uri}`)

  const annaAgent = new AtpAgent({ service: network.pds.url })
  await annaAgent.login({ identifier: anna.handle, password: 'anna-pass' })

  const requestSpaceCredential = async (): Promise<CredentialAttempt> => {
    const delegation = await annaAgent.com.atproto.space.getDelegationToken({
      space: spaceUri as never,
    })
    const key = await JoseKey.generate(['ES256'])
    const url = `${network.pds.url}/xrpc/com.atproto.space.getSpaceCredential`
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${delegation.data.token}`,
      },
      body: JSON.stringify({ space: spaceUri }),
    })
    request.headers.set('dpop', await createDpopProof(key, { htm: 'POST', htu: url }))
    const res = await fetch(request)
    const body = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      return { ok: false, error: String(body.error), message: body.message as string | undefined }
    }
    return { ok: true, credential: body.credential as string, key }
  }

  const readGatedPost = async (credential: string, key: JoseKey) => {
    const url = new URL(`${network.pds.url}/xrpc/com.atproto.space.getRecord`)
    url.searchParams.set('space', spaceUri)
    url.searchParams.set('repo', ben.did)
    url.searchParams.set('collection', GATED_COLLECTION)
    url.searchParams.set('rkey', rkey)
    const request = new Request(url, {
      headers: { authorization: `DPoP ${credential}` },
    })
    request.headers.set(
      'dpop',
      await createDpopProof(key, { htm: 'GET', htu: request.url, credential }),
    )
    const res = await fetch(request)
    const body = (await res.json()) as Record<string, unknown>
    if (!res.ok) throw new Error(`getRecord failed: ${JSON.stringify(body)}`)
    return body
  }

  step(6, 'Anna asks for space access BEFORE paying — the doorman phones the issuer…')
  const before = await requestSpaceCredential()
  if (before.ok) throw new Error('expected the credential to be DENIED before payment')
  info(`DENIED as expected (${before.error}${before.message ? `: ${before.message}` : ''})`)

  step(7, 'Anna "tips" — the fake payment settles on the issuer ledger (admin API)…')
  const settle = await fetch(`${MOCK_URL}/admin/entitlements`, {
    method: 'POST',
    body: JSON.stringify({ subject: anna.did, creator: ben.did, tier: 'gold' }),
  })
  if (!settle.ok) throw new Error('settle failed')
  info('ledger: anna → ben, tier gold, ACTIVE')

  step(8, 'Anna asks again — the doorman phones the issuer, the issuer says yes…')
  const after = await requestSpaceCredential()
  if (!after.ok) throw new Error(`expected a credential, got ${after.error}: ${after.message}`)
  info('space credential minted (DPoP-bound, 2h)')

  step(9, "Anna reads Ben's subscriber-only post with the space credential…")
  const gated = await readGatedPost(after.credential, after.key)
  const value = gated.value as Record<string, unknown>
  info(`🔓 "${String(value.text)}"`)

  step(10, 'Anna lapses — the next credential mint is denied again…')
  await fetch(`${MOCK_URL}/admin/lapse`, {
    method: 'POST',
    body: JSON.stringify({ subject: anna.did, creator: ben.did }),
  })
  const lapsed = await requestSpaceCredential()
  if (lapsed.ok) throw new Error('expected the credential to be DENIED after lapse')
  info(`DENIED again (${lapsed.error}) — billing truth IS access truth, no lists synced`)

  console.log('\n✔ pilot complete: pay → the space opens in any app; lapse → it closes.')
  console.log('  (Outstanding space credentials live ≤2h — revocation happens at the mint boundary,')
  console.log('   exactly as designed in proposal 0016 and mirrored by our ≤7d entitlement cards.)')

  issuer.server.close()
  await network.close()
}

main().catch((err) => {
  console.error('\n✘ pilot failed:', err)
  process.exitCode = 1
})
