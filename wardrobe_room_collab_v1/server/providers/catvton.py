from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from PIL import Image

from .base import TryOnProvider


class CatVTONProvider(TryOnProvider):
    # Thin adapter around an EXTERNAL checkout of Zheng-Chong/CatVTON.
    # The upstream project is intentionally not vendored into this repository.
    def __init__(self) -> None:
        root = os.environ.get("CATVTON_ROOT")
        if not root:
            raise RuntimeError("CATVTON_ROOT is not set.")

        self.root = Path(root).expanduser().resolve()
        if not (self.root / "model").exists():
            raise RuntimeError(f"CATVTON_ROOT does not look valid: {self.root}")

        sys.path.insert(0, str(self.root))

        try:
            import torch
            from diffusers.image_processor import VaeImageProcessor
            from huggingface_hub import snapshot_download
            from model.cloth_masker import AutoMasker
            from model.pipeline import CatVTONPipeline
            from utils import init_weight_dtype, resize_and_crop, resize_and_padding
        except Exception as exc:
            raise RuntimeError(
                "CatVTON dependencies are unavailable. "
                "Install the requirements from the external CatVTON checkout."
            ) from exc

        self.torch = torch
        self.resize_and_crop = resize_and_crop
        self.resize_and_padding = resize_and_padding

        self.width = int(os.environ.get("CATVTON_WIDTH", "768"))
        self.height = int(os.environ.get("CATVTON_HEIGHT", "1024"))
        self.steps = int(os.environ.get("CATVTON_STEPS", "40"))
        self.guidance_scale = float(os.environ.get("CATVTON_CFG", "2.5"))
        self.device = os.environ.get("CATVTON_DEVICE", "cuda")
        precision = os.environ.get("CATVTON_PRECISION", "bf16")

        repo_path = snapshot_download(
            repo_id=os.environ.get("CATVTON_MODEL_REPO", "zhengchong/CatVTON")
        )

        self.pipeline = CatVTONPipeline(
            base_ckpt=os.environ.get(
                "CATVTON_BASE_MODEL",
                "booksforcharlie/stable-diffusion-inpainting",
            ),
            attn_ckpt=repo_path,
            attn_ckpt_version="mix",
            weight_dtype=init_weight_dtype(precision),
            use_tf32=os.environ.get("CATVTON_ALLOW_TF32", "1") == "1",
            device=self.device,
        )

        self.automasker = AutoMasker(
            densepose_ckpt=os.path.join(repo_path, "DensePose"),
            schp_ckpt=os.path.join(repo_path, "SCHP"),
            device=self.device,
        )

        self.mask_processor = VaeImageProcessor(
            vae_scale_factor=8,
            do_normalize=False,
            do_binarize=True,
            do_convert_grayscale=True,
        )

    def generate(
        self,
        person_path: Path,
        garment_path: Path,
        category: str,
    ) -> Image.Image:
        if category not in {"upper", "lower", "overall"}:
            raise ValueError(f"Unsupported CatVTON category: {category}")

        person = Image.open(person_path).convert("RGB")
        garment = Image.open(garment_path).convert("RGB")

        target_size = (self.width, self.height)
        person = self.resize_and_crop(person, target_size)
        garment = self.resize_and_padding(garment, target_size)

        mask = self.automasker(person, category)["mask"]
        mask = self.mask_processor.blur(mask, blur_factor=9)

        seed = int(os.environ.get("CATVTON_SEED", "42"))
        generator: Any = self.torch.Generator(device=self.device).manual_seed(seed)

        result = self.pipeline(
            image=person,
            condition_image=garment,
            mask=mask,
            num_inference_steps=self.steps,
            guidance_scale=self.guidance_scale,
            generator=generator,
        )[0]

        return result.convert("RGB")
