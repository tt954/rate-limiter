from fastapi import Request


async def resolve_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip()


async def resolve_account(request: Request) -> str:
    # Demo routes place the normalized username here after validating their body.
    return getattr(request.state, "rate_limit_account", "anonymous")
