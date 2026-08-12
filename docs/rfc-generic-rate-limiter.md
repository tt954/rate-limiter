# RFC: Generic Request Rate Limiter (Phased: Global → Endpoint-Aware)

**Status:** Draft
**Author:** [TBD]
**Reviewers:** [TBD]
**Date:** 2026-08-11
**Supersedes:** `rfc-login-rate-limiter.md` (folded in as Phase 2 below)

## 1. Summary

Build one configurable, reusable rate-limiting engine — not a login-specific one — and roll it out in two phases:

- **Phase 1:** a generic, blanket limiter applied broadly across all routes (IP/API-key based), shipped now.
- **Phase 2:** an account-aware layer for sensitive endpoints (starting with `/auth/login`), added when scale or threat model justifies it.

Both phases share the same engine; Phase 2 is additional *config and key resolvers*, not new infrastructure.

## 2. Problem

We have no request throttling anywhere in the app. This exposes us to:
- Volumetric abuse / scraping / accidental traffic spikes from any client, on any route.
- Credential stuffing and brute force specifically on `/auth/login`.
- Resource exhaustion on expensive endpoints (password hashing, search, file uploads).

Given current scale, building a login-specific, account-aware limiter as the *first* thing is premature — most of our real, current risk is generic traffic abuse across the whole app, not targeted account attacks. We build for the risk we have now, with a clear path to the risk we'll have later.

## 3. Goals

- One engine, reusable across all endpoints, driven by config rather than route-specific code.
- Ship broad protection quickly (Phase 1) with minimal implementation cost.
- Support adding fine-grained, context-aware rules (Phase 2) without re-architecting.
- Fail safe: limiter outage must not take down the app.
- Consistent, predictable client-facing behavior (`429` + `Retry-After`) across every route.

## 4. Non-Goals

- CAPTCHA / bot detection (separate RFC).
- Edge/CDN-level enforcement (e.g. Cloudflare rules) — complementary, out of scope, assumed to exist or be added independently as a coarser outer layer.
- Device fingerprinting or risk-based auth.

## 5. Design

### 5.1 Algorithm decision matrix

The engine supports both algorithms per rule (configurable), rather than picking one globally — different routes have different tolerance for bursts.

| | Token bucket | Sliding window counter |
|---|---|---|
| Optimizes for | Smoothing + burst tolerance | Precise, strict cap enforcement |
| Allows short bursts above average rate | Yes (up to bucket size) | No |
| Best for | General API traffic, bursty-but-legitimate clients, downstream protection | Security-sensitive endpoints, hard abuse caps (brute force, enumeration) |
| Risk if misapplied | Under-protects against bursty attacks | Over-throttles legitimate bursty clients |
| Used for | Phase 1 default global rule | Phase 2 login account/IP rules |

**Decision for this RFC:**
- **Phase 1 (global default):** token bucket. General app traffic is naturally bursty (page loads, dashboard refreshes), and the goal is smoothing/infra protection, not eliminating bursts.
- **Phase 2 (`/auth/login` account + IP rules):** sliding window. Any burst on a login endpoint is itself a likely attack signature (brute force, credential stuffing, account enumeration) — burst tolerance would work against us here, potentially letting an attacker front-load a burst then trickle at the refill rate to evade detection.

Both algorithms are implemented once in the shared engine (`bucket` type: `token` | `sliding_window` in rule config) so no route is locked into one approach.

### 5.2 Core engine (shared by both phases)

A single middleware, applied per-route via config:

```yaml
rate_limits:
  default:                      # applied to any route without an explicit override
    - key: ip
      limit: 100
      window_seconds: 60
      count: all

  routes:
    /auth/login:
      - key: ip
        limit: 10
        window_seconds: 60
        count: all
    /auth/signup:
      - key: ip
        limit: 5
        window_seconds: 60
        count: all
```

- **Algorithm:** configurable per rule — token bucket or sliding window counter (see §5.1 for when each applies). Both are Redis-backed: token bucket via a counter + last-refill timestamp updated atomically per request; sliding window via `INCR` + `EXPIRE` on minute-bucketed keys, summed over the window. Fixed window is not offered as an option — it has a boundary-burst weakness neither use case wants.
- **Storage:** Redis, TTL = window/bucket lifetime, no cleanup job needed.
- **Key resolution:** pluggable resolvers (`resolveIp`, `resolveApiKey`, `resolveAccount`, ...) referenced by name in config. Phase 1 only needs `resolveIp`; Phase 2 adds `resolveAccount` without touching the engine.
- **Count semantics:** configurable per rule (`all` vs `failures_only` vs `success_only`), resolved by the caller after the request completes. Phase 1 uses `all` everywhere; Phase 2's login rule uses `failures_only` (see §5.4).

### 5.3 Phase 1 — Global, generic limiter (ship now)

- Applies to **every route** via a default rule, keyed on IP.
- A handful of routes get tighter overrides where warranted (`/auth/login`, `/auth/signup`, `/password-reset`) — still IP-only, no account awareness yet.
- No business logic knowledge required; this is pure infrastructure protection.
- Response contract (applies to both phases, for consistency):

```
HTTP 429 Too Many Requests
Retry-After: <seconds>
{
  "error": "rate_limited",
  "message": "Too many requests. Try again in 12 seconds.",
  "retry_after_seconds": 12
}
```

### 5.4 Phase 2 — Account-aware layer for `/auth/login` (ship when triggered)

Add a second rule on top of the existing IP rule for this route:

```yaml
routes:
  /auth/login:
    - key: ip
      limit: 10
      window_seconds: 60
      count: all
    - key: account
      limit: 5
      window_seconds: 900
      count: failures_only
```

- `resolveAccount` derives the key from the normalized email/username in the request body (lowercased, trimmed).
- Only failed attempts count toward this rule; account counter resets to 0 on successful login.
- Same generic `429` response as Phase 1 — do not reveal whether the block was IP- or account-based, or whether the account exists (avoids account enumeration).
- The IP rule here also covers **account enumeration** (probing many distinct usernames/emails from one source to detect which exist): sliding window is chosen specifically because token bucket's burst allowance would let an attacker front-load a burst of probes then trickle at the refill rate to evade detection. Full enumeration mitigation additionally requires normalizing response status/message/latency for "wrong password" vs. "no such account" — tracked as a follow-up, not solved by rate limiting alone.
- No new infrastructure: same Redis, same middleware, same response contract. Just a new rule + resolver.

**Trigger to build Phase 2:** any of —
- Observed clustering of failed logins on specific accounts (credential stuffing signature).
- Handling sensitive data (PII, payments) making the login surface a higher-value target.
- A security review or incident flags the gap.
- Sufficient user base to reasonably expect targeted attacks.

Until triggered, Phase 1's tighter per-IP rule on `/auth/login` is the interim protection.

## 6. Relationship to gateway/edge layer

If/when an edge layer (Cloudflare, API Gateway, etc.) is added, it complements this engine rather than replacing it — it should carry a **looser, coarser** IP threshold than the application-level default (its job is catching egregious volume/DDoS-adjacent traffic before it reaches compute), while this engine remains the source of truth for precise, per-account, business-aware rules. Thresholds should intentionally differ between the two layers, not mirror each other.

## 7. Failure Modes

| Failure | Behavior |
|---|---|
| Redis unreachable | **Fail open**, fall back to a conservative in-memory per-instance limiter, alert on-call. Failing closed turns a Redis outage into a full outage of every route — unacceptable given this now sits in front of all traffic. |
| Redis latency spike | Timeout the check (e.g. 20ms); treat as fail-open on timeout, with alerting. |
| Misconfigured rule (e.g. limit: 0) | Config validated at startup/deploy; reject deploy if any rule is degenerate (limit ≤ 0, window ≤ 0). |

## 8. Observability

- `rate_limit_triggered{route, key_type}` (counter)
- `rate_limit_check_latency_ms` (histogram)
- `rate_limit_backend_errors` (counter, fail-open events)

Alert on abnormal fail-open rate (Redis degradation) and on abnormal trigger-rate spikes per route (potential active abuse).

## 9. Rollout Plan

1. Ship Phase 1 engine + middleware, default rule applied globally, in **shadow mode** (log-only) for ~1 week to validate no false positives on legitimate traffic.
2. Enable enforcement globally with default rule.
3. Add tighter IP overrides for `/auth/login`, `/auth/signup`, `/password-reset`.
4. Monitor for Phase 2 trigger conditions (§5.4); implement `resolveAccount` and the account rule when triggered — no engine changes required.

## 10. Alternatives Considered

- **Build the account-aware login limiter first (original RFC):** rejected as the *first* step given current scale — over-engineered relative to present risk, and doesn't protect any other endpoint. Retained as Phase 2, ready to slot in.
- **Rely solely on an edge/CDN layer:** rejected as sole solution — no account context, can't stop targeted brute force, and we may not have an edge layer yet at this stage.
- **Separate limiter implementations per team/service:** rejected — fragments logic, duplicates Redis usage patterns, harder to reason about consistently.

## 11. Open Questions

- Should Phase 1's default global limit differ by authenticated vs. unauthenticated traffic once we have API keys/tokens in play?
- When Phase 2 ships, should the account limit apply progressive backoff instead of a flat window?
- Do we want per-route config to live in code (versioned, reviewed) or in a dynamically-editable store (faster tuning, less rigor)? Recommend starting with code-based config for auditability.
