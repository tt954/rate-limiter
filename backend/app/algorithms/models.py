from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: float
    algorithm_state: dict[str, Any]
