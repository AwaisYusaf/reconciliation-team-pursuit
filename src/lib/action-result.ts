/**
 * The single contract every Server Action returns.
 *
 * Forms drive `useActionState` with this shape, so error rendering is identical across
 * the app: a panel for `error`, inline messages for `fieldErrors`. Actions never throw
 * for expected failures (bad password, validation) — they return `ok: false`, which
 * keeps the client's typed form state intact instead of triggering an error boundary.
 */
export type FieldErrors = Record<string, string>;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail<T = undefined>(error: string, fieldErrors?: FieldErrors): ActionResult<T> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Idle state for `useActionState` initial values. */
export const IDLE: ActionResult<undefined> = { ok: true, data: undefined };

/**
 * Signalled to the client when the session expired mid-form. The client keeps the
 * user's typed state and shows a sign-in prompt rather than discarding their work
 * (review finding A13).
 */
export const SESSION_EXPIRED = "You've been signed out. Sign in and try again.";
