/**
 * Create a test account on a spaces PDS (the hosted alpha needs the invite
 * code from your BPS account at bsky.network/account).
 *
 *   PDS_URL=https://… HANDLE=ben-payments.… PASSWORD=… EMAIL=… INVITE=… \
 *     node dist/create-account.js
 */
import { AtpAgent } from '@atproto/api'
import { requireEnv } from './spaces-demo.js'

const main = async () => {
  const agent = new AtpAgent({ service: requireEnv('PDS_URL') })
  const res = await agent.com.atproto.server.createAccount({
    handle: requireEnv('HANDLE'),
    password: requireEnv('PASSWORD'),
    email: requireEnv('EMAIL'),
    inviteCode: process.env.INVITE || undefined,
  })
  console.log(`created ${res.data.handle}`)
  console.log(`did: ${res.data.did}`)
}

main().catch((err) => {
  console.error('failed:', err)
  process.exitCode = 1
})
