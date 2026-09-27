import type { TourStep } from "@/src/components/ui/tour";
import { UI } from "@/src/domain/strings";

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
  // Both Organization-section steps carry an `autoOpen` of their own, even though that is the
  // section Settings already opens on: without it, stepping Back here from a later step left
  // the page on whichever section that step had switched to, so `settings-doc-name` was no
  // longer in the DOM and the step was dropped instead of shown (review fix).
  {
    target: "settings-sidebar",
    autoOpen: "settings-tab-organization",
    title: "Settings sections",
    body: "Switch between sections here. Refreshing the page starts again on the section Settings opened on.",
  },
  {
    target: "settings-doc-name",
    autoOpen: "settings-tab-organization",
    title: "Document display name",
    body: "Cover sheets and the packet print this name, not the organization name above it. A funding source can set its own instead.",
  },
  // Plus only (Phase 10): the switch isn't rendered on the base plan, so this step is dropped
  // there like any other absent target.
  {
    target: "settings-read-amounts",
    autoOpen: "settings-tab-organization",
    title: UI.tourReadAmountsSwitchTitle,
    body: UI.tourReadAmountsSwitchBody,
  },
  {
    target: "settings-funding-sources-list",
    autoOpen: "settings-tab-fundingSources",
    title: "Funding sources",
    body: "Every funder your organization tracks money for, each with its own budget, expenses and packet. Archive one you no longer use. Its history stays intact and can still be viewed.",
  },
  {
    target: "settings-labels",
    autoOpen: "settings-tab-labels",
    title: "Payment sources and document types",
    body: "These labels appear on the expense form, in filters and on printed documents. Deactivate one you no longer use. Past expenses keep the label they were entered with.",
  },
  {
    target: "settings-vendors",
    autoOpen: "settings-tab-vendors",
    title: "Vendor library",
    body: "Every vendor you've used before is remembered here. Type a vendor's name on the expense form and its usual line item and payment source fill in automatically.",
  },
  {
    target: "settings-users",
    autoOpen: "settings-tab-users",
    title: "Users",
    body: "Everyone with access to this organization's data. Only an admin can add users, edit their names or reset their passwords.",
  },
  {
    target: "settings-plan",
    autoOpen: "settings-tab-plan",
    title: "Plan & billing",
    body: "Your plan, what it costs and when it renews. Only an admin can switch plans, cancel, or update the card. The Plus pill at the top opens this section too.",
  },
  {
    target: "settings-app-guide",
    autoOpen: "settings-tab-account",
    title: "Show the app guide again",
    body: "Bring back every walkthrough from here. To replay just the one for the screen you're on, use the (i) button at the top of the screen, beside your profile picture.",
  },
];
