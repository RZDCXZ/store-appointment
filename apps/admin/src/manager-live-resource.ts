import { useCallback, useEffect, useState } from "react";
import type { ManagerRefreshHint } from "@rongguang/contracts";

import { apiFetch, createApiUrl, readApiError } from "./api";
import { useAuth } from "./auth-context";

export type LiveConnectionState = "connecting" | "live" | "reconnecting" | "disabled";

interface ManagerResourceState<T> {
  data: T | null;
  error: string | null;
  forbidden: boolean;
  loading: boolean;
  refreshing: boolean;
}

export interface ManagerResource<T> extends ManagerResourceState<T> {
  connection: LiveConnectionState;
  refresh: () => void;
}

function useManagerRefreshHints(enabled: boolean, refresh: () => void): LiveConnectionState {
  const [connection, setConnection] = useState<LiveConnectionState>(
    enabled ? "connecting" : "disabled",
  );

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setConnection(enabled ? "reconnecting" : "disabled");
      return;
    }

    let opened = false;
    const source = new EventSource(createApiUrl("/backoffice/manager/events"), {
      withCredentials: true,
    });
    const handleRefresh = (event: Event) => {
      try {
        const hint = JSON.parse((event as MessageEvent<string>).data) as ManagerRefreshHint;
        if (hint.scope === "manager-live-bookings" && hint.reason === "booking-changed") {
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
  }, [enabled, refresh]);

  return connection;
}

export function useManagerResource<T>(path: string, live = true): ManagerResource<T> {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ManagerResourceState<T>>({
    data: null,
    error: null,
    forbidden: false,
    loading: true,
    refreshing: false,
  });
  const refresh = useCallback(() => setAttempt((current) => current + 1), []);
  const connection = useManagerRefreshHints(live, refresh);

  useEffect(() => {
    const abortController = new AbortController();

    setState((current) => ({
      ...current,
      error: null,
      forbidden: false,
      loading: current.data === null,
      refreshing: current.data !== null,
    }));

    async function load(): Promise<void> {
      try {
        const response = await apiFetch(path, { signal: abortController.signal });
        if (!response.ok) {
          const error = await readApiError(response);
          if (error.status === 401) {
            markExpired();
            return;
          }
          setState((current) => ({
            ...current,
            error: error.message,
            forbidden: error.status === 403,
            loading: false,
            refreshing: false,
          }));
          return;
        }

        setState({
          data: (await response.json()) as T,
          error: null,
          forbidden: false,
          loading: false,
          refreshing: false,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "页面事实读取失败，请稍后重试。",
            loading: false,
            refreshing: false,
          }));
        }
      }
    }

    void load();
    return () => abortController.abort();
  }, [attempt, markExpired, path]);

  return { ...state, connection, refresh };
}
