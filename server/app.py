from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .providers.base import TryOnProvider
from .providers.mock import MockTryOnProvider


def build_provider() -> TryOnProvider:
    provider_name = os.environ.get("TRYON_PROVIDER", "mock").lower()

    if provider_name == "mock":
        return MockTryOnProvider()

    if provider_name == "catvton":
        from .providers.catvton import CatVTONProvider
        return CatVTONProvider()

    raise RuntimeError(f"Unknown TRYON_PROVIDER={provider_name}")


provider = build_provider()

app = FastAPI(title="Wardrobe Try-On API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "provider": provider.__class__.__name__,
    }


@app.post("/api/try-on")
async def try_on(
    person: UploadFile = File(...),
    garment: UploadFile = File(...),
    category: str = Form(...),
):
    if category not in {"upper", "lower", "overall"}:
        raise HTTPException(
            status_code=400,
            detail="category must be upper, lower, or overall",
        )

    allowed = {"image/jpeg", "image/png", "image/webp"}
    if person.content_type not in allowed or garment.content_type not in allowed:
        raise HTTPException(
            status_code=415,
            detail="Only JPG/PNG/WebP images are supported.",
        )

    with tempfile.TemporaryDirectory(prefix="wardrobe-tryon-") as temp_dir:
        temp = Path(temp_dir)
        person_path = temp / "person"
        garment_path = temp / "garment"

        person_path.write_bytes(await person.read())
        garment_path.write_bytes(await garment.read())

        try:
            result = provider.generate(person_path, garment_path, category)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        buffer = io.BytesIO()
        result.save(buffer, format="PNG")
        return Response(content=buffer.getvalue(), media_type="image/png")
