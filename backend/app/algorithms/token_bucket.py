"""Atomic Redis token bucket implementation."""
from time import time
from redis.asyncio import Redis
from .models import RateLimitResult


TOKEN_BUCKET_LUA = """
local raw_tokens = redis.call('HGET', KEYS[1], 'tokens')
local raw_updated = redis.call('HGET', KEYS[1], 'updated_at')
local tokens = tonumber(raw_tokens) or tonumber(ARGV[1])
local updated_at = tonumber(raw_updated) or tonumber(ARGV[3])
local now = tonumber(ARGV[3])
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_rate)
local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('EXPIRE', KEYS[1], math.max(1, math.ceil(capacity / refill_rate) * 2))
local retry_after = 0
if not allowed then retry_after = (1 - tokens) / refill_rate end
return {allowed and 1 or 0, tostring(tokens), tostring(retry_after)}
"""


class TokenBucket:
    def __init__(self, redis: Redis, capacity: int, refill_rate: float, prefix: str = "rl:token"):
        if capacity <= 0 or refill_rate <= 0:
            raise ValueError("capacity and refill_rate must be positive")
        self.redis, self.capacity, self.refill_rate, self.prefix = redis, capacity, refill_rate, prefix

    async def check(self, key: str) -> RateLimitResult:
        now = time()
        allowed, tokens, retry_after = await self.redis.eval(
            TOKEN_BUCKET_LUA, 1, f"{self.prefix}:{key}", self.capacity, self.refill_rate, now
        )
        tokens, retry_after = float(tokens), float(retry_after)
        return RateLimitResult(
            bool(allowed), max(0, int(tokens)), retry_after,
            {"capacity": self.capacity, "tokens": round(tokens, 2), "refill_rate": self.refill_rate},
        )
