from datetime import datetime, timezone
from fastapi import APIRouter, Request
from pydantic import BaseModel
from ..algorithms.models import RateLimitResult

router = APIRouter()


class Login(BaseModel):
    username: str
    password: str


async def apply(request: Request, route: str, algorithm: str | None, count: str = "all") -> tuple[RateLimitResult | None, str | None]:
    engine = request.app.state.limiter
    latest, latest_algorithm = None, None
    for rule in engine.rules_for(route):
        if rule.count != count:
            continue
        result = await engine.check(request, rule, algorithm)
        latest, latest_algorithm = result, algorithm or rule.algorithm
        if not result.allowed:
            return result, latest_algorithm
    return latest, latest_algorithm


async def record(request: Request, algorithm: str, key: str, result: RateLimitResult):
    await request.app.state.events.publish({
        "timestamp": datetime.now(timezone.utc).isoformat(), "algorithm": algorithm, "key": key,
        "allowed": result.allowed, "remaining": result.remaining, "retry_after": result.retry_after,
        "algorithm_state": result.algorithm_state,
    })


def limited(result: RateLimitResult):
    seconds = max(1, int(result.retry_after + .999))
    return {"error": "rate_limited", "message": f"Too many requests. Try again in {seconds} seconds.", "retry_after_seconds": seconds}, seconds


@router.post("/demo/reset")
async def reset_demo(request: Request):
    """Demo-only reset: remove only this app's rate-limiter state from Redis."""
    redis = request.app.state.limiter.redis
    keys = [key async for key in redis.scan_iter(match="rl:*")]
    if keys:
        await redis.delete(*keys)
    return {"ok": True, "deleted_keys": len(keys)}


@router.post("/demo/traffic")
async def traffic(request: Request, algorithm: str | None = None):
    # This algorithm override is demo-only scaffolding; production uses fixed config rules.
    if algorithm not in {None, "token_bucket", "sliding_window"}:
        return {"error": "invalid_algorithm"}
    result, used = await apply(request, "/demo/traffic", algorithm)
    if result and not result.allowed:
        await record(request, used, "ip", result)
        body, seconds = limited(result)
        from fastapi.responses import JSONResponse
        return JSONResponse(body, 429, headers={"Retry-After": str(seconds)})
    await record(request, used, "ip", result)
    return {"ok": True}


@router.post("/demo/login")
async def login(payload: Login, request: Request, algorithm: str | None = None):
    if algorithm not in {None, "token_bucket", "sliding_window"}:
        return {"error": "invalid_algorithm"}
    request.state.rate_limit_account = payload.username.strip().lower()
    ip_result, used = await apply(request, "/demo/login", algorithm, "all")
    if ip_result and not ip_result.allowed:
        await record(request, used, "ip", ip_result)
        body, seconds = limited(ip_result)
        from fastapi.responses import JSONResponse
        return JSONResponse(body, 429, headers={"Retry-After": str(seconds)})
    success = payload.password == "correct"
    account_result = None
    if not success:
        account_result, used = await apply(request, "/demo/login", algorithm, "failures_only")
        if account_result and not account_result.allowed:
            await record(request, used, "account", account_result)
            body, seconds = limited(account_result)
            from fastapi.responses import JSONResponse
            return JSONResponse(body, 429, headers={"Retry-After": str(seconds)})
    await record(request, used or algorithm or "sliding_window", "account", account_result or ip_result)
    return {"ok": success, "message": "logged in" if success else "invalid credentials"}
