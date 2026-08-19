import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import type { NotificationClock } from "./notification.clock.js";
import { NotificationService } from "./notification.service.js";

describe("NotificationService worker lifecycle", () => {
  it("waits for the active worker cycle before module shutdown completes", async () => {
    let releaseReminderQuery!: () => void;
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(
        () =>
          new Promise<{ rows: never[] }>((resolve) => {
            releaseReminderQuery = () => resolve({ rows: [] });
          }),
      )
      .mockResolvedValue({ rows: [] });
    const database = { pool: { query } } as unknown as DatabaseService;
    const clock: NotificationClock = {
      now: () => new Date("2026-08-13T02:50:00.000Z"),
    };
    const service = new NotificationService(database, clock);

    await service.onModuleInit();
    expect(releaseReminderQuery).toBeTypeOf("function");

    const shutdown = service.onModuleDestroy();
    let shutdownCompleted = false;
    void Promise.resolve(shutdown).then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);

    releaseReminderQuery();
    await shutdown;
  });
});
