import "server-only";

/**
 * Signup gating (D-15). Public registration stays closed by default; the client's
 * organisation is created while it is open, then the flag is turned off.
 *
 * Deliberately not a Server Action — it is configuration read during rendering, and
 * exporting it from a `"use server"` module would publish it as a callable endpoint.
 */
export function signupEnabled(): boolean {
  return process.env.SIGNUP_ENABLED === "true";
}
