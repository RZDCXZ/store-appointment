import { Injectable } from "@nestjs/common";

import { getDemoNow } from "../config/environment.js";

export const NOTIFICATION_CLOCK = Symbol("NOTIFICATION_CLOCK");

export interface NotificationClock {
  now(): Date;
}

@Injectable()
export class DemoNotificationClock implements NotificationClock {
  private readonly demoStartedAt = Date.parse(getDemoNow());
  private readonly monotonicStartedAt = performance.now();

  now(): Date {
    return new Date(this.demoStartedAt + performance.now() - this.monotonicStartedAt);
  }
}
