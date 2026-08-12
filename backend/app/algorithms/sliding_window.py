"""Strict trailing sliding window using short-lived Redis time buckets.

One-second buckets make the trailing boundary exact at the UI's resolution while
retaining the RFC's bucketed-Redis-key strategy and automatic TTL cleanup.
"""
from time import time
from redis.asyncio import Redis
from .models import RateLimitResult


SLIDING_WINDOW_LUA = """
local count = 0
for i = 1, #KEYS do count = count + (tonumber(redis.call('GET', KEYS[i])) or 0) end
local limit = tonumber(ARGV[1])
local allowed = count < limit
if allowed then
  redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  count = count + 1
end
return {allowed and 1 or 0, count}
"""


class SlidingWindow:
    def __init__(self, redis: Redis, limit: int, window_seconds: int, prefix: str = "rl:window"):
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("limit and window_seconds must be positive")
        self.redis, self.limit, self.window_seconds, self.prefix = redis, limit, window_seconds, prefix

    async def check(self, key: str) -> RateLimitResult:
        now = time()
        current = int(now)
        buckets = list(range(current - self.window_seconds + 1, current + 1))
        redis_keys = [f"{self.prefix}:{key}:{bucket}" for bucket in reversed(buckets)]
        allowed, count = await self.redis.eval(
            SLIDING_WINDOW_LUA, len(redis_keys), *redis_keys, self.limit, self.window_seconds + 1
        )
        oldest = current - self.window_seconds + 1
        retry_after = max(0.0, float(oldest + self.window_seconds - now)) if not allowed else 0.0
        return RateLimitResult(
            bool(allowed), max(0, self.limit - int(count)), retry_after,
            {"limit": self.limit, "count": int(count), "window_seconds": self.window_seconds,
             "window_start": oldest, "window_end": current},
        )
