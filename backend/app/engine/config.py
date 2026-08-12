from dataclasses import dataclass
from pathlib import Path
from typing import Any
import yaml


@dataclass(frozen=True)
class Rule:
    key: str
    algorithm: str
    count: str = "all"
    capacity: int | None = None
    refill_rate: float | None = None
    limit: int | None = None
    window_seconds: int | None = None


def _rule(raw: dict[str, Any]) -> Rule:
    rule = Rule(**raw)
    if rule.key not in {"ip", "account"} or rule.algorithm not in {"token_bucket", "sliding_window"}:
        raise ValueError("unknown key resolver or algorithm")
    if rule.count not in {"all", "failures_only", "success_only"}:
        raise ValueError("invalid count policy")
    if rule.algorithm == "token_bucket" and (not rule.capacity or not rule.refill_rate or rule.capacity <= 0 or rule.refill_rate <= 0):
        raise ValueError("token bucket requires positive capacity and refill_rate")
    if rule.algorithm == "sliding_window" and (not rule.limit or not rule.window_seconds or rule.limit <= 0 or rule.window_seconds <= 0):
        raise ValueError("sliding window requires positive limit and window_seconds")
    return rule


def load_rules(path: str | Path) -> tuple[list[Rule], dict[str, list[Rule]]]:
    raw = yaml.safe_load(Path(path).read_text())["rate_limits"]
    return ([_rule(x) for x in raw.get("default", [])],
            {route: [_rule(x) for x in rules] for route, rules in raw.get("routes", {}).items()})
