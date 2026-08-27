# Plan: Login Page

## Goal

Add a dedicated, responsive login screen to the rate-limiter demo. The form will collect a username/email and password, call the existing `POST /demo/login` endpoint, and clearly show successful login, invalid credentials, rate limiting, network failures, and in-progress submission states.

This is a demo login flow, not production authentication. The current backend treats the password `correct` as successful and does not create a session or grant access to protected routes.

## Current State

- The frontend is a single React entry point in `frontend/src/main.jsx`; it has no routing dependency.
- The simulator already calls `POST /demo/login?algorithm=...` for its brute-force preset, but there is no user-facing login form.
- `POST /demo/login` accepts JSON shaped as `{ "username": string, "password": string }`.
- A successful request returns HTTP 200 with `{ "ok": true, "message": "logged in" }`.
- Invalid credentials return HTTP 200 with `{ "ok": false, "message": "invalid credentials" }`.
- A blocked attempt returns HTTP 429 with a `Retry-After` header and an error body containing `message` and `retry_after_seconds`.
- The configured login policy uses sliding-window limits for both IP attempts and failed attempts per normalized account.

## UX and Security Principles

Use the guidance in `/Users/tt/Documents/code/toast/src/posts/sign-up-and-log-in.md`, limited to the parts relevant to login:

- Autofocus the username/email field.
- Use explicit, associated labels and semantic input types (`email` and `password`) with appropriate autocomplete attributes.
- Validate on blur and again on submit, with inline messages tied to their fields.
- Use the specific action label **Log in**.
- Keep the entered email after an unsuccessful attempt; clear only the password.
- Add a keyboard- and screen-reader-accessible show/hide password control.
- Give users helpful feedback while avoiding different credential errors that could reveal whether an account exists.
- Prevent duplicate submissions and announce request-level status changes accessibly.

Because this iteration is login-only, do not add signup, forgot-password, remember-me, social login, magic links, or terms/privacy consent controls. Do not render dead links for flows that do not exist.

## Proposed Experience

1. Add a small top-level navigation control that switches between the existing rate-limiter lab and a dedicated **Login demo** view. Keep this dependency-free unless browser-addressable routes become a requirement.
2. Present a centered login card that visually fits the existing typography, color tokens, and technical-demo aesthetic.
3. Include:
   - A short explanation that this is a simulated login protected by the sliding-window limiter.
   - An email field.
   - A password field with a show/hide control.
   - A **Log in** button.
   - A compact demo hint stating that `correct` is the success password, so the flow is discoverable.
4. Submit to `POST /demo/login` without an algorithm override, allowing the backend's configured sliding-window policy to remain authoritative.
5. On success, show an inline success state in the login view. Do not redirect to or imply the existence of an authenticated area because the endpoint creates no session.
6. On invalid credentials, retain the email, clear the password, focus the password field, and show a single generic credential error.
7. On HTTP 429, show the server-provided retry message/countdown, retain the email, clear the password, and temporarily disable submission until the retry period ends.
8. On a network or unexpected server error, preserve both fields where safe and show a retryable form-level message.

## Implementation Plan

### 1. Separate API behavior from presentation

- Add a small frontend API helper for the login request so response parsing and error mapping do not live inside JSX.
- Model four outcomes explicitly: success, invalid credentials, rate limited, and unexpected failure.
- Read the 429 delay from `Retry-After`, with `retry_after_seconds` as a fallback.
- Handle non-JSON and non-2xx responses defensively.
- Reuse the configured `VITE_API_URL` base URL.

### 2. Add the login view

- Extract a `LoginPage` component rather than expanding the already large simulator component further.
- Use controlled fields for email and password.
- Normalize the email for validation (trim whitespace), while leaving account normalization authoritative on the backend.
- Validate a required, plausibly formatted email and a required password on blur and submit. Do not impose new password-strength rules on login.
- Associate each error with its input using `aria-describedby` and mark invalid fields with `aria-invalid`.
- Implement password visibility as a `type="button"` control with an accessible state label.
- Track idle, submitting, success, credential-error, rate-limited, and unexpected-error UI states.
- Use an `aria-live` status region for form-level results.
- Disable the submit button while a request is active and while a rate-limit cooldown is active.
- Clean up cooldown timers if the view unmounts.

### 3. Integrate view switching

- Keep the existing simulator as the default view.
- Add a clear **Login demo** entry point and a way back to the algorithm lab.
- Preserve simulator state when switching views by keeping navigation state above both views or by hiding/unmounting intentionally and documenting the choice.
- If direct URLs, refresh persistence, or browser back/forward support are desired later, introduce routing as a separate enhancement rather than silently adding a dependency in this task.

### 4. Style responsively

- Reuse the existing Tailwind theme and design tokens.
- Add narrowly scoped login styles instead of changing global `label`, `button`, or `main` rules in ways that could regress the simulator.
- Ensure the card, fields, actions, error text, and password toggle work at mobile widths and at 200% zoom.
- Provide visible focus treatment and do not rely on color alone for success/error meaning.

### 5. Tighten the endpoint contract where needed

- Keep `POST /demo/login` and its demo-only credential behavior unchanged unless implementation reveals a contract gap.
- Confirm invalid credentials remain indistinguishable at the response level; do not expose account existence.
- Consider returning the invalid-credential outcome with HTTP 401 in a future API-contract cleanup, but do not make that unrelated breaking change as part of the page unless frontend and backend tests are updated together.
- Do not add cookies, tokens, user storage, password hashing, protected routes, or session management in this iteration.

### 6. Verify behavior

- Add frontend test tooling only if the project is ready to adopt it; otherwise cover the API helper with the lightest compatible test setup and document manual checks.
- Test client-side validation, show/hide password behavior, duplicate-submit prevention, and accessible error associations.
- Mock and test all endpoint outcomes: success, `{ ok: false }`, HTTP 429, malformed/unexpected response, and network failure.
- Verify the username remains populated and password clears after credential and rate-limit failures.
- Verify the cooldown prevents requests until expiry and the timer is cleaned up.
- Run the frontend production build and existing backend tests.
- Manually exercise the page against Docker Compose using `correct`, an incorrect password, and enough failed attempts to trigger both account and IP limits.
- Check keyboard-only navigation, screen-reader announcements, narrow mobile layout, and browser back/forward expectations for the chosen view-switching approach.

## Expected File Changes

- `frontend/src/main.jsx` — extract or compose the existing simulator and add top-level view switching.
- `frontend/src/components/LoginPage.jsx` — login form and interaction states.
- `frontend/src/api/login.js` — endpoint call and response/error normalization.
- `frontend/src/style.css` — scoped responsive login and navigation styling.
- Frontend test files/configuration, if test tooling is introduced.
- `README.md` — explain how to open and exercise the login demo, including the demo password and the lack of a real session.

No backend change is expected for the initial implementation.

## Acceptance Criteria

- A user can open the login demo, enter an email and password, and submit to `POST /demo/login`.
- The default backend login policy is used; the form does not expose the demo algorithm override.
- Empty or malformed input produces inline accessible validation without making a request.
- Submission has an obvious pending state and cannot be duplicated.
- Password visibility can be toggled with mouse, keyboard, and assistive technology.
- `correct` produces a clear success result without pretending a persistent session exists.
- Incorrect credentials produce a generic helpful error, retain the email, clear the password, and return focus to the password field.
- HTTP 429 displays the retry duration and prevents premature resubmission.
- Network and unexpected server failures are distinguishable from invalid credentials and can be retried.
- The page is usable on mobile, with a keyboard, and at 200% zoom without breaking the existing simulator.
- Signup and all other authentication/account-recovery flows remain out of scope.

## Follow-ups (Out of Scope)

- Real users, password hashing, sessions/cookies, logout, and protected routes.
- Signup and email verification.
- Forgot-password/password-reset flows.
- Remember-me behavior.
- Dedicated URL routing for the login page.
- Server-side session-aware redirects.
