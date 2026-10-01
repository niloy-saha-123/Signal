import { normalizeDomain } from "./domain";

// The competitor someone typed on the landing page has to survive sign-up,
// which can involve an email confirmation in another tab — so it lives in
// localStorage, not the URL or sessionStorage. Values are re-normalized on the
// way in and out; storage can be absent or throw (private mode), which is fine.
const KEY = "signal:first-competitor";

export function rememberPendingCompetitor(input: string | null | undefined) {
  const domain = input ? normalizeDomain(input) : null;
  if (!domain) return;
  try {
    window.localStorage.setItem(KEY, domain);
  } catch {
    /* storage unavailable */
  }
}

export function readPendingCompetitor(): string | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value ? normalizeDomain(value) : null;
  } catch {
    return null;
  }
}

export function clearPendingCompetitor() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
