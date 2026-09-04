export { AttestError, type AttestErrorCode } from './errors.js'
export {
  ENT_TYP,
  MAX_TTL_SECONDS,
  createEntitlementCredential,
  verifyEntitlementCredential,
  assertSubjectBinding,
  type CreateCredentialInput,
} from './credential.js'
export {
  VCH_TYP,
  createVoucher,
  verifyVoucher,
  type CreateVoucherInput,
  type VerifyVoucherExpectations,
} from './voucher.js'
export { SUPPORTED_ALGS, type SupportedAlg, type JwsHeader, decodeCompact } from './jws.js'
export {
  MAX_APP_SHARE_BP,
  DEFAULT_ORIGINATION_WINDOW_MONTHS,
  coverageFor,
  shouldOffer,
  requiresCoverageDisclosure,
  purchasablePrices,
  purchasableTiers,
  findTier,
  deliveryRateAt,
  originationRateAt,
  originationWindowMonths,
  originationActive,
  isShareWithinBand,
  type Coverage,
} from './offer.js'
export type {
  EntitlementClaims,
  EntitlementContext,
  VoucherClaims,
  OfferRecord,
  OfferTier,
  OfferPrice,
  OfferBenefit,
  GatedSpace,
  AppShare,
  CustomAmount,
  PricePeriod,
  TierKind,
  VerifierDeps,
  ResolveOptions,
} from './types.js'
