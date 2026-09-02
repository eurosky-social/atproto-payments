/**
 * Creator side, against any spaces PDS: create the subscriber space with
 * policy managing-app → the issuer backend, and write a gated post into it.
 *
 *   PDS_URL=… HANDLE=… PASSWORD=… MANAGING_APP='did:…#payments_issuer' \
 *     node dist/setup-space.js
 *
 * Prints the space URI (paste it into the merchant dashboard's "Link space")
 * and the gated record's location (for read-space).
 */
import {
  createSpaceWithManagingApp,
  login,
  requireEnv,
  writeGatedPost,
} from './spaces-demo.js'

const SPACE_TYPE = process.env.SPACE_TYPE ?? 'network.eurosky.payments.subscribers'
const SKEY = process.env.SKEY ?? 'self'
const COLLECTION = process.env.COLLECTION ?? 'network.eurosky.payments.gatedPost'
const TEXT = process.env.TEXT ?? 'Subscribers only: the new series drops Friday. 📸'

const main = async () => {
  const pdsUrl = requireEnv('PDS_URL')
  const agent = await login(pdsUrl, requireEnv('HANDLE'), requireEnv('PASSWORD'))
  const did = agent.session?.did as string

  const space = await createSpaceWithManagingApp(agent, {
    type: SPACE_TYPE,
    skey: SKEY,
    managingApp: requireEnv('MANAGING_APP'),
  }).catch(async (err: unknown) => {
    // Space may already exist from an earlier run — reuse it.
    if (String(err).includes('SpaceAlreadyExists')) {
      return `at://${did}/space/${SPACE_TYPE}/${SKEY}`
    }
    throw err
  })
  console.log(`space:  ${space}`)

  const post = await writeGatedPost(agent, { space, repo: did, collection: COLLECTION, text: TEXT })
  console.log(`record: ${post.uri}`)
  console.log('')
  console.log('Next: link the space in the merchant dashboard, then try read-space as the supporter:')
  console.log(
    `  PDS_URL=${pdsUrl} HANDLE=<supporter> PASSWORD=… SPACE='${space}' REPO=${did} RKEY=${post.rkey} node dist/read-space.js`,
  )
}

main().catch((err) => {
  console.error('failed:', err)
  process.exitCode = 1
})
