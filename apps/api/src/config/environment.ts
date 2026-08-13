const DEFAULT_DATABASE_URL = "postgresql://rongguang:rongguang_local@127.0.0.1:5432/rongguang";

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function getApiHost(): string {
  return process.env.API_HOST ?? "0.0.0.0";
}

export function getApiPort(): number {
  const value = Number(process.env.API_PORT ?? "3000");

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`API_PORT 必须是 1 到 65535 之间的整数，当前值为“${process.env.API_PORT}”。`);
  }

  return value;
}

export function getAdminOrigin(): string {
  return process.env.ADMIN_ORIGIN ?? "http://localhost:5173";
}

export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);

    if (url.password) {
      url.password = "***";
    }

    return url.toString();
  } catch {
    return "<无效的 DATABASE_URL>";
  }
}
