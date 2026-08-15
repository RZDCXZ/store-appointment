import type { FastifyRequest } from "fastify";
import type { MiniappCustomerProfile } from "@rongguang/contracts";

export interface CustomerIdentity extends MiniappCustomerProfile {
  id: string;
}

export interface AuthenticatedCustomerRequest extends FastifyRequest {
  customerIdentity: CustomerIdentity;
}

export type CustomerSessionResolution =
  | { kind: "authenticated"; customer: CustomerIdentity }
  | { kind: "expired" }
  | { kind: "unauthenticated" };
