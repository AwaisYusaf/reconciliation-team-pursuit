import { APP_NAME } from "@/src/domain/strings";

import { LEGAL_PROVIDER, LEGAL_UPDATED, type LegalDocument } from "./legal-page";

/**
 * The Privacy Policy. Every statement here is checked against the code as it stands: argon2id
 * passwords (`src/services/auth/passwords.ts`), a 30-day sliding session cookie
 * (`src/services/auth/tokens.ts`), IP addresses held only in memory for rate limits
 * (`src/services/rate-limit.ts`), files in AWS us-east-1 (`S3_REGION`), OpenAI requests sent with
 * `store: false`, profile photos re-encoded without metadata (D-119), no analytics, no email
 * sending. Change the code and this together.
 */
export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  updated: LEGAL_UPDATED,
  intro: [
    `${APP_NAME} helps organizations track, document and reconcile the funding they receive. It is provided by ${LEGAL_PROVIDER} ("we", "us", "our"). This Privacy Policy explains what information we collect, how we use it, who we share it with, how long we keep it, and the choices and rights you have.`,
    `It applies to our website, the ${APP_NAME} application, and the shared document links our customers send. Using ${APP_NAME} is also governed by our {terms}. If you have a question about anything here, email us at {email}.`,
  ],
  sections: [
    {
      id: "who-we-are",
      title: "Who we are and our role",
      blocks: [
        `${LEGAL_PROVIDER} provides ${APP_NAME}. For the account information of the people who use ${APP_NAME}, and for how we run our website, we decide how information is used.`,
        `Our customers are organizations. The records an organization adds to ${APP_NAME} (expenses, receipts, invoices, bank statements, narratives and the documents built from them) belong to that organization, and we process them on its behalf and under its instructions. Those records can include information about other people, such as vendors, staff or program participants named on a receipt. If you are one of those people, the organization that holds the record is responsible for it, and you should contact them first. We will help them respond to you.`,
      ],
    },
    {
      id: "information-we-collect",
      title: "Information we collect",
      blocks: [
        "We collect only what we need to run the service:",
        {
          list: [
            "Account information: your name, email address, the role your organization gives you (admin or manager), and your password. We never store your password itself, only a one-way argon2id hash of it.",
            "Profile photo, if you add one. We re-encode it on upload, which removes hidden metadata such as the location where the photo was taken.",
            "Organization information: your organization's name, the name printed on its documents, its funding sources (contract values, contract and PO numbers, contract dates, fiduciary) and its budget line items.",
            "Records you add: expenses, amounts, vendors, payment details you type in, narratives, and the files you upload, such as receipts, invoices, proofs of payment and bank statements. A single file can be up to 25 MB, and an organization can store up to 5 GB.",
            "Documents we generate for you: cover sheets, monthly summaries, packets and workbooks built from your records.",
            "History: who created, changed or deleted a record and when, the time of each person's last sign-in, and changes to your organization's plan and account.",
            "Feature requests, votes and replies you send us through the app.",
            "Billing information: your plan, billing interval, subscription status, renewal dates and the Stripe customer and subscription identifiers. Card details are entered on Stripe's page and go straight to Stripe. We never receive or store your full card number.",
            "Technical information: your IP address, used for a short time to limit repeated sign-in, password and upload attempts. It is kept in memory only and is not saved to our database. Our servers may also keep error logs with technical details of a request for troubleshooting and security.",
          ],
        },
      ],
    },
    {
      id: "how-we-use-it",
      title: "How we use information",
      blocks: [
        {
          list: [
            "To provide the service: to store your records, keep your organization's data separate from every other organization's, and build the documents you ask for.",
            "To run the AI features, when your organization's plan includes them and you use them (see section 4).",
            "To bill for your plan and manage your subscription through Stripe.",
            "To keep the service and your account secure: to sign you in, limit repeated attempts, keep an audit trail, and prevent misuse.",
            "To support you when you contact us, and to answer feature requests.",
            "To understand how the service is used in aggregate, for example how much storage or how many AI requests an organization uses, so we can run and improve it.",
            "To meet legal obligations and enforce our {terms}.",
          ],
        },
        "We do not sell your personal information. We do not use it for advertising, and we do not use any third-party analytics or advertising trackers.",
      ],
    },
    {
      id: "ai-features",
      title: "AI features",
      blocks: [
        `Some plans include features that read a receipt or invoice and suggest amounts, or draft a monthly summary. These features only run when your organization's plan includes them, the feature is turned on, and someone in your organization uses it.`,
        "When you use one, the relevant document or records are sent to OpenAI, our AI provider, to produce the result. We send these requests with OpenAI's option to store them turned off. Under OpenAI's API terms, data sent through its API is not used to train its models by default.",
        "AI output can be wrong. Always review suggested amounts and drafted text before you save or submit them.",
      ],
    },
    {
      id: "sharing",
      title: "How we share information",
      blocks: [
        "We share information only as described here:",
        {
          list: [
            "Service providers who run parts of the service for us, under contracts that limit their use of your information: Amazon Web Services (hosting and file storage), Stripe (payments) and OpenAI (the AI features).",
            "People you choose to share with. When someone in your organization creates a shared link to a document, anyone with that link can open the document, and also needs the password if one was set. You can stop sharing a link at any time.",
            "Other organizations, only for feature requests our team chooses to show to everyone. They see a request's title, details, status and votes, never who sent it or any replies.",
            `Our team. Authorized ${LEGAL_PROVIDER} staff can see account-level information in our admin dashboard, such as your plan, billing status, users and usage totals, to run and support the service. We look at the contents of your records only when you ask us to for support, when needed to keep the service secure, or when the law requires it.`,
            "Legal and safety reasons: when required by law or legal process, or to protect the rights, safety and security of our customers, our users, the public or us.",
            "Business transfers: if we are involved in a merger, acquisition or sale of assets, information may be transferred as part of it, and this Privacy Policy will continue to apply to it.",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and similar technologies",
      blocks: [
        "We use only the cookies the service needs to work:",
        {
          list: [
            "A sign-in cookie that keeps you signed in. It cannot be read by scripts on the page, and it expires after 30 days, renewed while you keep using the service. Signing out removes it.",
            "A shared-link cookie, set only after you enter the correct password for a password-protected shared document, so you are not asked again for a short time.",
            "Your browser's session storage, for short-lived interface state such as walkthrough progress or a form in progress. It is cleared when you close the tab.",
          ],
        },
        "We do not use advertising or analytics cookies. Because every cookie we set is needed for the service to work, we do not ask for cookie consent.",
      ],
    },
    {
      id: "retention",
      title: "How long we keep information",
      blocks: [
        "We keep your organization's records for as long as it has an account with us.",
        "If your plan ends, nothing is deleted. Your records are kept, and you can get back to them by choosing a plan again.",
        "If your organization asks us to delete its account, we delete its records and files within 30 days of confirming the request, except where the law requires us to keep something longer. Copies in our backups are removed as those backups expire.",
        "When an admin removes a person from an organization, their account is closed, but their name stays on the history entries for changes they made, so the organization's audit trail stays complete.",
      ],
    },
    {
      id: "security",
      title: "How we protect information",
      blocks: [
        {
          list: [
            "All traffic to the service is encrypted in transit with HTTPS.",
            "Passwords are stored only as argon2id hashes.",
            "Each organization's data is kept separate, and every request is checked against the signed-in person's organization and role.",
            "Repeated sign-in, password and upload attempts are limited.",
            "Changes to expenses are recorded in an audit trail showing who made them and when.",
            "Uploaded images are re-encoded, and uploads are checked for type and size.",
          ],
        },
        "No method of storing or sending information is completely secure, so we cannot guarantee absolute security. If we learn of a security incident that affects your personal information, we will notify you as the law requires.",
      ],
    },
    {
      id: "your-rights",
      title: "Your choices and rights",
      blocks: [
        "Depending on where you live, you may have the right to:",
        {
          list: [
            "access the personal information we hold about you;",
            "correct it if it is wrong;",
            "delete it;",
            "get a copy of it in a usable format; and",
            "object to or limit how we use it.",
          ],
        },
        "You can update your name, photo and password yourself in Settings, and your organization's admin can update or remove the organization's records and users. You can download your organization's documents and workbooks from the app at any time.",
        "For anything else, email us at {email}. We will confirm who you are before acting, and respond within 30 days. If your information is in a record an organization added, we will pass your request to that organization.",
        "We do not sell personal information or share it for targeted advertising, as those terms are used in United States state privacy laws. We will not treat you differently for using any of these rights.",
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [
        `${APP_NAME} is a tool for organizations and is not meant for anyone under 18. We do not knowingly collect personal information from children. If you believe a child has given us personal information, email us at {email} and we will delete it.`,
      ],
    },
    {
      id: "where-we-store",
      title: "Where information is stored",
      blocks: [
        `We store and process information in the United States, using Amazon Web Services. If you use ${APP_NAME} from outside the United States, your information will be transferred to and processed in the United States.`,
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        "We may update this Privacy Policy as the service changes. The date at the top shows when it last changed. If we make a change that materially affects how we use your personal information, we will tell your organization's admins by email or in the app before it takes effect.",
      ],
    },
    {
      id: "contact",
      title: "Contact us",
      blocks: [
        `For any question or request about this Privacy Policy or your information, email ${LEGAL_PROVIDER} at {email}.`,
      ],
    },
  ],
};
