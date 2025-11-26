# Email Template Modernization Tracker

This file tracks which Resend-powered emails already match the latest cancellation-style layout and which still need updates. Update the status column whenever a template is refactored.

| Template | Worker functions | Status | Notes |
| --- | --- | --- | --- |
| Subscription cancelled | `getSubscriptionCancelledEmailTemplate`, `sendSubscriptionCancelledEmail` | Complete | Baseline template. Do not alter without product sign-off. |
| Welcome (license ready) | `getWelcomeEmailTemplate`, `sendWelcomeEmail` | Pending | Needs conversion to the cancellation layout. |
| Payment failure (legacy) | `getPaymentFailureEmailTemplate`, `sendPaymentFailureEmail` | Pending | Deprecated but still callable. Align with new design or formally retire. |
| Immediate suspension (no grace) | `getImmediateSuspensionEmailTemplate`, `sendImmediateSuspensionEmail` | Pending | Critical billing notice; must mirror cancellation styling. |
| Immediate reactivation | `getImmediateReactivationEmailTemplate`, `sendImmediateReactivationEmail` | Pending | Confirm messaging about restored access after restyle. |
| Renewal processed receipt | `getRenewalProcessedEmailTemplate`, `sendRenewalProcessedEmail` | Pending | Include charge summary using new highlight block. |
| Renewal reminder | `getRenewalReminderEmailTemplate`, `sendRenewalReminderEmail` (+ scheduler) | Pending | Drives upcoming renewal automation. |
| Cancellation reversal / renewal confirmation | `getCancellationReversalEmailTemplate`, `sendCancellationReversalEmail` | Complete | Mirrors cancellation layout with success messaging + reactivation guidance. |
| Machine switch alert | `getMachineSwitchEmailTemplate`, `sendMachineSwitchEmail` | Pending | Security-sensitive; ensure warning styling carries over. |
| License disconnection confirmation | `getLicenseDisconnectionEmailTemplate`, `sendLicenseDisconnectionEmail` | Pending | Includes unlock token block. |
| License recovery (unlock token resend) | `getLicenseRecoveryEmailTemplate`, `handleRecoverLicense` | Pending | Must preserve token block but adopt new shell. |
