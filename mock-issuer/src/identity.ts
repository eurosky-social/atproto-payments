import { Secp256k1Keypair, type Keypair } from '@atproto/crypto'

export interface IssuerIdentity {
  /** The issuer's DID (what goes in offer records' authorizedIssuers). */
  did: string
  /** Verification method id credentials are signed under. */
  kid: string
  /** did:key of the signing keypair — what a resolver should return for kid. */
  didKey: string
  /** Structural Keypair interface, so keypairs from other @atproto/crypto versions work. */
  keypair: Keypair
}

export const createIdentity = async (did = 'did:web:pay.mock.test'): Promise<IssuerIdentity> => {
  const keypair = await Secp256k1Keypair.create()
  return { did, kid: `${did}#payments_attest`, didKey: keypair.did(), keypair }
}
