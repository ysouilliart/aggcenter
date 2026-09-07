"""Pydantic models for the aggregation center API."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SourceIn(BaseModel):
    """Payload used when registering a new source."""

    name: str = Field(..., min_length=1, max_length=100)
    category: str = Field(default="general", min_length=1, max_length=50)
    value: float = Field(default=0.0)


class Source(SourceIn):
    """A registered source tracked by the aggregation center."""

    id: int
    updated_at: datetime = Field(default_factory=_utc_now)


class CategorySummary(BaseModel):
    category: str
    count: int
    total: float
    average: float


class Aggregate(BaseModel):
    """Aggregated view across all registered sources."""

    source_count: int
    total_value: float
    average_value: float
    categories: list[CategorySummary]
    generated_at: datetime = Field(default_factory=_utc_now)
