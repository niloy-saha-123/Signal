// Defaults apply only to absent settings. Explicit invalid configuration fails at
// the first consumer boundary rather than silently relaxing enforcement or spend caps.
export function parseNumericSetting(
  name: string,
  raw: string | number | undefined,
  options: { defaultValue: number; min: number; max?: number; integer?: boolean }
): number {
  const value = raw === undefined ? options.defaultValue : Number(raw);
  if (
    (typeof raw === "string" && raw.trim() === "") ||
    !Number.isFinite(value) ||
    value < options.min ||
    (options.max !== undefined && value > options.max) ||
    (options.integer && !Number.isInteger(value))
  ) {
    // Never include the environment value: misconfigured variables may contain secrets.
    throw new Error(`Invalid numeric configuration: ${name}`);
  }
  return value;
}
