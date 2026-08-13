export const DEFAULT_DEMO_NOW = "2026-08-13T02:50:00.000Z";

function parseHttpUrl(value, name) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 必须是有效 URL，当前值为“${value}”。`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} 只支持 http 或 https，当前值为“${value}”。`);
  }

  return url;
}

export function resolveDemoEnvironment(environment) {
  const apiPort = environment.API_PORT ?? "3000";
  const demoNow = environment.DEMO_NOW ?? DEFAULT_DEMO_NOW;
  const adminOrigin = environment.ADMIN_ORIGIN ?? "http://localhost:5173";
  const apiBaseUrl = environment.VITE_API_BASE_URL ?? `http://localhost:${apiPort}`;
  const adminUrl = parseHttpUrl(adminOrigin, "ADMIN_ORIGIN");
  const apiUrl = parseHttpUrl(apiBaseUrl, "VITE_API_BASE_URL");

  environment.DEMO_NOW = demoNow;
  environment.VITE_DEMO_NOW = environment.VITE_DEMO_NOW ?? demoNow;
  environment.VITE_API_BASE_URL = apiBaseUrl;

  return {
    adminWorkbenchUrl: new URL("/manager/workbench", adminUrl).href,
    apiHealthUrl: new URL("/health", apiUrl).href,
  };
}
