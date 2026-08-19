import { Inject, Injectable, type MessageEvent } from "@nestjs/common";
import type { ManagerRefreshHint } from "@rongguang/contracts";
import {
  catchError,
  defer,
  distinctUntilChanged,
  EMPTY,
  from,
  interval,
  map,
  merge,
  Observable,
  of,
  skip,
  startWith,
  switchMap,
  timer,
} from "rxjs";

import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class LiveRefreshService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  managerEvents(): Observable<MessageEvent> {
    return merge(
      of(this.event({ scope: "manager-live-bookings", reason: "connected" })),
      this.versionChanges(() => this.bookingVersion(), {
        scope: "manager-live-bookings",
        reason: "booking-changed",
      }),
      this.versionChanges(() => this.notificationVersion(), {
        scope: "manager-notifications",
        reason: "notification-changed",
      }),
      interval(20_000).pipe(
        map(() => this.event({ scope: "manager-live-bookings", reason: "heartbeat" })),
      ),
    );
  }

  private versionChanges(
    readVersion: () => Promise<string>,
    hint: ManagerRefreshHint,
  ): Observable<MessageEvent> {
    return defer(() => from(readVersion())).pipe(
      switchMap((initialVersion) =>
        timer(750, 750).pipe(
          switchMap(() => from(readVersion()).pipe(catchError(() => EMPTY))),
          startWith(initialVersion),
          distinctUntilChanged(),
          skip(1),
          map(() => this.event(hint)),
        ),
      ),
    );
  }

  private async bookingVersion(): Promise<string> {
    const result = await this.database.pool.query<{
      count: string;
      latest_created_at: string;
    }>(`
      SELECT
        count(*)::text AS count,
        coalesce(max(created_at)::text, '') AS latest_created_at
      FROM bookings
    `);
    const version = result.rows[0];
    return `${version?.count ?? "0"}:${version?.latest_created_at ?? ""}`;
  }

  private async notificationVersion(): Promise<string> {
    const result = await this.database.pool.query<{
      count: string;
      attempt_count: string;
      pending_count: string;
      retry_count: string;
      failed_count: string;
      sent_count: string;
    }>(`
      SELECT
        count(*)::text AS count,
        coalesce(sum(attempt_count), 0)::text AS attempt_count,
        count(*) FILTER (WHERE status IN ('pending', 'processing'))::text AS pending_count,
        count(*) FILTER (WHERE status = 'retry')::text AS retry_count,
        count(*) FILTER (WHERE status = 'failed')::text AS failed_count,
        count(*) FILTER (WHERE status = 'sent')::text AS sent_count
      FROM notification_outbox
    `);
    const version = result.rows[0];
    return [
      version?.count ?? "0",
      version?.attempt_count ?? "0",
      version?.pending_count ?? "0",
      version?.retry_count ?? "0",
      version?.failed_count ?? "0",
      version?.sent_count ?? "0",
    ].join(":");
  }

  private event(hint: ManagerRefreshHint): MessageEvent {
    return {
      data: hint,
      type: hint.reason === "heartbeat" ? "heartbeat" : "refresh",
      retry: 1_000,
    };
  }
}
