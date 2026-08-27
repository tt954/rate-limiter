# Research: Evolving the Login Demo into a Full Application

## Purpose

This note records what would be required to evolve the rate-limiter demo's simulated login into a production-oriented identity system supporting passwords, password recovery, passkeys, sessions, and protected application features.

The central architectural change is the introduction of persistent users and sessions. This does not initially require splitting authentication into a separate microservice. A modular FastAPI application backed by PostgreSQL, with Redis retained for rate limiting and short-lived state, is the simplest sound starting point.

## Current Demo Architecture

The application currently has three services:

- A React/Vite frontend.
- A FastAPI backend.
- Redis for rate-limit state.

The existing `POST /demo/login` endpoint is intentionally simulated:

- It accepts a username and password.
- The password `correct` is treated as successful.
- It does not store users or password hashes.
- It does not create a session.
- It does not authorize access to protected resources.
- Redis protects the endpoint with IP- and account-aware rate limits but is not an identity database.

## Target Architecture

```text
Browser
  │ HTTPS + secure session cookie
  ▼
React application
  │
  ▼
FastAPI application
  ├── Authentication and authorization
  ├── PostgreSQL: users, credentials, sessions, recovery tokens
  ├── Redis: rate limits, temporary challenges, optional caching
  ├── Email provider: verification and password-reset messages
  └── Background worker: email and security-event jobs
```

Authentication should begin as a module inside the existing backend. A separate authentication service would be warranted later only if several independent applications needed a shared identity platform or operational scaling required that boundary.

## Comparison with the Demo

| Area | Current demo | Full application |
|---|---|---|
| Users | No user records | Persistent PostgreSQL identities |
| Passwords | Literal comparison to `correct` | Salted password hashes, preferably Argon2id |
| Login | Returns an `ok` value | Creates and rotates an authenticated session |
| Browser state | None | Secure, HttpOnly, SameSite session cookie |
| Sessions | None | Server-side session records with expiry and revocation |
| Authorization | None | Protected routes and ownership/role checks |
| Password recovery | None | Expiring, single-use reset-token workflow |
| Passkeys | None | WebAuthn registration and authentication ceremonies |
| Email | None | Transactional email service and verified sending domain |
| Redis | Rate-limit state | Rate limits plus temporary challenges or cache |
| Operations | Local Docker Compose | HTTPS, secrets, migrations, backups, monitoring |

## Required Services and Infrastructure

### PostgreSQL

PostgreSQL would become the durable source of truth. An initial data model could include:

- `users`
  - Random internal identifier.
  - Normalized, uniquely indexed email address.
  - Email-verification and account-status fields.
  - Created and updated timestamps.
- `password_credentials`
  - User identifier.
  - Password hash.
  - Password-change timestamp.
- `sessions`
  - Hash of the session token, never the raw browser token.
  - User identifier.
  - Creation, last-use, expiry, and revocation timestamps.
  - Limited device metadata if it is needed for session management.
- `email_verification_tokens`.
- `password_reset_tokens`.
- `passkey_credentials`
  - Credential identifier.
  - User identifier.
  - Public key.
  - Signature counter and relevant authenticator metadata.
- Optional `security_events` for logins, failures, credential changes, and session revocations.

Keeping authentication methods in separate credential tables makes it possible for one user to have a password, multiple passkeys, and eventually federated identities without overloading the user record.

### Password handling

- Hash passwords with a password-specific algorithm such as Argon2id using an established library.
- Never store or log plaintext passwords.
- Apply a suitable password policy at signup and password change, not an arbitrary strength rule during login.
- Normalize credential failures so callers cannot distinguish an unknown account from an incorrect password.
- Consider whether changing a password should revoke every existing session.

### Transactional email

Email verification and password recovery require a provider such as Amazon SES, Postmark, Mailgun, or SendGrid, along with:

- A verified sender and sending domain.
- SPF, DKIM, and preferably DMARC DNS records.
- Verification, reset, and security-notification templates.
- Bounce and complaint processing.
- Provider credentials stored in a secret manager.
- A development mail catcher such as Mailpit instead of real delivery locally.

### Background worker

A worker becomes useful for work that should not delay HTTP responses:

- Sending and retrying verification or reset emails.
- Sending security-event notifications.
- Cleaning expired sessions and tokens.
- Exporting audit or analytics events.

Redis can initially back the job queue. The worker can remain part of the same repository and application architecture.

### Secrets and configuration

Production configuration would include:

- Database and Redis credentials.
- Session and token-generation secrets where applicable.
- Email provider credentials.
- Exact public application origin and cookie settings.
- WebAuthn relying-party ID and accepted origins.
- Separate development, staging, and production values.

Secrets must not be committed to the repository and should be rotated through the deployment platform's secret manager.

## Session Design

For a browser-focused application, opaque server-managed sessions are a strong initial choice. This avoids exposing long-lived bearer tokens to frontend JavaScript and makes revocation straightforward.

A typical flow is:

1. Authenticate with a password or passkey.
2. Generate a cryptographically random session token.
3. Store only a hash of that token with its server-side session record.
4. Send the raw token in a `Secure`, `HttpOnly`, appropriately `SameSite` cookie.
5. Resolve the session for each protected request.
6. Rotate the session after authentication, privilege changes, or other sensitive events.
7. Support individual logout and revocation of all sessions.

PostgreSQL can be the durable source of truth for sessions. Redis may cache lookups later, but a separate session service is unnecessary at modest scale. Authentication state in React should come from a server endpoint such as `GET /auth/session`, not from a frontend flag or `localStorage`.

Because a session identifier carries the authority of the authentication method, it must receive the same security attention as a password or passkey-authenticated login. See the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Forgot-Password Flow

A safe reset flow would be:

1. The user submits an email address.
2. The application always returns the same message and should avoid measurably different response behavior whether or not the account exists.
3. For an existing account, generate a cryptographically random, short-lived token.
4. Store only a secure representation of that token and mark it as unused.
5. Send a reset URL through the verified email channel.
6. Validate the token before accepting a new password.
7. Consume the token exactly once and update the password hash.
8. Notify the account owner that the password changed.
9. Revoke existing sessions automatically or explicitly offer that choice.
10. Return the user to the normal login flow rather than automatically authenticating them.

Reset-request and reset-confirmation endpoints require their own rate-limit policies. A reset request must not reveal whether an account exists. These requirements follow the [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Passkeys and WebAuthn

Passkeys use WebAuthn public-key credentials. The server stores a public key while the private credential remains controlled by the user's authenticator.

Two ceremonies are required:

- Registration: the server issues a one-time challenge, the browser creates a credential, and the server verifies and stores the credential's public information.
- Authentication: the server issues a one-time challenge, the browser obtains a signed assertion, and the server verifies it before creating a normal application session.

Implementation requirements include:

- A stable production domain selected deliberately as the WebAuthn relying-party ID.
- HTTPS in production; `localhost` is the development exception.
- Exact validation of expected origins and the relying-party ID.
- Short-lived, one-time challenges, potentially stored in Redis.
- A maintained WebAuthn server library rather than custom cryptographic verification.
- Random, non-personally-identifying WebAuthn user handles.
- Generic failures and careful option generation to limit account enumeration.
- Recovery methods so losing all passkeys does not permanently lock out a user.
- An account-security interface for adding, naming, viewing, and removing passkeys.

The relying-party domain decision matters because credentials are scoped to it. The [W3C WebAuthn specification](https://www.w3.org/TR/webauthn-3/) defines RP ID and origin validation requirements and cautions against placing email addresses or usernames in user handles. MDN provides a useful [passkey implementation overview](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys).

## Backend Evolution

The current `backend/app/routes/demo.py` mixes simulated credential behavior with rate-limiter orchestration. A production-oriented structure could become:

```text
backend/app/
  auth/
    models.py
    passwords.py
    sessions.py
    passkeys.py
    tokens.py
    dependencies.py
  routes/
    auth.py
    account.py
    demo.py
  services/
    email.py
  db/
    models.py
    migrations/
  engine/
    ...existing rate limiter...
```

Potential endpoints include:

```text
POST   /auth/signup
POST   /auth/email/verify
POST   /auth/login
POST   /auth/logout
POST   /auth/logout-all
GET    /auth/session

POST   /auth/password-reset/request
POST   /auth/password-reset/confirm

POST   /auth/passkeys/register/options
POST   /auth/passkeys/register/verify
POST   /auth/passkeys/login/options
POST   /auth/passkeys/login/verify
GET    /account/passkeys
DELETE /account/passkeys/{credential_id}
```

The existing limiter should remain reusable infrastructure around these routes. Login, signup, verification, password-reset requests, reset confirmation, and WebAuthn challenge generation should each receive deliberate IP- and, where safe, account-aware policies.

## Frontend Evolution

The demo's local view switching would eventually become real application routes:

```text
/login
/signup
/verify-email
/forgot-password
/reset-password
/account/security
```

The frontend would also need:

- An application-wide session loader.
- Protected-route behavior.
- CSRF protection appropriate to the cookie design.
- Session-expiry and reauthentication handling.
- Passkey capability detection and conditional UI.
- Account-security screens for passwords, passkeys, and active sessions.
- Generic recovery responses that do not disclose account existence.

## Local and Production Deployment

An expanded local Compose environment could contain:

- `frontend`.
- `backend`.
- `postgres`.
- `redis`.
- `worker`.
- `mailpit` for development only.

Production would additionally require:

- HTTPS and a stable domain.
- Managed PostgreSQL with encrypted backups and tested restoration.
- Managed Redis or an equivalent service.
- Database migrations as part of deployment.
- Secret management and key rotation.
- Structured security logging, monitoring, and alerts.
- Dependency and container scanning.
- Correct CORS, trusted-host, reverse-proxy, cookie-domain, and cookie-security settings.
- Data-retention, account-export, and account-deletion policies appropriate to the application.

## Build Versus Buy

Two reasonable paths exist:

### Managed identity provider

Services such as Auth0, Clerk, Cognito, or comparable providers can handle password storage, recovery, passkeys, MFA, and many session edge cases. This reduces security implementation responsibility but introduces recurring cost, service dependency, and customization or migration constraints.

### Application-owned authentication

Authentication can remain inside FastAPI using established password, session, email, and WebAuthn libraries. This provides control and educational value but makes the application team responsible for a security-sensitive subsystem and its ongoing maintenance.

For this project, an application-owned modular monolith is a reasonable learning path: add PostgreSQL, use opaque server-managed cookie sessions, keep Redis for rate limiting and temporary challenges, and avoid creating a separate authentication service prematurely.

## Suggested Delivery Sequence

1. Add PostgreSQL, migrations, and the user data model.
2. Implement signup, email verification, password hashing, and normalized login responses.
3. Add server-side sessions, logout, session loading, and protected-route dependencies.
4. Add transactional email and a background worker.
5. Implement the password-reset request and confirmation flows.
6. Add an account-security page and session management.
7. Add passkey registration and authentication with recovery safeguards.
8. Add production hardening: HTTPS/domain configuration, secrets, backups, monitoring, audit events, and abuse testing.

Each stage should retain and extend the rate limiter rather than replacing it.

## Key Conclusion

The rate-limiter demo already supplies one valuable piece of the future architecture: reusable abuse protection. Turning it into a full application requires surrounding that limiter with durable identities, secure credential storage, revocable server-side sessions, verified recovery channels, WebAuthn ceremonies, protected-resource authorization, and production operations. The preferred first architecture is still one FastAPI application with clearly separated modules—not a collection of authentication microservices.
