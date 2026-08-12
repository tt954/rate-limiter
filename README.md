# Rate Limiter Lab

An interactive FastAPI, Redis, and React demonstration of the RFC's two algorithms:

- **Token bucket** for burst-tolerant, general API traffic.
- **Sliding window** for strict login and enumeration protection.

The UI sends real requests, consumes the Redis-backed limiters atomically, and receives every decision over Server-Sent Events. Select a scenario, run both algorithms side-by-side, or enable the login brute-force preset to see why the RFC chooses a strict sliding window there.

## Run it

```bash
docker compose up --build
```

Open http://localhost:5173. The API is at http://localhost:8000 and its health endpoint is `/health`.

## Test algorithms

```bash
cd backend
python -m pip install -r requirements.txt
pytest
```

The focused tests cover token-bucket bursts/refills, sliding-window hard caps, and the RFC's burst-then-trickle comparison.

## Project map

- [`docs/rfc-generic-rate-limiter.md`](docs/rfc-generic-rate-limiter.md) — supplied RFC and design decisions.
- `backend/app/algorithms/` — standalone atomic Redis algorithms.
- `backend/app/engine/` — config loader, key resolvers, and reusable FastAPI dependency.
- `backend/app/config/rules.yaml` — declarative Phase 1 + Phase 2 demo rules.
- `backend/app/routes/` — traffic/login simulation APIs and SSE stream.
