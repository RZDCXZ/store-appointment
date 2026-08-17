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
    return defer(() => from(this.bookingVersion())).pipe(
      switchMap((initialVersion) =>
        merge(
          of(this.event("connected")),
          timer(750, 750).pipe(
            switchMap(() => from(this.bookingVersion()).pipe(catchError(() => EMPTY))),
            startWith(initialVersion),
            distinctUntilChanged(),
            skip(1),
            map(() => this.event("booking-changed")),
          ),
          interval(20_000).pipe(map(() => this.event("heartbeat"))),
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

  private event(reason: ManagerRefreshHint["reason"]): MessageEvent {
    return {
      data: { scope: "manager-live-bookings", reason } satisfies ManagerRefreshHint,
      type: reason === "heartbeat" ? "heartbeat" : "refresh",
      retry: 1_000,
    };
  }
}
