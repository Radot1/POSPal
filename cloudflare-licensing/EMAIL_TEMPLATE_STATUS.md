# Email Template Modernization Tracker

**Approach:** The cancellation email is our reference design. For every other Resend template we literally copy that structure (layout, footer, badges, subscription ID block) and only adjust the textual content or highlight values that are specific to the use case. Keep this in mind when updating statuses below.

This file tracks which Resend-powered emails already match the latest cancellation-style layout and which still need updates. Update the status column whenever a template is refactored.

| Template | Worker functions | Status | Notes |
| --- | --- | --- | --- |
| Subscription cancelled | `getSubscriptionCancelledEmailTemplate`, `sendSubscriptionCancelledEmail` | Complete | Baseline template. Do not alter without product sign-off. |
| Welcome (license ready) | `getWelcomeEmailTemplate`, `sendWelcomeEmail` | Complete | Matches cancellation layout; copy approved (Active highlight + host-computer instructions). |
| Payment failure (legacy) | `getPaymentFailureEmailTemplate`, `sendPaymentFailureEmail` | Retired | Legacy template removed; use immediate suspension email instead. |
| Immediate suspension (no grace) | `getImmediateSuspensionEmailTemplate`, `sendImmediateSuspensionEmail` | Complete | Cancellation layout with billing summary + Settings → Licensing guidance. |
| Immediate reactivation | `getImmediateReactivationEmailTemplate`, `sendImmediateReactivationEmail` | Complete | Mirrors cancellation layout with success tone + reactivation details. |
| Renewal processed receipt | `getRenewalProcessedEmailTemplate`, `sendRenewalProcessedEmail` | Complete | Cancellation layout with charge highlight; period end spelled out in bold sentence. |
| Renewal reminder | `getRenewalReminderEmailTemplate`, `sendRenewalReminderEmail` (+ scheduler) | Complete | Cancellation layout with days-left highlight + streamlined copy (no detail box). |
| Cancellation reversal / renewal confirmation | `getCancellationReversalEmailTemplate`, `sendCancellationReversalEmail` | Complete | Mirrors cancellation layout with welcome-back copy + subscription ID line. |
| Machine switch alert | `getMachineSwitchEmailTemplate`, `sendMachineSwitchEmail` | Complete | Cancellation layout with security alert highlight + concise “different device” copy. |
| License disconnection confirmation | `getLicenseDisconnectionEmailTemplate`, `sendLicenseDisconnectionEmail` | Complete | Cancellation layout with unlock token block + security reminder. |
| License recovery (unlock token resend) | `getLicenseRecoveryEmailTemplate`, `handleRecoverLicense` | Complete | Cancellation layout with unlock token block + friendly instructions. |
