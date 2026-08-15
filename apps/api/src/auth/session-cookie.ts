export const backofficeSessionCookieName = "rongguang_backoffice_session";

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0 || part.slice(0, separator).trim() !== backofficeSessionCookieName) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

export function createSessionCookie(token: string): string {
  return `${backofficeSessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${backofficeSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
