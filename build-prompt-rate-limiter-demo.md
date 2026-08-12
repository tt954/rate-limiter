# Build Prompt: Rate Limiter Demo App

Copy everything below into your coding assistant (Claude Code, etc.) to scaffold the project.

---

## Project Goal

Build a full-stack demo application that visually and interactively demonstrates two rate-limiting algorithms — **token bucket** and **sliding window counter** — implemented in Python/FastAPI, backed by Redis, with a React frontend that lets a user fire simulated traffic and watch each algorithm respond in real time. This is a portfolio/learning project: code quality, clarity, and the accuracy of the demonstrated behavior matter more than feature breadth.

The design follows an existing RFC (I will provide it — read it fully before writing any code and treat it as the source of truth for architecture decisions). Include the RFC in the repo under `docs/`.

## Stack

- **Backend:** Python, FastAPI, Redis (via `redis-py`, async client), Uvicorn
- **Frontend:** React (Vite), Recharts for visualizations, plain CSS or Tailwind (your choice, keep it clean and minimal)
- **Communication:** Server-Sent Events (SSE) from backend to frontend for live state updates (bucket fill level, window contents, allow/block events) — don't use polling
- **Local dev:** Docker Compose (backend + Redis + frontend, one command to run everything)
- **Tests:** pytest for the algorithm implementations specifically — these need to be correctness-verified, not just "runs without error"

## Backend Requirements

### 1. Algorithm implementations (`backend/app/algorithms/`)

Implement both as standalone, independently testable classes/functions — no FastAPI or HTTP concerns inside them:

- `token_bucket.py`: standard token bucket. Configurable `capacity` (max tokens) and `refill_rate` (tokens/sec). Support checking "would this request be allowed" and "consume a token" atomically against Redis (use a Lua script or Redis transaction to avoid race conditions — don't do read-then-write in two round trips).
- `sliding_window.py`: sliding window counter using minute-bucketed Redis keys (`INCR` + `EXPIRE`), summed across the trailing window. Configurable `limit` and `window_seconds`.

Both should expose the same interface, e.g.:
```python
async def check(key: str) -> RateLimitResult  # allowed: bool, remaining: int, retry_after: float, algorithm_state: dict
```
`algorithm_state` should return whatever internal state is useful for the frontend to visualize (current token count for bucket; current request count + window boundaries for sliding window).

### 2. Generic rate limit engine (`backend/app/engine/`)

A config-driven engine that wraps the two algorithms behind a common rule interface, matching the RFC's design:
- Rules are defined declaratively (route → list of rules, each with `key_type`, `algorithm`, and algorithm-specific params).
- Pluggable key resolvers: `resolve_ip(request)`, `resolve_account(request)` at minimum.
- A FastAPI dependency (`Depends(rate_limit(...))`) that applies the configured rules to a route and raises `HTTPException(429)` with a `Retry-After` header and the JSON body shape from the RFC when blocked.

### 3. Demo/simulation endpoints (`backend/app/routes/demo.py`)

These exist purely to be hammered by the frontend's traffic simulator:
- `POST /demo/traffic` — generic endpoint, rate-limited per the "Phase 1" config (token bucket, IP-keyed).
- `POST /demo/login` — simulated login endpoint, accepts `{ "username": str, "password": str }`, always fails unless password == `"correct"`, rate-limited per "Phase 2" config (sliding window, both IP-keyed and account-keyed, `failures_only` on the account rule).
- Both endpoints should let the caller pass an `algorithm` override (`token_bucket` | `sliding_window`) via query param, purely for demo purposes, so the frontend can run identical traffic against both algorithms side by side. (Note in a comment that this override is demo-only scaffolding and would not exist in the real system described by the RFC.)

### 4. Live state stream (`backend/app/routes/stream.py`)

An SSE endpoint (`GET /demo/stream`) that pushes a JSON event on every request handled by the demo endpoints: `{ timestamp, algorithm, key, allowed, algorithm_state }`. The frontend subscribes to this to drive the live visualizations instead of polling.

### 5. Config (`backend/app/config/rules.yaml`)

Externalize the rule definitions per the RFC's config schema (default global rule + per-route overrides). Load and validate at startup; fail fast on invalid config (limit <= 0, window <= 0, etc.).

### 6. Tests (`backend/tests/`)

- Unit tests for both algorithms in isolation (use `fakeredis` or a test Redis instance): verify token bucket allows bursts up to capacity then throttles at refill rate; verify sliding window enforces a hard cap and correctly evaluates a trailing window (including the boundary case fixed-window would get wrong).
- At least one test demonstrating the exact scenario from our design discussion: a "burst then trickle" traffic pattern that token bucket allows but sliding window blocks.

## Frontend Requirements

### 1. Traffic simulator panel
Controls to generate traffic patterns against the demo endpoints:
- **Steady** — fixed requests/sec for N seconds
- **Burst then idle** — N requests instantly, then silence
- **Burst then trickle** — N requests instantly, then a slow steady trickle (the brute-force/enumeration evasion pattern from the RFC)
- A manual "fire one request" button for granular exploration

### 2. Algorithm toggle / side-by-side mode
- Toggle to run a traffic pattern against a single algorithm, or
- Side-by-side mode: same generated traffic pattern sent to both `/demo/traffic?algorithm=token_bucket` and `/demo/traffic?algorithm=sliding_window` simultaneously, with two live visualizations rendered next to each other so the difference in behavior is directly visible.

### 3. Visualizations (subscribing to the SSE stream)
- **Token bucket view:** a fill-level gauge/bar showing current tokens available out of capacity, animating down on each allowed request and refilling over time.
- **Sliding window view:** a timeline showing requests within the trailing window as marks/dots, with the window boundary visibly sliding, and a count vs. limit indicator.
- **Shared request log:** scrolling list of recent requests with timestamp, algorithm, allowed/blocked status (color-coded), and retry-after if blocked.

### 4. Login brute-force scenario preset
A dedicated preset that simulates repeated failed login attempts against `/demo/login` (burst-then-trickle pattern), run side-by-side on both algorithms, to visually reproduce the RFC's core argument for why login uses sliding window.

### 5. Design decisions panel
A small collapsible sidebar or footer section that quotes/links the relevant parts of the RFC next to what's currently being visualized (e.g., when the login scenario is active, show the RFC excerpt about burst tolerance being an attack evasion risk).

## Deliverables

- `docker-compose.yml` bringing up backend, Redis, and frontend with one command
- `README.md`: project overview, what it demonstrates, how to run it, links to the RFC and to the specific design decisions it visualizes
- `docs/rfc-generic-rate-limiter.md` — I will provide this file, place it here unmodified
- Clean commit history if using git (logical commits: algorithms → engine → demo routes → SSE → frontend simulator → frontend visualizations → polish)

## Build Order (please follow this sequence)

1. Scaffold backend project structure, Docker Compose, Redis connection.
2. Implement and unit-test `token_bucket.py` and `sliding_window.py` in isolation — get these fully correct and tested before touching FastAPI.
3. Build the generic engine + FastAPI dependency wrapping them, driven by `rules.yaml`.
4. Build the demo/simulation endpoints and the SSE stream.
5. Scaffold the React frontend, get the traffic simulator firing requests against one algorithm with a basic log view.
6. Add the live visualizations (bucket gauge, sliding window timeline) driven by the SSE stream.
7. Add side-by-side mode and the login brute-force preset.
8. Polish: README, design decisions panel, styling pass.

Confirm you've read the RFC and understood the algorithm decision matrix (§5.1) before starting — ask me if anything in the RFC is ambiguous before you begin implementation, rather than guessing.
