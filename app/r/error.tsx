"use client";

import { Button } from "@/src/components/ui/button";
import { DangerPanel, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";

/**
 * Recovery screen for an unexpected server or render failure inside the app shell.
 *
 * Without this, any action that throws rather than returning a typed failure — a database
 * outage, a constraint violation — replaced the whole page with the framework's bare error
 * screen and offered the user no way back.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <PageTitle className="mb-2">Something went wrong</PageTitle>
      <Subtext className="mb-6 max-w-[60ch]">
        The page could not be loaded. Nothing you had already saved is affected.
      </Subtext>
      <DangerPanel>
        <p className="mb-4">
          Try again, and if it keeps failing, contact support at {UI.supportEmail}. Say what time
          it happened.
        </p>
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </DangerPanel>
    </div>
  );
}
