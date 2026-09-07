"""In-memory aggregation logic for the aggregation center.

The store is intentionally simple (in-memory) so the service runs with no
external dependencies. Replace :class:`SourceStore` with a database-backed
implementation when persistence is needed.
"""

from __future__ import annotations

from collections import defaultdict
from threading import Lock

from .models import Aggregate, CategorySummary, Source, SourceIn


class SourceStore:
    """Thread-safe in-memory collection of sources."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._sources: dict[int, Source] = {}
        self._next_id = 1

    def add(self, payload: SourceIn) -> Source:
        with self._lock:
            source = Source(id=self._next_id, **payload.model_dump())
            self._sources[source.id] = source
            self._next_id += 1
            return source

    def list(self) -> list[Source]:
        with self._lock:
            return sorted(self._sources.values(), key=lambda s: s.id)

    def get(self, source_id: int) -> Source | None:
        with self._lock:
            return self._sources.get(source_id)

    def clear(self) -> None:
        with self._lock:
            self._sources.clear()
            self._next_id = 1

    def aggregate(self) -> Aggregate:
        sources = self.list()
        total = sum(s.value for s in sources)
        count = len(sources)

        buckets: dict[str, list[float]] = defaultdict(list)
        for source in sources:
            buckets[source.category].append(source.value)

        categories = [
            CategorySummary(
                category=category,
                count=len(values),
                total=sum(values),
                average=sum(values) / len(values) if values else 0.0,
            )
            for category, values in sorted(buckets.items())
        ]

        return Aggregate(
            source_count=count,
            total_value=total,
            average_value=total / count if count else 0.0,
            categories=categories,
        )


def seed_store(store: SourceStore) -> None:
    """Populate the store with a few illustrative sources."""

    samples = [
        SourceIn(name="web-analytics", category="traffic", value=1280.0),
        SourceIn(name="mobile-analytics", category="traffic", value=845.0),
        SourceIn(name="checkout-service", category="revenue", value=5230.5),
        SourceIn(name="subscriptions", category="revenue", value=9120.0),
        SourceIn(name="error-monitor", category="reliability", value=12.0),
    ]
    for sample in samples:
        store.add(sample)
