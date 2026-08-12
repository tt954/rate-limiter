import asyncio
import pytest
import pytest_asyncio
import fakeredis.aioredis
from app.algorithms.token_bucket import TokenBucket
from app.algorithms.sliding_window import SlidingWindow


@pytest_asyncio.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest.mark.asyncio
async def test_token_bucket_allows_capacity_then_throttles(redis):
    bucket = TokenBucket(redis, capacity=3, refill_rate=100)
    assert [((await bucket.check("a")).allowed) for _ in range(3)] == [True, True, True]
    blocked = await bucket.check("a")
    assert not blocked.allowed and blocked.retry_after > 0
    await asyncio.sleep(.02)
    assert (await bucket.check("a")).allowed


@pytest.mark.asyncio
async def test_sliding_window_hard_cap(redis):
    window = SlidingWindow(redis, limit=3, window_seconds=10)
    assert [((await window.check("a")).allowed) for _ in range(3)] == [True, True, True]
    result = await window.check("a")
    assert not result.allowed and result.remaining == 0


@pytest.mark.asyncio
async def test_burst_then_trickle_token_bucket_vs_sliding(redis):
    token = TokenBucket(redis, capacity=5, refill_rate=100)
    sliding = SlidingWindow(redis, limit=5, window_seconds=10)
    for _ in range(5):
        assert (await token.check("same")).allowed
        assert (await sliding.check("same")).allowed
    await asyncio.sleep(.02)  # tokens refill; sliding window still contains the burst
    assert (await token.check("same")).allowed
    assert not (await sliding.check("same")).allowed
