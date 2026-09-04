import { addCustomItem, canAddCustomItem } from "./customItems.js";
import { removeBackground } from "./removeBackground.js";
import { applyExifOrientation, applyClothingHeuristic } from "./autoOrientImage.js";

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

  input.addEventListener("change", async () => {
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

    // 方向校正（两段式）：
    //  1) 去背景前先应用 EXIF 方向（手机/相机最常见，canvas 会丢 EXIF，必须先做）
    //  2) 去背景后再用衣物几何启发式判别是否上下/左右颠倒（此时前景已孤立，准确率显著更高）
    let oriented = file;
    try {
      oriented = await applyExifOrientation(file);
    } catch (err) {
      console.warn("EXIF 方向校正失败，继续使用原图：", err);
    }

    // 去背景：AI 分割前景衣物，失败时降级用校正后的原图（不让用户卡住）
    showHint("正在去除背景，首次需加载模型…");
    let finalBlob = oriented;
    let usedHeuristic = false;
    try {
      let cutBlob = await removeBackground(oriented, (key, current) => {
        if (key === "compute:inference" && current < 1) {
          showHint("正在识别衣物轮廓…");
        }
      });
      // 2) 前景已孤立 → 几何启发式判断是否需要进一步旋转
      cutBlob = await applyClothingHeuristic(cutBlob, category);
      usedHeuristic = true;
      finalBlob = cutBlob;
    } catch (err) {
      console.warn("背景移除失败，使用 EXIF 校正后的原图：", err);
      showHint("背景移除失败，已使用方向校正后的原图。");
    }
    addCustomItem(category, {
      name: file.name.replace(/\.[^.]+$/, ""),
      url: URL.createObjectURL(finalBlob)
    });
  });
}
