export type EntitlementStatus = 'active' | 'lapsed' | 'chargeback'

export interface Entitlement {
  subject: string
  creator: string
  tier: string
  periodEnd?: Date
  status: EntitlementStatus
}

const key = (subject: string, creator: string) => `${subject} ${creator}`

/**
 * The fake ledger: what a real issuer keeps in its regulated, private
 * database. Nothing here ever appears on the protocol — that is the point.
 */
export class Ledger {
  private entitlements = new Map<string, Entitlement>()
  /** space URI → creator DID whose subscription gates that space. */
  private spaceCreators = new Map<string, string>()

  settle(input: { subject: string; creator: string; tier: string; periodEnd?: Date }): Entitlement {
    const entitlement: Entitlement = { ...input, status: 'active' }
    this.entitlements.set(key(input.subject, input.creator), entitlement)
    return entitlement
  }

  lapse(subject: string, creator: string): boolean {
    const e = this.entitlements.get(key(subject, creator))
    if (!e) return false
    e.status = 'lapsed'
    return true
  }

  chargeback(subject: string, creator: string): boolean {
    const e = this.entitlements.get(key(subject, creator))
    if (!e) return false
    e.status = 'chargeback'
    return true
  }

  /** The single source of truth for "is this person paying right now?". */
  active(subject: string, creator: string, now = new Date()): Entitlement | null {
    const e = this.entitlements.get(key(subject, creator))
    if (!e || e.status !== 'active') return null
    if (e.periodEnd && e.periodEnd.getTime() <= now.getTime()) return null
    return e
  }

  activeAll(subject: string, now = new Date()): Entitlement[] {
    const out: Entitlement[] = []
    for (const e of this.entitlements.values()) {
      if (e.subject === subject && this.active(subject, e.creator, now)) out.push(e)
    }
    return out
  }

  mapSpace(space: string, creator: string): void {
    this.spaceCreators.set(space, creator)
  }

  creatorForSpace(space: string): string | undefined {
    return this.spaceCreators.get(space)
  }

  snapshot() {
    return {
      entitlements: [...this.entitlements.values()].map((e) => ({
        ...e,
        periodEnd: e.periodEnd?.toISOString(),
      })),
      spaces: Object.fromEntries(this.spaceCreators),
    }
  }
}
