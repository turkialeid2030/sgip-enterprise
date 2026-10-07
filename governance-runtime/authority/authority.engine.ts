/**
 * Authority & Delegation Engine — Phase 6.4
 * Approval hierarchy, delegation lineage, veto rights, authority expiration.
 * Runtime-enforced — no action proceeds without authority validation.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export interface AuthorityRecord {
  readonly id:          string;
  readonly tenantId:    string;
  readonly holderId:    string;
  readonly holderRole:  string;
  readonly scope:       string[];        // entity types or IDs this authority covers
  readonly permissions: string[];        // action types allowed
  readonly maxAmount?:  number;          // financial threshold if applicable
  readonly validFrom:   string;
  readonly validTo?:    string;          // expiry — undefined = permanent
  readonly delegatedBy?:string;          // who delegated this authority
  readonly isDelegated: boolean;
  readonly vetoRight:   boolean;
  readonly dualApproval:boolean;         // requires a second approver
  readonly createdAt:   string;
}

export interface AuthorityCheck {
  authorized:   boolean;
  reason:       string;
  authority?:   AuthorityRecord;
  requiresDual: boolean;
  expired:      boolean;
}

export interface DelegationRecord {
  readonly id:          string;
  readonly tenantId:    string;
  readonly fromId:      string;
  readonly toId:        string;
  readonly scope:       string[];
  readonly permissions: string[];
  readonly validFrom:   string;
  readonly validTo?:    string;
  readonly delegatedAt: string;
  readonly delegatedBy: string;
  readonly isActive:    boolean;
}

const authorityStore   = new Map<string, AuthorityRecord>();   // tenantId:holderId:scope → authority
const delegationStore  = new Map<string, DelegationRecord>();  // delegationId → record
const authorityIdx     = new Map<string, Set<string>>();       // tenantId:holderId → authority ids

export class AuthorityEngine {
  constructor(private readonly tenantId: string) {}

  grantAuthority(params: Omit<AuthorityRecord, "id" | "tenantId" | "createdAt">): AuthorityRecord {
    const authority: AuthorityRecord = Object.freeze({ ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() });
    authorityStore.set(authority.id, authority);
    const key = `${this.tenantId}:${params.holderId}`;
    if (!authorityIdx.has(key)) authorityIdx.set(key, new Set());
    authorityIdx.get(key)!.add(authority.id);
    getEventStore(this.tenantId).append({ topic:"authority.granted", payload:{ authorityId:authority.id, holderId:params.holderId, permissions:params.permissions }, actorId:params.delegatedBy ?? "system", actorRole:"system" });
    return authority;
  }

  delegate(params: { fromId:string; toId:string; scope:string[]; permissions:string[]; validTo?:string; delegatedBy:string }): DelegationRecord {
    // Validate: fromId must have authority to delegate
    const fromAuth = this.getAuthoritiesFor(params.fromId);
    const canDelegate = fromAuth.some(a => a.permissions.includes("delegate") || a.permissions.includes("*"));
    if (!canDelegate) throw Object.assign(new Error(`${params.fromId} does not have delegation authority`), { statusCode:403 });

    const del: DelegationRecord = Object.freeze({ id:uuidv4(), tenantId:this.tenantId, ...params, validFrom:new Date().toISOString(), delegatedAt:new Date().toISOString(), isActive:true });
    delegationStore.set(del.id, del);
    // Create delegated authority for toId
    this.grantAuthority({ holderId:params.toId, holderRole:"delegated", scope:params.scope, permissions:params.permissions, validFrom:new Date().toISOString(), validTo:params.validTo, delegatedBy:params.fromId, isDelegated:true, vetoRight:false, dualApproval:false });
    getEventStore(this.tenantId).append({ topic:"authority.delegated", payload:{ fromId:params.fromId, toId:params.toId, scope:params.scope }, actorId:params.delegatedBy, actorRole:"system" });
    return del;
  }

  checkAuthority(params: { actorId:string; action:string; scope:string; amount?:number }): AuthorityCheck {
    const authorities = this.getAuthoritiesFor(params.actorId);
    const now = new Date().toISOString();

    for (const auth of authorities) {
      // Check expiry
      if (auth.validTo && auth.validTo < now) continue;
      // Check scope
      const scopeMatch = auth.scope.includes("*") || auth.scope.includes(params.scope) || auth.scope.some(s => params.scope.startsWith(s));
      if (!scopeMatch) continue;
      // Check permission
      const permMatch = auth.permissions.includes("*") || auth.permissions.includes(params.action);
      if (!permMatch) continue;
      // Check amount
      if (params.amount !== undefined && auth.maxAmount !== undefined && params.amount > auth.maxAmount) continue;

      return { authorized:true, reason:"Authority confirmed", authority:auth, requiresDual:auth.dualApproval, expired:false };
    }
    return { authorized:false, reason:`No valid authority for action "${params.action}" on scope "${params.scope}"`, requiresDual:false, expired:false };
  }

  revokeAuthority(authorityId: string, revokedBy: string): void {
    const auth = authorityStore.get(authorityId);
    if (!auth || auth.tenantId !== this.tenantId) throw Object.assign(new Error("Authority not found"), {statusCode:404});
    const revoked = Object.freeze({ ...auth, validTo:new Date().toISOString() });
    authorityStore.set(authorityId, revoked);
    getEventStore(this.tenantId).append({ topic:"authority.revoked", payload:{ authorityId, holderId:auth.holderId }, actorId:revokedBy, actorRole:"system" });
  }

  getAuthoritiesFor(holderId: string): AuthorityRecord[] {
    const ids = authorityIdx.get(`${this.tenantId}:${holderId}`) ?? new Set();
    const now = new Date().toISOString();
    return [...ids].map(id => authorityStore.get(id)!).filter(a => a?.tenantId === this.tenantId && (!a.validTo || a.validTo > now));
  }

  getDelegationLineage(holderId: string): DelegationRecord[] {
    return [...delegationStore.values()].filter(d => d.tenantId === this.tenantId && (d.fromId === holderId || d.toId === holderId) && d.isActive);
  }
}

const authCache = new Map<string, AuthorityEngine>();
export function getAuthorityEngine(tenantId: string): AuthorityEngine {
  if (!authCache.has(tenantId)) authCache.set(tenantId, new AuthorityEngine(tenantId));
  return authCache.get(tenantId)!;
}
