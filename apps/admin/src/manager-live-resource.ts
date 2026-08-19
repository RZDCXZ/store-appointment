import { useEffect, useState } from "react";
import type { ManagerRefreshHint } from "@rongguang/contracts";

import { createApiUrl } from "./api";
import { useBackofficeResource } from "./backoffice-resource";
import type { BackofficeResource } from "./backoffice-resource";

export type LiveConnectionState = "connecting" | "live" | "reconnecting" | "disabled";

export interface ManagerResource<T> extends BackofficeResource<T> {
  connection: LiveConnectionState;
  refresh: () => void;
}

function useManagerRefreshHints(
  enabled: boolean,
  refresh: () => void,
  scopeKey: string,
): LiveConnectionState {
  const [connection, setConnection] = useState<LiveConnectionState>(
    enabled ? "connecting" : "disabled",
  );

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setConnection(enabled ? "reconnecting" : "disabled");
      return;
    }

    let opened = false;
    const scopes = scopeKey.split(":");
    const source = new EventSource(createApiUrl("/backoffice/manager/events"), {
      withCredentials: true,
    });
    const handleRefresh = (event: Event) => {
      try {
        const hint = JSON.parse((event as MessageEvent<string>).data) as ManagerRefreshHint;
        if (
          scopes.includes(hint.scope) &&
          hint.reason !== "connected" &&
          hint.reason !== "heartbeat"
        ) {
          refresh();
        }
      } catch {
        // A malformed hint is ignored; the next reconnect or manual refresh restores current facts.
      }
    };

    source.onopen = () => {
      setConnection("live");
      if (opened) refresh();
      opened = true;
    };
    source.onerror = () => setConnection("reconnecting");
    source.addEventListener("refresh", handleRefresh);

    return () => {
      source.removeEventListener("refresh", handleRefresh);
      source.close();
    };
  }, [enabled, refresh, scopeKey]);

  return connection;
}

export function useManagerResource<T>(
  path: string,
  live = true,
  scopes: readonly ManagerRefreshHint["scope"][] = ["manager-live-bookings"],
): ManagerResource<T> {
  const resource = useBackofficeResource<T>(path);
  const connection = useManagerRefreshHints(live, resource.refresh, scopes.join(":"));

  return { ...resource, connection };
}
