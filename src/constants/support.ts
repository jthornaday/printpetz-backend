/**
 * The address customers write to. Printed on emails (as the reply-to) and shown on the site's
 * policy pages (the frontend has its own copy: NEXT_PUBLIC_SUPPORT_EMAIL).
 *
 * To move to support@printpetz.com once that mailbox exists and forwards correctly: set SUPPORT_EMAIL
 * in Elastic Beanstalk. No deploy needed beyond the restart. Order alerts to Jake do NOT use this:
 * they go to ALERT_EMAIL / his own inbox, so they keep working if this address changes.
 */
export const supportEmail = () =>
  process.env.SUPPORT_EMAIL?.trim() || "myprintpetz@gmail.com";
