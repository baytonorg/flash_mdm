# `src/pages/SigninEnroll.tsx`

> Public-facing device enrollment page rendered in Chrome Custom Tab during Android Enterprise sign-in URL provisioning.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `SigninEnroll` | `React.FC` (default) | Sign-in URL enrollment page component |

## Key Logic

This is a standalone public page (no authenticated layout) designed to run inside a Chrome Custom Tab on an Android device during work profile setup.

The page follows a three-stage flow:

1. **Email stage**: The user enters their work email address. On submit, a `POST /api/signin/enroll` request is sent with `action: 'send-code'`, the email, and the `provisioningInfo` query parameter (passed by Android Enterprise). On success, transitions to the code stage.

2. **Code stage**: The user enters a 6-digit numeric verification code sent to their email. On submit, a `POST /api/signin/enroll` request is sent with `action: 'verify'`, the email, code, and provisioning info. On success, the server returns a `redirect_url` which the page navigates to after a brief delay, completing the device enrollment flow.

3. **Redirecting stage**: Shows a loading spinner with "Setting up your work profile..." while the browser redirects to the enrollment URL.

The page uses raw `fetch` calls (not `apiClient`) since it runs outside the authenticated app context. Error handling displays inline banners. The code stage includes "Change email" and "Resend code" buttons.
