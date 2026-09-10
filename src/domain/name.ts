import { z } from "zod";

/**
 * One rule for "a person's display name" (D-89), shared between an admin creating a user
 * (`src/modules/users/actions.ts`) and signing up (`src/modules/auth/actions.ts`).
 *
 * Lives outside both — a "use server" file may only export async functions, so a plain
 * schema object can't be exported from either action module directly.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(120, "That name is too long.");
