import asyncio
import logging
from fastapi import HTTPException, Request
from ..algorithms.sliding_window import SlidingWindow
from ..algorithms.token_bucket import TokenBucket
from ..algorithms.models import RateLimitResult
from .config import Rule
from .resolvers import resolve_account, resolve_ip

log = logging.getLogger(__name__)


class RateLimitEngine:
    """Config-driven facade. Redis errors intentionally fail open per RFC §7."""
    def __init__(self, redis, default_rules: list[Rule], route_rules: dict[str, list[Rule]]):
        self.redis, self.default_rules, self.route_rules = redis, default_rules, route_rules

    def rules_for(self, route: str) -> list[Rule]:
        return self.route_rules.get(route, self.default_rules)

    async def check(self, request: Request, rule: Rule, algorithm_override: str | None = None) -> RateLimitResult:
        key = await ({"ip": resolve_ip, "account": resolve_account}[rule.key])(request)
        algorithm = algorithm_override or rule.algorithm
        try:
            if algorithm == "token_bucket":
                capacity = rule.capacity or rule.limit or 10
                rate = rule.refill_rate or capacity / (rule.window_seconds or 60)
                return await TokenBucket(self.redis, capacity, rate, prefix=f"rl:{algorithm}:{rule.key}").check(key)
            return await SlidingWindow(self.redis, rule.limit or rule.capacity or 10, rule.window_seconds or 60,
                                       prefix=f"rl:{algorithm}:{rule.key}").check(key)
        except (asyncio.TimeoutError, OSError, ConnectionError) as error:
            log.warning("rate limiter fail-open: %s", error)
            return RateLimitResult(True, -1, 0, {"degraded": True})


def rate_limit(route: str):
    """FastAPI dependency for ordinary `count: all` rules."""
    async def dependency(request: Request):
        engine: RateLimitEngine = request.app.state.limiter
        for rule in engine.rules_for(route):
            if rule.count != "all":
                continue
            result = await engine.check(request, rule)
            if not result.allowed:
                seconds = max(1, int(result.retry_after + 0.999))
                raise HTTPException(429, detail={"error": "rate_limited", "message": f"Too many requests. Try again in {seconds} seconds.", "retry_after_seconds": seconds}, headers={"Retry-After": str(seconds)})
    return dependency
