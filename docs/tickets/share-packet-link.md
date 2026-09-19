# Share the month's packet and summary with a link

**Priority:** _(set in Notion)_

---

## Background

At month end the team downloads the packet PDF and the Excel summary and sends them to the City. The packet is often too big to email (one real month was 73 MB), so they upload files to Google Drive and send the Drive link.

The packet has clickable navigation: clicking an expense reference on a cover letter jumps to its receipt, and the receipt's footer jumps back. **Google Drive's viewer ignores these links.** The City reviewer has to download the file and open it in Chrome or Acrobat before navigation works.

## Goal

The team shares the month's files straight from the app with a link, for either file:

- **Packet (PDF):** the link opens the PDF in the browser's own PDF viewer, where all the navigation works.
- **Summary (Excel):** the link downloads the Excel file.

Each link can have a password and can be turned off at any time.

Each funding source and month can have **one PDF link and one Excel link**. A link keeps working until someone turns it off. It always gives the file as it was when it was last shared or updated. That file is saved, so opening the link never builds it again.

---

## 1. The Share link button (Month-End Packet tab)

"Download Packet (PDF)" and "Download Summary (Excel)" stay as they are. Add a third button next to them: **Share link**.

Share link follows the same rules as the downloads:

- While the red "missing documentation" message is showing, the button is disabled.
- If expenses were deleted from the month, the "Deleted from this month" dialog appears first. After the user presses "Continue to download", the share dialog opens.

Admins and managers can both share, on every plan. Sharing works on locked months and archived funding sources too, because it doesn't change any records.

## 2. Sharing a file

Pressing **Share link** opens a dialog:

- **Title:** "Share March 2026 files"
- **Which file:** two choices
  - **Packet (PDF)**: "Opens in the browser. Clickable references work in Chrome, Edge and Safari."
  - **Summary (Excel)**: "Downloads the Excel file."

  If a file already has a link, its choice says "Already shared". Picking it shows that file's link row instead (section 3).
- **Password:** a checkbox "Require a password", which shows a password field (at least 6 characters) when ticked.
- Buttons: **Create link** and **Cancel**.

Pressing **Create link** saves the chosen file as it is right now and makes its link. For a big month the packet can take a minute or two, like a download does, so show "Preparing the packet…" on the button while it works.

When it's ready, the dialog shows:

- The link, e.g. `https://stayfunded360.com/s/k7Qm2xPa9` (short and hard to guess)
- A **Copy link** button ("Link copied" toast)
- If a password was set: "Password protected. Send the password separately, for example by text."

Example: Misty shares the March packet with a password. Then she opens Share link again and shares the March summary without one. She now has two separate links.

## 3. Once a file has a link

The Month-End Packet tab shows a **"Shared links"** box below the buttons, with one row per shared file:

> **Packet (PDF)** · Password protected
> Shared on 04/08/2026 by Misty
> `https://stayfunded360.com/s/k7Qm2xPa9` **Copy link**
> **Change password** · **Stop sharing**
>
> **Summary (Excel)** · No password
> Shared on 04/08/2026 by Misty
> `https://stayfunded360.com/s/Rt4nW8cLe` **Copy link**
> **Change password** · **Stop sharing**

Each row only affects its own link:

- **Change password:** set a new password, add one, or remove it. The old password stops working straight away. The current password is never shown again after it's saved. A user who forgot it sets a new one.
- **Stop sharing:** asks "Stop sharing the March 2026 packet? Anyone who has the link won't be able to open it." (or "summary"), with **Stop sharing** and **Cancel**. After that, the row goes away. Sharing that file again gives a **new** link, and the old link never comes back.

## 4. When records change after sharing

A link keeps giving the file as it was when shared. If the month's expenses or documents change afterwards, that file's row says:

> "Your records changed since you shared this file on 04/08/2026. The link still gives the older file."
> **Update shared file**

**Update shared file** saves the file as it is now behind the **same link**, so the City doesn't need a new email. The "Shared on" line then shows the new date. The same rules as a download apply: the missing documentation and deleted expenses checks from section 1. The PDF and Excel rows are updated separately.

Example: Misty shares March on April 8. On April 10 she fixes the amount on a Staples invoice. Both rows show the "records changed" message. She presses **Update shared file** on each, and the City's existing links give the corrected files.

## 5. Opening a link (anyone, no account needed)

**No password:**

- **PDF link:** the packet opens directly in the browser's PDF viewer, full screen. The browser tab shows the file name, e.g. `Team_Pursuit_March_2026_Packet.pdf`. Clicking a reference jumps to the receipt, like it does in a downloaded file. The viewer's own download and print buttons work.
- **Excel link:** the Excel file downloads with the same name as the file from "Download Summary (Excel)".

**With a password:** first a simple page with the Stay Funded 360 logo:

- "This file is password protected."
- Password field and **Open file** button
- Wrong password: "That password isn't right."
- After 5 wrong tries: "Too many tries. Please wait 15 minutes and try again."

After the right password, the PDF opens or the Excel file downloads as above. The visitor shouldn't have to enter the password again for a while if they reload.

**Link no longer works** (turned off, or the organization's access is paused or cancelled from the admin dashboard): a simple page that says "This link is no longer available. Please ask the sender for a new one." It doesn't say which of these happened. If paused access is restored, the link works again.

Shared links and the password page must not appear in search engines.

---

## Good to know

- Browsers can't show Excel files, so the Excel link always downloads.
- Chrome on Android phones downloads PDFs instead of showing them. That's the phone's behaviour and is fine for this ticket.
- The app already saves each packet and Excel summary in storage when someone downloads it. A shared file should reuse that saved copy when nothing changed, not build or store a second one.
- A link must never give access to anything else in the organization: only its one file.

## Not part of this ticket

- Sharing month documents, cover sheets or the signed copy.
- One link that gives both files together.
- Expiry dates on links.
- Sending the link by email from the app.
- A count of how many times a link was opened.
- Showing sharing in the month's history.

## Done when

- A **Share link** button sits next to the two download buttons, which work exactly as before.
- Share link lets the user pick Packet (PDF) or Summary (Excel), with an optional password, and shows Copy link.
- Each funding source and month has at most one PDF link and one Excel link. Sharing an already-shared file shows its existing link.
- The Shared links box shows one row per file: the date, who shared it, whether it has a password, Copy link, Change password and Stop sharing. Each row only affects its own link.
- The PDF link opens in the browser viewer in Chrome, Edge and Safari. Clicking a cover letter reference jumps to its receipt, and the footer reference jumps back.
- The Excel link downloads the same file as "Download Summary (Excel)".
- A password-protected link asks for the password, refuses a wrong one, and pauses after 5 wrong tries.
- Changing a password makes the old one stop working immediately.
- Stop sharing makes the link show "This link is no longer available." Sharing again gives a new link.
- After an expense changes, each shared file shows the "records changed" message. Update shared file puts the new file behind the same link.
- Opening a link many times never builds the file again.
- A paused or cancelled organization's links show "no longer available" and work again once access is restored.
- A link from one organization can never open another organization's file or any other file.
- Tested with a large packet (70 MB or more): it opens and navigation works.
