import asyncio
import json
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()


class EventBroker:
    def __init__(self): self.listeners: set[asyncio.Queue] = set()
    async def publish(self, event: dict):
        for listener in list(self.listeners):
            if listener.full(): listener.get_nowait()
            listener.put_nowait(event)
    async def events(self):
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self.listeners.add(queue)
        try:
            while True:
                try: yield f"data: {json.dumps(await asyncio.wait_for(queue.get(), 15))}\n\n"
                except asyncio.TimeoutError: yield ": keepalive\n\n"
        finally: self.listeners.discard(queue)


@router.get("/demo/stream")
async def stream(request: Request):
    return StreamingResponse(request.app.state.events.events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
