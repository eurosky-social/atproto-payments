#!/usr/bin/env node
import { createIdentity } from './identity.js'
import { createMockIssuer } from './server.js'

const port = Number(process.env.PORT ?? 4025)
const did = process.env.ISSUER_DID ?? 'did:web:pay.mock.test'

const identity = await createIdentity(did)
const issuer = createMockIssuer(identity)

issuer.server.listen(port, '127.0.0.1', () => {
  console.log(`mock issuer listening on http://127.0.0.1:${port}`)
  console.log(`  issuer DID : ${identity.did}`)
  console.log(`  kid        : ${identity.kid}`)
  console.log(`  didKey     : ${identity.didKey}  (what resolvers should return for the kid)`)
  console.log('')
  console.log('Admin quickstart (see README.md for the full walkthrough):')
  console.log(`  curl -s http://127.0.0.1:${port}/admin/identity`)
  console.log(
    `  curl -s -X POST http://127.0.0.1:${port}/admin/entitlements -d '{"subject":"did:plc:anna","creator":"did:plc:ben","tier":"gold"}'`,
  )
})
