import type { TourStep } from "@/src/components/ui/tour";

/**
 * Settings tab tour (Phase 7, D-95 follow-up). Settings has six sections, switched by local
 * client state rather than routing (`settings-sections.tsx`'s `active`), so a tour that only
 * ever described the default Organization tab covered one section out of six. Every section
 * past Organization now gets its own step, and `autoOpen` — clicking that section's own
 * sidebar button (`data-tour="settings-tab-<id>"`) — switches to it before the step's `target`
 * is resolved, the same way it opens Line Items' Manage modal and an Expenses row's ⋮ menu.
 * The Users step's target/autoOpen simply aren't in the DOM for a manager (the sidebar item
 * itself is admin-only), so it's dropped like any other "not relevant right now" step.
 */
export const SETTINGS_TOUR_STEPS: readonly TourStep[] = [
  {
    target: "settings-sidebar",
    title: "Settings sections",
    body: "Six sections, switched instantly without changing the page — refreshing or sharing a link won't keep the same one open.",
  },
  {
    target: "settings-doc-name",
    title: "Document display name",
    body: "This name, not the organization name above it, is what prints on cover sheets and the packet — unless a funding source overrides it.",
  },
  {
    target: "settings-funding-sources-list",
    autoOpen: "settings-tab-fundingSources",
    title: "Funding sources",
    body: "Every funder your organisation tracks money for, each with its own budget, expenses and packet. Archive one instead of deleting it — its history stays intact and viewable.",
  },
  {
    target: "settings-labels",
    autoOpen: "settings-tab-labels",
    title: "Payment sources & document types",
    body: "These labels appear throughout the app — on the expense form, filters, and printed documents. Retire one instead of deleting it once it's ever been used, so past expenses keep the label they were entered with.",
  },
  {
    target: "settings-vendors",
    autoOpen: "settings-tab-vendors",
    title: "Vendor library",
    body: "Every vendor you've billed before, remembered here. Typing a name on the expense form pulls its usual line item and payment source from this list automatically.",
  },
  {
    target: "settings-users",
    autoOpen: "settings-tab-users",
    title: "Users",
    body: "Everyone with access to this organisation's data. Only an admin can add, remove, or change another user's role.",
  },
  {
    target: "settings-app-guide",
    autoOpen: "settings-tab-account",
    title: "Show the app guide again",
    body: "Bring back every walkthrough at once from here — or use the (i) button next to Log out to replay just the one for the screen you're on.",
  },
];
