export type AttestErrorCode =
  | 'MALFORMED'
  | 'BAD_TYP'
  | 'BAD_ALG'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'BAD_SIGNATURE'
  | 'ISSUER_KID_MISMATCH'
  | 'ISSUER_NOT_AUTHORIZED'
  | 'OFFER_NOT_FOUND'
  | 'SUBJECT_MISMATCH'
  | 'INVALID_CLAIMS'

export class AttestError extends Error {
  constructor(
    readonly code: AttestErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AttestError'
  }
}
