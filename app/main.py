"""FastAPI application for the aggregation center (aggcenter)."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .aggregator import SourceStore, seed_store
from .models import Aggregate, Source, SourceIn

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="aggcenter",
    description="A small aggregation center that collects sources and reports aggregated metrics.",
    version=__version__,
)

store = SourceStore()
seed_store(store)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/api/sources", response_model=list[Source])
def list_sources() -> list[Source]:
    return store.list()


@app.post("/api/sources", response_model=Source, status_code=201)
def create_source(payload: SourceIn) -> Source:
    return store.add(payload)


@app.get("/api/sources/{source_id}", response_model=Source)
def get_source(source_id: int) -> Source:
    source = store.get(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@app.get("/api/aggregate", response_model=Aggregate)
def aggregate() -> Aggregate:
    return store.aggregate()


@app.get("/")
def dashboard() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
