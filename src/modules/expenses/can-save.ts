/**
 * Whether the expense form may save now (PR #18 round 2, #6; round 3, #2). Not while a save is
 * already running, and not while a picked HEIC is still becoming a JPEG in the browser: the save
 * would upload the file that is about to be replaced, and the photo was lost.
 */
export function canSave(queued: readonly { converting?: boolean }[], pending: boolean): boolean {
  return !pending && !queued.some((item) => item.converting);
}
