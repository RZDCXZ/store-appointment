import type { FastifyRequest } from "fastify";

export type BackofficeRole = "manager" | "staff";

export interface BackofficeIdentity {
  id: string;
  username: string;
  displayName: string;
  role: BackofficeRole;
}

export interface AuthenticatedRequest extends FastifyRequest {
  backofficeIdentity: BackofficeIdentity;
}

export type SessionResolution =
  | { kind: "authenticated"; account: BackofficeIdentity }
  | { kind: "expired" }
  | { kind: "unauthenticated" };
