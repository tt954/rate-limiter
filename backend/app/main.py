from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from .engine.config import load_rules
from .engine.limiter import RateLimitEngine
from .routes.demo import router as demo_router
from .routes.stream import EventBroker, router as stream_router
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True, socket_connect_timeout=.02)
    default, routes = load_rules(Path(__file__).parent / "config/rules.yaml")
    app.state.limiter, app.state.events = RateLimitEngine(redis, default, routes), EventBroker()
    yield
    await redis.aclose()


app = FastAPI(title="Rate Limiter Lab", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
app.include_router(demo_router)
app.include_router(stream_router)


@app.get("/health")
async def health(): return {"ok": True}
