export interface StoredSession {
  visitorId: string;
  token: string;
  /** Set once the visitor has dismissed the "get notified by email" prompt. */
  emailPromptDismissed?: boolean;
  /** The host site's signed-in user (`user.email` prop) this session was created under, if any. */
  userEmail?: string;
}

// Storage can be unavailable (private mode, blocked site data), so every access is guarded.
function key(apiUrl: string): string {
  return `hailbox:v1:${apiUrl}`;
}

export function loadSession(apiUrl: string): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(key(apiUrl));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.visitorId !== 'string' || typeof parsed.token !== 'string') return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(apiUrl: string, session: StoredSession): void {
  try {
    window.localStorage.setItem(key(apiUrl), JSON.stringify(session));
  } catch {
    // The session then only lasts for this page view.
  }
}

export function clearSession(apiUrl: string): void {
  try {
    window.localStorage.removeItem(key(apiUrl));
  } catch {
    // Nothing to clear.
  }
}
