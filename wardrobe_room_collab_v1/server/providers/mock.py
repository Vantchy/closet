from pathlib import Path
from PIL import Image, ImageDraw

from .base import TryOnProvider


class MockTryOnProvider(TryOnProvider):
    # End-to-end integration provider that does not require a GPU.
    def generate(self, person_path: Path, garment_path: Path, category: str) -> Image.Image:
        image = Image.open(person_path).convert("RGB")
        preview = image.copy()

        draw = ImageDraw.Draw(preview)
        label = f"MOCK TRY-ON · {category}"
        margin = max(12, preview.width // 60)

        draw.rounded_rectangle(
            (margin, margin, min(preview.width - margin, margin + 320), margin + 52),
            radius=12,
            fill=(255, 255, 255),
            outline=(120, 100, 90),
            width=2,
        )
        draw.text((margin + 14, margin + 16), label, fill=(70, 55, 45))
        return preview
