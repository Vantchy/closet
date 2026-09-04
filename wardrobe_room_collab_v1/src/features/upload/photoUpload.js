import { addCustomItem, canAddCustomItem } from "./customItems.js";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// 衣物照片上传：由衣物格“＋”触发（wardrobeController 派发 upload:request 事件），
// 选择成功后图片注册为该分类的自定义衣物，占据“＋”所在格子。
export function mountPhotoUpload(store) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.hidden = true;
  document.body.appendChild(input);

  let pendingCategory = null;
  let hintTimer = null;

  function showHint(message) {
    const hint = document.querySelector(".hint");
    if (!hint) return;

    hint.textContent = message;
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.classList.remove("is-visible");
      hint.textContent = "点击左侧衣柜查看";
    }, 2600);
  }

  window.addEventListener("upload:request", event => {
    pendingCategory = event.detail?.category ?? null;
    if (!pendingCategory) return;
    input.click();
  });

  window.addEventListener("upload:rejected", event => {
    if (event.detail?.message) showHint(event.detail.message);
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !pendingCategory) return;

    const category = pendingCategory;
    pendingCategory = null;

    if (!ALLOWED_TYPES.has(file.type)) {
      window.dispatchEvent(
        new CustomEvent("upload:rejected", {
          detail: { category, message: "请选择 JPG、PNG 或 WebP 图片。" }
        })
      );
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      window.dispatchEvent(
        new CustomEvent("upload:rejected", {
          detail: { category, message: "图片不能超过 12 MB。" }
        })
      );
      return;
    }

    if (!canAddCustomItem(category)) {
      window.dispatchEvent(
        new CustomEvent("upload:rejected", {
          detail: { category, message: "这个分类的衣物格已满。" }
        })
      );
      return;
    }

    addCustomItem(category, {
      name: file.name.replace(/\.[^.]+$/, ""),
      url: URL.createObjectURL(file)
    });
  });
}
