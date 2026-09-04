const API_BASE = import.meta.env.VITE_TRYON_API_BASE ?? "http://localhost:8000";

async function assetToFile(assetUrl, filename) {
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error("无法读取衣物图片。");
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

export async function runTryOn({ personFile, clothing, signal }) {
  if (!clothing?.tryOnType) {
    throw new Error("当前模型适配器不支持这个衣物类别。");
  }

  const garmentFile = await assetToFile(clothing.image, `${clothing.id}.png`);

  const form = new FormData();
  form.append("person", personFile);
  form.append("garment", garmentFile);
  form.append("category", clothing.tryOnType);

  const response = await fetch(`${API_BASE}/api/try-on`, {
    method: "POST",
    body: form,
    signal
  });

  if (!response.ok) {
    let message = `AI 试穿失败：${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }

  return response.blob();
}
