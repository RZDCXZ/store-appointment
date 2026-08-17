import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  DemoCustomerChoice,
  MiniappCustomerProfile,
  MiniappSessionResponse,
} from "@rongguang/contracts";

import { getMiniappSessionTtlSeconds } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import type { CustomerIdentity, CustomerSessionResolution } from "./customer-session.types.js";

interface CustomerRow {
  id: string;
  demo_key: string;
  display_name: string;
  phone: string;
  story: DemoCustomerChoice["story"];
}

interface SessionRow extends CustomerRow {
  expired: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function toProfile(customer: CustomerRow): MiniappCustomerProfile {
  return {
    displayName: customer.display_name,
    phoneMasked: maskPhone(customer.phone),
    story: customer.story,
    avatarInitial: customer.display_name.slice(0, 1),
  };
}

function toChoice(customer: CustomerRow): DemoCustomerChoice {
  return {
    key: customer.demo_key,
    displayName: customer.display_name,
    story: customer.story,
    avatarInitial: customer.display_name.slice(0, 1),
  };
}

function toIdentity(customer: CustomerRow): CustomerIdentity {
  return { id: customer.id, ...toProfile(customer) };
}

@Injectable()
export class CustomerSessionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listChoices(): Promise<DemoCustomerChoice[]> {
    const result = await this.database.pool.query<CustomerRow>(
      `
        SELECT customer.id,
               profile.demo_key,
               customer.display_name,
               customer.phone,
               profile.story
        FROM demo_customer_profiles AS profile
        JOIN customers AS customer ON customer.id = profile.customer_id
        ORDER BY profile.sort_order
      `,
    );

    return result.rows.map(toChoice);
  }

  async create(demoKey: string): Promise<MiniappSessionResponse | null> {
    const customerResult = await this.database.pool.query<CustomerRow>(
      `
        SELECT customer.id,
               profile.demo_key,
               customer.display_name,
               customer.phone,
               profile.story
        FROM demo_customer_profiles AS profile
        JOIN customers AS customer ON customer.id = profile.customer_id
        WHERE profile.demo_key = $1
      `,
      [demoKey],
    );
    const customer = customerResult.rows[0];

    if (!customer) {
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    const ttlSeconds = getMiniappSessionTtlSeconds();
    await this.database.pool.query(
      "DELETE FROM customer_sessions WHERE expires_at <= now() - interval '7 days'",
    );
    const sessionResult = await this.database.pool.query<{ expires_at: Date }>(
      `
        INSERT INTO customer_sessions (token_hash, customer_id, expires_at)
        VALUES ($1, $2, now() + ($3 * interval '1 second'))
        RETURNING expires_at
      `,
      [hashToken(token), customer.id, ttlSeconds],
    );
    const expiresAt = sessionResult.rows[0]?.expires_at;

    if (!expiresAt) {
      throw new Error("顾客会话未返回过期时间");
    }

    return {
      accessToken: token,
      expiresAt: expiresAt.toISOString(),
      customerKey: customer.demo_key,
      customer: toProfile(customer),
    };
  }

  async resolve(token: string | null): Promise<CustomerSessionResolution> {
    if (!token) {
      return { kind: "unauthenticated" };
    }

    const hash = hashToken(token);
    const result = await this.database.pool.query<SessionRow>(
      `
        SELECT customer.id,
               profile.demo_key,
               customer.display_name,
               customer.phone,
               profile.story,
               session.expires_at <= now() AS expired
        FROM customer_sessions AS session
        JOIN customers AS customer ON customer.id = session.customer_id
        JOIN demo_customer_profiles AS profile ON customer.id = profile.customer_id
        WHERE session.token_hash = $1
      `,
      [hash],
    );
    const session = result.rows[0];

    if (!session) {
      return { kind: "unauthenticated" };
    }

    if (session.expired) {
      await this.database.pool.query("DELETE FROM customer_sessions WHERE token_hash = $1", [hash]);
      return { kind: "expired" };
    }

    return { kind: "authenticated", customer: toIdentity(session) };
  }
}
