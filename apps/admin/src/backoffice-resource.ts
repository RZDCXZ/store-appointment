import { useCallback, useEffect, useState } from "react";

import { apiFetch, readApiError } from "./api";
import { useAuth } from "./auth-context";

interface BackofficeResourceState<T> {
  data: T | null;
  error: string | null;
  forbidden: boolean;
  loading: boolean;
  refreshing: boolean;
}

export interface BackofficeResource<T> extends BackofficeResourceState<T> {
  refresh: () => void;
}

export function useBackofficeResource<T>(
  path: string,
  fallbackErrorMessage = "页面事实读取失败，请稍后重试。",
): BackofficeResource<T> {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BackofficeResourceState<T>>({
    data: null,
    error: null,
    forbidden: false,
    loading: true,
    refreshing: false,
  });
  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

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
            error: error instanceof Error ? error.message : fallbackErrorMessage,
            loading: false,
            refreshing: false,
          }));
        }
      }
    }

    void load();
    return () => abortController.abort();
  }, [attempt, fallbackErrorMessage, markExpired, path]);

  return { ...state, refresh };
}
