# Refer & earn: which e-mails are sent, and from where

## Sender
- All platform e-mails go through the verified, managed sending domain **notify.aisupport360.com** (SPF/DKIM handled
  there). The visible From is on the root domain **aisupport360.com** (`"AI Support 360" <noreply@aisupport360.com>`).
- Reply-To and the footer contact line default to **info@aisupport360.com**. Display name, From (local part on
  aisupport360.com only), Reply-To and contact are super-admin settings (docs/sql/email-sender.sql,
  `_shared/emailSender.ts`); invalid values fall back to the defaults.
- No extra DNS records are needed for From on aisupport360.com or Reply-To info@aisupport360.com. The owner only has to
  make sure the **info@aisupport360.com mailbox exists and receives mail** (MX records of the root domain at the mail
  host). The NS delegation of notify.aisupport360.com must stay in place.

## Sent by e-mail (one recipient, triggered by their own event)
Event notices (registered, invited, interview passed, active, verified, reminders, accept terms, expired, rewards
earned / held / available / paid / reversed, referral not accepted, bank details changed), the monthly statement and the
weekly administrator summary. Each honours the Feature Q pauses, carries the managed unsubscribe footer, and the
referral kill switches apply.

## NOT sent by e-mail
1. **Admin "Send Refer & earn invitation" to existing consultants** (Admin > Users). The same promotional message to a
   list of people is a bulk/marketing send; the app e-mail service only carries one-recipient, event-triggered mail.
   It goes in-app, push and Telegram. E-mail would need a dedicated marketing e-mail service (consent, list
   unsubscribe, separate sending reputation).
2. **E-mails to colleagues who are not registered.** Never sent by the platform. Consultants share from their own
   mailbox and apps: copy link, ready message EN/AR, WhatsApp, LinkedIn, Telegram, X, QR, and "Open in my mail app"
   (mailto: with subject and body prefilled). The switch `referral_invites_to_non_users_enabled` is seeded OFF and the
   settings function refuses to turn it on; enabling it requires the owner's explicit approval, a marketing e-mail
   service, consent records and unsubscribe handling.
