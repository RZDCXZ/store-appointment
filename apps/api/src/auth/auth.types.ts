import type { FastifyRequest } from "fastify";
import type { BackofficeAccount } from "@rongguang/contracts";

export type BackofficeIdentity = BackofficeAccount;

export interface AuthenticatedRequest extends FastifyRequest {
  backofficeIdentity: BackofficeIdentity;
}

export type SessionResolution =
  | { kind: "authenticated"; account: BackofficeIdentity }
  | { kind: "expired" }
  | { kind: "unauthenticated" };
