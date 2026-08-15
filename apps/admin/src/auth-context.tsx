import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiFetch, type BackofficeAccount, readApiError } from "./api";

type AuthState =
  | { kind: "checking" }
  | { kind: "anonymous"; reason?: "expired" }
  | { kind: "authenticated"; account: BackofficeAccount }
  | { kind: "error"; message: string };

interface AuthContextValue {
  state: AuthState;
  retry: () => void;
  setAccount: (account: BackofficeAccount) => void;
  markExpired: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    async function checkSession(): Promise<void> {
      try {
        const response = await apiFetch("/auth/session", { signal: abortController.signal });

        if (response.ok) {
          const body = (await response.json()) as { account: BackofficeAccount };
          setState({ kind: "authenticated", account: body.account });
          return;
        }

        const error = await readApiError(response);

        if (error.status === 401) {
          setState({
            kind: "anonymous",
            ...(error.code === "SESSION_EXPIRED" ? { reason: "expired" as const } : {}),
          });
          return;
        }

        setState({ kind: "error", message: error.message });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "无法连接茸光后台 API。",
          });
        }
      }
    }

    void checkSession();
    return () => abortController.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: "checking" });
    setAttempt((current) => current + 1);
  }, []);
  const setAccount = useCallback((account: BackofficeAccount) => {
    setState({ kind: "authenticated", account });
  }, []);
  const markExpired = useCallback(() => {
    setState({ kind: "anonymous", reason: "expired" });
  }, []);
  const signOut = useCallback(async () => {
    const response = await apiFetch("/auth/logout", { method: "POST" });

    if (!response.ok && response.status !== 401) {
      throw await readApiError(response);
    }

    setState({ kind: "anonymous" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, retry, setAccount, markExpired, signOut }),
    [markExpired, retry, setAccount, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }

  return context;
}
