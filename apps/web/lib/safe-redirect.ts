const DEFAULT_AUTH_DESTINATION = "/briefing";

export function getSafeNextPath(
  candidate: string | null,
  fallback = DEFAULT_AUTH_DESTINATION,
): string {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://signal.local");
    const destination = new URL(candidate, base);
    return destination.origin === base.origin ? candidate : fallback;
  } catch {
    return fallback;
  }
}
