from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from PIL import Image


class TryOnProvider(ABC):
    @abstractmethod
    def generate(
        self,
        person_path: Path,
        garment_path: Path,
        category: str,
    ) -> Image.Image:
        raise NotImplementedError
