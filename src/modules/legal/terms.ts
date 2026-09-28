import { APP_NAME } from "@/src/domain/strings";

import { LEGAL_PROVIDER, LEGAL_UPDATED, type LegalDocument } from "./legal-page";

/**
 * The Terms of Service. The billing rules here are the app's own, not boilerplate: upgrades
 * charged now and only on payment, downgrades at period end (D-122); no free use and one active
 * funding source on Reconciliation (D-124); buying during complimentary access ends it (D-128);
 * cancel keeps access to the period end with no refund. Change the code and this together.
 */
export const TERMS_OF_SERVICE: LegalDocument = {
  title: "Terms of Service",
  updated: LEGAL_UPDATED,
  intro: [
    `These Terms of Service ("Terms") are an agreement between ${LEGAL_PROVIDER} ("we", "us", "our") and the organization that uses ${APP_NAME} ("you", "your organization"). They cover the ${APP_NAME} website and application and everything you do with them.`,
    `By creating an account or using ${APP_NAME}, you agree to these Terms on behalf of your organization, and you confirm you have the authority to do so. If you do not agree, do not use ${APP_NAME}. Our {privacy} explains how we handle information.`,
  ],
  sections: [
    {
      id: "the-service",
      title: "The service",
      blocks: [
        `${APP_NAME} helps organizations track expenses against their funding sources, keep supporting documents with each expense, and prepare reconciliation documents such as cover sheets, monthly summaries and packets.`,
        "We keep improving the service, so features may be added, changed or removed over time. If we remove a feature your plan depends on, we will tell your organization's admins in advance.",
      ],
    },
    {
      id: "accounts",
      title: "Accounts and users",
      blocks: [
        {
          list: [
            "You must be at least 18 and give accurate information when you create an account.",
            "Each person uses their own account. Keep your password private and tell us straight away at {email} if you think someone else has used your account.",
            "Your organization's admins manage its users, plan and billing. Managers can do everything else except manage users and billing.",
            "Your organization is responsible for everything done through its accounts.",
          ],
        },
      ],
    },
    {
      id: "plans-and-billing",
      title: "Plans, billing and payment",
      blocks: [
        "Plans. We offer two plans. Reconciliation includes one active funding source at a time. Reconciliation + AI includes unlimited funding sources and the AI features. The current prices are shown on our pricing page, in US dollars, billed monthly or yearly.",
        "Payment. You pay by card through Stripe, our payment provider. Your plan renews automatically at the end of each billing period until you cancel it, and you authorize us to charge your card for each renewal. Prices do not include taxes, which your organization is responsible for where they apply.",
        {
          list: [
            "Upgrading, to a higher plan or from monthly to yearly billing, takes effect right away. You are charged the difference for the rest of the current period on the same day, and the change only happens once that payment goes through.",
            "Downgrading, to a lower plan or from yearly to monthly billing, takes effect at the end of the period you have already paid for. Nothing is charged until then, and you can cancel the change before it starts.",
            "Switching to Reconciliation is only possible while your organization has one active funding source. Archiving a funding source keeps its records, but on Reconciliation it can only be made active again by switching to Reconciliation + AI.",
          ],
        },
        "Cancelling. Your organization's admin can cancel at any time in Settings, under Plan & billing. You keep full access until the end of the period you have paid for, and the plan does not renew. Payments are not refunded, including for the unused part of a period, except where the law requires it.",
        "Failed payments. If a renewal payment fails, you keep access while Stripe tries the card again, and your admin can update the card at any time. If the payment still cannot be collected, the plan ends. Your admin can also end the plan straight away, which cancels the unpaid bill.",
        "Price changes. We may change our prices. A new price never applies to a period you have already paid for, and we will tell your organization's admins before it applies to your renewal.",
        "Without an active plan. An organization without an active plan can reach only the plan page until it chooses a plan: the rest of the app, downloads and shared links stop working. Nothing is deleted, and everything comes back when a plan starts.",
      ],
    },
    {
      id: "complimentary-access",
      title: "Complimentary access",
      blocks: [
        "We may give an organization free access to a plan, for a period we choose. We may change or end complimentary access, and when it ends, your organization needs to choose a plan to keep working.",
        "Your organization can buy a plan at any time during complimentary access. It pays from that day, and the complimentary access ends as soon as that payment goes through, however much of it was left.",
      ],
    },
    {
      id: "your-data",
      title: "Your data",
      blocks: [
        "Your organization owns the records and files it adds to the service and the documents built from them. We claim no ownership of them.",
        `You give ${LEGAL_PROVIDER} permission to store, process, copy and display your data only as needed to provide, secure and support the service for you, as described in our {privacy}.`,
        "You are responsible for your data: that it is accurate, that you have the right to upload it, including any personal information about other people in it, and that uploading it does not break any law or agreement.",
      ],
    },
    {
      id: "submissions",
      title: "Your submissions to funders",
      blocks: [
        `${APP_NAME} helps you prepare documents, but your organization is responsible for reviewing every figure, document and narrative before submitting it to a funder or anyone else, and for what it submits.`,
        `${LEGAL_PROVIDER} is not an accounting, audit or legal firm, and nothing in the service is accounting, tax or legal advice. We do not guarantee that a funder will accept a submission, reimburse an expense or find a submission complete.`,
      ],
    },
    {
      id: "ai-features",
      title: "AI features",
      blocks: [
        "AI features can suggest amounts from receipts and invoices and draft monthly summaries. Their output can be incomplete or wrong. Review it before you save or submit it, and do not rely on it as your only check.",
        "When you use an AI feature, the document or records involved are sent to our AI provider to produce the result, as described in our {privacy}.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        "Your organization and its users must not:",
        {
          list: [
            "use the service for anything illegal, fraudulent or misleading, including falsifying records or documents;",
            "upload malware or anything you do not have the right to upload;",
            "try to access another organization's data, or test, probe or get around the service's security;",
            "copy, resell, reverse engineer or build a competing product from the service;",
            "put an unreasonable load on the service, or use automated means to access it other than as we allow; or",
            "share access in a way that lets people outside your organization use the service as if they were users.",
          ],
        },
      ],
    },
    {
      id: "shared-links",
      title: "Shared links",
      blocks: [
        "You can share a document through a link, with an optional password. Anyone with the link, and the password if one is set, can open the document. Your organization decides who receives its links, is responsible for sharing them, and can stop sharing a link at any time.",
      ],
    },
    {
      id: "feedback",
      title: "Feature requests and feedback",
      blocks: [
        "You can send us feature requests and feedback. We may use them freely to improve the service, with no obligation to you. We may choose to show a request's title, details, status and votes to other organizations, but never who sent it or any replies.",
      ],
    },
    {
      id: "availability",
      title: "Availability and support",
      blocks: [
        "We work to keep the service available and reliable, but we do not guarantee it will be uninterrupted or error-free. We may need to pause it for maintenance, which we will try to schedule to cause as little disruption as possible.",
        "For support, email us at {email}.",
      ],
    },
    {
      id: "suspension",
      title: "Suspension and termination",
      blocks: [
        "Your organization can stop using the service at any time by cancelling its plan.",
        "We may suspend or end your organization's access if it breaks these Terms, if payment cannot be collected, or if its use puts the service, other customers or the public at risk. Where we reasonably can, we will tell you first and give you a chance to fix the problem.",
        "After access ends, we keep and delete your data as described in our {privacy}. You can ask us at any time to delete your organization's data.",
      ],
    },
    {
      id: "our-rights",
      title: "Our intellectual property",
      blocks: [
        `The service, its software, design and content, and the ${APP_NAME} name and logo belong to ${LEGAL_PROVIDER} and its licensors. While your organization has an active plan or complimentary access, we give it a limited, non-exclusive, non-transferable right to use the service for its own work under these Terms. No other rights are given.`,
      ],
    },
    {
      id: "confidentiality",
      title: "Confidentiality",
      blocks: [
        "We treat your organization's records as confidential. We use them only to provide the service and disclose them only as described in these Terms and our {privacy}.",
      ],
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      blocks: [
        `Except as these Terms say otherwise, the service is provided "as is" and "as available". To the fullest extent the law allows, ${LEGAL_PROVIDER} disclaims all warranties, whether express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement.`,
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      blocks: [
        `To the fullest extent the law allows, ${LEGAL_PROVIDER} is not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, funding, reimbursements or data, arising from or related to the service, even if we were told they were possible.`,
        `To the fullest extent the law allows, ${LEGAL_PROVIDER}'s total liability for all claims arising from or related to the service or these Terms is limited to the amount your organization paid us for the service in the 12 months before the event that gave rise to the claim.`,
      ],
    },
    {
      id: "indemnity",
      title: "Indemnity",
      blocks: [
        `Your organization will defend and indemnify ${LEGAL_PROVIDER} against claims, losses and costs, including reasonable legal fees, that arise from its data, its submissions, or its or its users' breach of these Terms or of the law.`,
      ],
    },
    {
      id: "governing-law",
      title: "Governing law and disputes",
      blocks: [
        "These Terms are governed by the laws of the State of Michigan, United States, without regard to its conflict of laws rules.",
        "If a dispute arises, please email us at {email} first, and we will try to resolve it informally. If we cannot, the state and federal courts located in Wayne County, Michigan have exclusive jurisdiction, and both parties agree to those courts.",
      ],
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      blocks: [
        "We may update these Terms. The date at the top shows when they last changed. If a change materially affects your organization, we will tell its admins by email or in the app at least 30 days before it takes effect. Continuing to use the service after that means your organization accepts the updated Terms.",
      ],
    },
    {
      id: "general",
      title: "General",
      blocks: [
        {
          list: [
            "These Terms and our {privacy} are the whole agreement between your organization and us about the service.",
            "If any part of these Terms cannot be enforced, the rest stays in effect.",
            "Not enforcing a part of these Terms is not a waiver of it.",
            "Your organization may not transfer these Terms without our written consent. We may transfer them as part of a merger, acquisition or sale of assets.",
            "Neither party is responsible for delays caused by events beyond its reasonable control.",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact us",
      blocks: [`For any question about these Terms, email ${LEGAL_PROVIDER} at {email}.`],
    },
  ],
};
