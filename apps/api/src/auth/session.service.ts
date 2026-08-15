import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { getSessionTtlSeconds } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { BackofficeIdentity, BackofficeRole, SessionResolution } from "./auth.types.js";

interface IdentityRow {
  id: string;
  username: string;
  display_name: string;
  role: BackofficeRole;
}

interface AccountRow extends IdentityRow {
  password_hash: string;
}

interface SessionRow extends IdentityRow {
  active: boolean;
  expired: boolean;
}

function toIdentity(account: IdentityRow): BackofficeIdentity {
  return {
    id: account.id,
    username: account.username,
    displayName: account.display_name,
    role: account.role,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class SessionService {
  private readonly unknownAccountHash = hashPassword("unknown-backoffice-account");

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async authenticate(username: string, password: string): Promise<BackofficeIdentity | null> {
    const result = await this.database.pool.query<AccountRow>(
      `
        SELECT id, username, display_name, role, password_hash
        FROM backoffice_accounts
        WHERE username = $1 AND active = true
      `,
      [username.trim().toLowerCase()],
    );
    const account = result.rows[0];
    const valid = await verifyPassword(
      password,
      account?.password_hash ?? (await this.unknownAccountHash),
    );

    return account && valid ? toIdentity(account) : null;
  }

  async create(accountId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");

    await this.database.pool.query("DELETE FROM backoffice_sessions WHERE expires_at <= now()");
    await this.database.pool.query(
      `
        INSERT INTO backoffice_sessions (token_hash, account_id, expires_at)
        VALUES ($1, $2, now() + ($3 * interval '1 second'))
      `,
      [tokenHash(token), accountId, getSessionTtlSeconds()],
    );

    return token;
  }

  async resolve(token: string | null): Promise<SessionResolution> {
    if (!token) {
      return { kind: "unauthenticated" };
    }

    const hash = tokenHash(token);
    const result = await this.database.pool.query<SessionRow>(
      `
        SELECT account.id,
               account.username,
               account.display_name,
               account.role,
               account.active,
               session.expires_at <= now() AS expired
        FROM backoffice_sessions AS session
        JOIN backoffice_accounts AS account ON account.id = session.account_id
        WHERE session.token_hash = $1
      `,
      [hash],
    );
    const session = result.rows[0];

    if (!session) {
      return { kind: "unauthenticated" };
    }

    if (session.expired || !session.active) {
      await this.database.pool.query("DELETE FROM backoffice_sessions WHERE token_hash = $1", [
        hash,
      ]);
      return session.expired ? { kind: "expired" } : { kind: "unauthenticated" };
    }

    return { kind: "authenticated", account: toIdentity(session) };
  }

  async revoke(token: string | null): Promise<void> {
    if (token) {
      await this.database.pool.query("DELETE FROM backoffice_sessions WHERE token_hash = $1", [
        tokenHash(token),
      ]);
    }
  }

  async findActiveAccount(accountId: string): Promise<BackofficeIdentity | null> {
    const result = await this.database.pool.query<IdentityRow>(
      `
        SELECT id, username, display_name, role
        FROM backoffice_accounts
        WHERE id = $1 AND active = true
      `,
      [accountId],
    );

    return result.rows[0] ? toIdentity(result.rows[0]) : null;
  }
}
