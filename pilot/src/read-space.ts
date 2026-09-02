/**
 * Supporter side, against any spaces PDS: try to enter the space. The PDS
 * phones the issuer backend (managing app) and the answer follows the ledger.
 * DENIED before subscribing, the gated post after — run it either side of a
 * subscription being settled on the issuer.
 *
 *   PDS_URL=… HANDLE=… PASSWORD=… SPACE='at://…' REPO=did:… RKEY=… \
 *     node dist/read-space.js
 */
import { writeFileSync } from 'node:fs'
import { getSpaceBlob, login, readGatedRecord, requestSpaceCredential, requireEnv } from './spaces-demo.js'

const COLLECTION = process.env.COLLECTION ?? 'network.eurosky.payments.gatedPost'

const main = async () => {
  const pdsUrl = requireEnv('PDS_URL')
  const space = requireEnv('SPACE')
  const agent = await login(pdsUrl, requireEnv('HANDLE'), requireEnv('PASSWORD'))

  const attempt = await requestSpaceCredential(agent, pdsUrl, space)
  if (!attempt.ok) {
    console.log(`🔒 DENIED (${attempt.error}${attempt.message ? `: ${attempt.message}` : ''})`)
    console.log('   The space authority asked the issuer backend and the ledger said no.')
    return
  }
  console.log('🔑 space credential minted — the ledger said yes')

  const record = await readGatedRecord(pdsUrl, {
    credential: attempt.credential,
    key: attempt.key,
    space,
    repo: requireEnv('REPO'),
    collection: COLLECTION,
    rkey: requireEnv('RKEY'),
  })
  const value = record.value as { text?: string; image?: { ref?: { $link?: string } } }
  console.log(`🔓 "${String(value.text ?? '')}"`)
  const cid = value.image?.ref?.$link
  if (cid) {
    const bytes = await getSpaceBlob(pdsUrl, {
      credential: attempt.credential, key: attempt.key,
      space, repo: requireEnv('REPO'), cid,
    })
    const out = `gated-${cid.slice(-8)}.png`
    writeFileSync(out, bytes)
    console.log(`🖼  gated photo fetched from the space → ${out} (${bytes.length} bytes)`)
  }
}

main().catch((err) => {
  console.error('failed:', err)
  process.exitCode = 1
})
