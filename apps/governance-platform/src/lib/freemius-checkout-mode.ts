export type FreemiusCheckoutMode = "live" | "sandbox";
export type FreemiusEntityEnvironment = "live" | "sandbox";

export function getFreemiusCheckoutMode(
  raw = process.env.FREEMIUS_CHECKOUT_MODE,
): FreemiusCheckoutMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return "live";
  if (normalized === "live" || normalized === "sandbox") return normalized;
  throw new Error("FREEMIUS_CHECKOUT_MODE must be either live or sandbox");
}

export function readFreemiusEntityEnvironment(
  entity: { environment?: unknown } | null | undefined,
): FreemiusEntityEnvironment | null {
  const value = entity?.environment;
  if (value === 0 || value === "0") return "live";
  if (value === 1 || value === "1") return "sandbox";
  return null;
}

export function verifyFreemiusEntityEnvironment(
  entity: { environment?: unknown } | null | undefined,
  mode = getFreemiusCheckoutMode(),
):
  | { ok: true; environment: FreemiusEntityEnvironment; mode: FreemiusCheckoutMode }
  | { ok: false; error: string; environment: FreemiusEntityEnvironment | null; mode: FreemiusCheckoutMode } {
  const environment = readFreemiusEntityEnvironment(entity);
  if (!environment) {
    return {
      ok: false,
      error: "Freemius payment environment was not verified.",
      environment,
      mode,
    };
  }
  if (environment !== mode) {
    return {
      ok: false,
      error: `Freemius ${environment} license cannot grant credits while Arena checkout mode is ${mode}.`,
      environment,
      mode,
    };
  }
  return { ok: true, environment, mode };
}
