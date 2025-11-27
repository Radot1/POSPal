# Email Template Modernization Tracker

**Approach:** The cancellation email is our reference design. For every other Resend template we literally copy that structure (layout, footer, badges, subscription ID block) and only adjust the textual content or highlight values that are specific to the use case. Keep this in mind when updating statuses below.

This file tracks which Resend-powered emails already match the latest cancellation-style layout and which still need updates. Update the status column whenever a template is refactored.

| Template | Worker functions | Status | Notes |
| --- | --- | --- | --- |
| Subscription cancelled | `getSubscriptionCancelledEmailTemplate`, `sendSubscriptionCancelledEmail` | Complete | Baseline template. Do not alter without product sign-off. |
| Welcome (license ready) | `getWelcomeEmailTemplate`, `sendWelcomeEmail` | Complete | Matches cancellation layout; copy approved (Active highlight + host-computer instructions). |
| Payment failure (legacy) | `getPaymentFailureEmailTemplate`, `sendPaymentFailureEmail` | Pending | Deprecated but still callable. Align with new design or formally retire. |
| Immediate suspension (no grace) | `getImmediateSuspensionEmailTemplate`, `sendImmediateSuspensionEmail` | Complete | Cancellation layout with billing summary + Settings → Licensing guidance. |
| Immediate reactivation | `getImmediateReactivationEmailTemplate`, `sendImmediateReactivationEmail` | Complete | Mirrors cancellation layout with success tone + reactivation details. |
| Renewal processed receipt | `getRenewalProcessedEmailTemplate`, `sendRenewalProcessedEmail` | Pending | Include charge summary using new highlight block. |
| Renewal reminder | `getRenewalReminderEmailTemplate`, `sendRenewalReminderEmail` (+ scheduler) | Pending | Drives upcoming renewal automation. |
| Cancellation reversal / renewal confirmation | `getCancellationReversalEmailTemplate`, `sendCancellationReversalEmail` | Complete | Mirrors cancellation layout with welcome-back copy + subscription ID line. |
| Machine switch alert | `getMachineSwitchEmailTemplate`, `sendMachineSwitchEmail` | Pending | Security-sensitive; ensure warning styling carries over. |
| License disconnection confirmation | `getLicenseDisconnectionEmailTemplate`, `sendLicenseDisconnectionEmail` | Pending | Includes unlock token block. |
| License recovery (unlock token resend) | `getLicenseRecoveryEmailTemplate`, `handleRecoverLicense` | Pending | Must preserve token block but adopt new shell. |
