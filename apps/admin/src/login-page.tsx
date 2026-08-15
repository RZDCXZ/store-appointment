import { useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { backofficeRoles } from "@rongguang/contracts";

import { apiFetch, type BackofficeAccount, readApiError } from "./api";
import { useAuth } from "./auth-context";

const demoAccounts = [
  { username: "manager", label: "店长 · 沈青", detail: "完整管理与经营权限" },
  { username: "linxia", label: "员工 · 林夏", detail: "今日工作与本人预约" },
  { username: "chenjia", label: "员工 · 陈嘉", detail: "今日工作与本人预约" },
  { username: "zhouning", label: "员工 · 周宁", detail: "今日工作与本人预约" },
  { username: "zhaohang", label: "员工 · 赵航", detail: "今日工作与本人预约" },
] as const;

function landingPath(account: BackofficeAccount): string {
  return backofficeRoles[account.role].landingPath;
}

function safeTarget(value: string | null, account: BackofficeAccount): string {
  if (value?.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return landingPath(account);
}

export function LoginPage(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const selectedAccount = demoAccounts.find((account) => account.username === username);
  const checkingSession = auth.state.kind === "checking";
  const expired =
    searchParams.get("reason") === "expired" ||
    (auth.state.kind === "anonymous" && auth.state.reason === "expired");

  if (auth.state.kind === "authenticated") {
    return <Navigate to={safeTarget(searchParams.get("returnTo"), auth.state.account)} replace />;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPasswordError("");
    setRequestError("");

    if (!password) {
      setPasswordError("请输入演示密码。");
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);

    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await readApiError(response);

        if (error.code === "INVALID_CREDENTIALS" || error.code === "VALIDATION_ERROR") {
          setPasswordError(error.message);
          passwordRef.current?.focus();
        } else {
          setRequestError(error.message);
        }
        return;
      }

      const body = (await response.json()) as { account: BackofficeAccount };
      auth.setAccount(body.account);
      navigate(safeTarget(searchParams.get("returnTo"), body.account), { replace: true });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "登录请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-brand" aria-label="茸光品牌介绍">
        <div className="login-wordmark">
          <span>茸光</span>
          <small>宠物洗护 · 管理端</small>
        </div>
        <div className="login-copy">
          <span className="demo-pill">本地演示系统</span>
          <h2>把下一位宠物，照顾得从容一些。</h2>
          <p>员工与店长共用的预约、履约和排班工作台。</p>
        </div>
        <img src="/assets/brand/rongguang-hero-shiba.png" alt="晨光中的柴犬" />
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="compact-logo" aria-hidden="true">
            茸光 <span>后台</span>
          </div>
          <p className="eyebrow">ST-01 · 演示账号登录</p>
          <h1>欢迎回来</h1>
          <p className="login-intro">请选择店长或员工账号。身份和数据范围由服务端会话决定。</p>

          {expired ? (
            <div className="auth-notice auth-notice--warning" role="status">
              <strong>登录已过期，请重新登录后继续。</strong>
              <span>登录成功后会返回刚才的页面。</span>
            </div>
          ) : null}

          {auth.state.kind === "error" ? (
            <div className="auth-notice auth-notice--error" role="alert">
              <span>暂时无法确认已有会话：{auth.state.message}</span>
              <button type="button" onClick={auth.retry}>
                重新检查
              </button>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="demo-account">演示账号</label>
            <select
              id="demo-account"
              name="username"
              value={username}
              disabled={checkingSession}
              onChange={(event) => setUsername(event.target.value)}
            >
              {demoAccounts.map((account) => (
                <option key={account.username} value={account.username}>
                  {account.label} · {account.username}
                </option>
              ))}
            </select>
            <small>{selectedAccount?.detail}</small>
          </div>

          <div className="field">
            <label htmlFor="demo-password">演示密码</label>
            <input
              id="demo-password"
              ref={passwordRef}
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              disabled={checkingSession}
              aria-invalid={passwordError ? "true" : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {passwordError ? (
              <small id="password-error" className="field-error" role="alert">
                {passwordError}
              </small>
            ) : (
              <small>统一演示密码：Rongguang2026!</small>
            )}
          </div>

          {requestError ? (
            <div className="auth-notice auth-notice--error" role="alert">
              {requestError}
            </div>
          ) : null}

          <button
            className="primary-button login-submit"
            type="submit"
            disabled={checkingSession || submitting}
          >
            {checkingSession ? "正在检查会话…" : submitting ? "正在登录…" : "进入管理端"}
          </button>

          <p className="login-note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />
              <path d="m9 12 2 2 4-5" />
            </svg>
            演示账号不会绕过界面权限；会话保存在 HttpOnly Cookie 中。
          </p>
        </form>
      </section>
    </main>
  );
}
