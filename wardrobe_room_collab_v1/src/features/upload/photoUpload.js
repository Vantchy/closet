const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function mountPhotoUpload(store) {
  const input = document.getElementById("photoInput");
  const selectButton = document.getElementById("photoSelectBtn");
  const clearButton = document.getElementById("photoClearBtn");
  const preview = document.getElementById("photoPreview");
  const status = document.getElementById("photoStatus");

  let activeObjectUrl = null;

  function revokePreview() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  }

  function clearPhoto() {
    revokePreview();
    input.value = "";
    preview.removeAttribute("src");
    preview.classList.remove("is-visible");
    clearButton.disabled = true;
    status.textContent = "照片已清除。";

    store.setState(current => ({
      ...current,
      photo: { file: null, url: null, name: null }
    }));
  }

  selectButton.addEventListener("click", () => input.click());
  clearButton.addEventListener("click", clearPhoto);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.has(file.type)) {
      status.textContent = "请选择 JPG、PNG 或 WebP 图片。";
      input.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      status.textContent = "图片不能超过 12 MB。";
      input.value = "";
      return;
    }

    revokePreview();
    activeObjectUrl = URL.createObjectURL(file);
    preview.src = activeObjectUrl;
    preview.classList.add("is-visible");
    clearButton.disabled = false;
    status.textContent = `已选择：${file.name}`;

    store.setState(current => ({
      ...current,
      photo: { file, url: activeObjectUrl, name: file.name }
    }));
  });
}
