// 衣物图片去背景：基于 @imgly/background-removal 的浏览器端 AI 分割。
// 懒加载——只在首次调用时 import 库，避免影响首屏。
// 模型文件优先使用本地 public/models/bg-removal/（由 scripts/download-bg-models.ps1 下载），
// 本地不可用时回退到官方 CDN，保证开箱即用。
// 处理后返回带透明通道的 PNG Blob；失败时抛错，由调用方决定是否降级用原图。

const LOCAL_PUBLIC_PATH = "/models/bg-removal/";

let lazy = null;
let publicPathPromise = null;

function loadEngine() {
  if (!lazy) {
    // 动态 import，让 Vite 单独分包，不阻塞主入口
    lazy = import("@imgly/background-removal").then(
      mod => mod.default || mod.removeBackground || mod
    );
  }
  return lazy;
}

// 探测本地模型资源是否就绪；未就绪则返回 null（库将使用默认 CDN）
function resolvePublicPath() {
  if (!publicPathPromise) {
    publicPathPromise = fetch(`${LOCAL_PUBLIC_PATH}resources.json`, { method: "HEAD" })
      .then(res => {
        if (!res.ok) return null;
        // 库内部用 new URL(chunk, publicPath) 拼接，必须是绝对 URL
        return new URL(LOCAL_PUBLIC_PATH, window.location.href).toString();
      })
      .catch(() => null);
  }
  return publicPathPromise;
}

// 透明背景图若只在中间一小块是衣服、四周大片透明，
// 放进固定尺寸的衣物格/角色穿戴层（衣物素材本身都是“衣服铺满整幅”）时会显得极小、错位，
// 看似“衣服被去掉”。这里按不透明像素的包围盒裁紧，让衣服像内置素材一样铺满画面。
async function trimToForeground(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // 用“实心前景”（高 alpha）确定包围盒，忽略模型边缘的半透明残影/阴影，
  // 否则贴边裁切会被低 alpha 晕影撑大、衣服反而变小。
  const FOREGROUND_ALPHA = 128;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > FOREGROUND_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // 抠不出任何前景：视为失败，交由调用方回退原图（绝不让衣服凭空消失）
  if (maxX < 0) throw new Error("抠图结果为空");

  const pad = Math.max(4, Math.round(0.02 * Math.max(maxX - minX, maxY - minY)));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(canvas.width - 1, maxX + pad);
  maxY = Math.min(canvas.height - 1, maxY + pad);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    out.toBlob(result => {
      if (result) resolve(result);
      else reject(new Error("裁切结果导出失败"));
    }, "image/png");
  });
}

/**
 * 去除图片背景并裁紧到衣物范围，返回透明 PNG Blob。
 * 抠图为空时抛错，由调用方决定是否回退原图。
 * @param {Blob} blob 原始图片
 * @param {(stage:string, progress:number)=>void} [onProgress] 进度回调
 * @returns {Promise<Blob>}
 */
export async function removeBackground(blob, onProgress) {
  const [engine, publicPath] = await Promise.all([loadEngine(), resolvePublicPath()]);
  const config = {
    output: { format: "image/png", quality: 0.9 },
    progress: (key, current) => {
      if (typeof onProgress === "function") onProgress(key, current);
    }
  };
  if (publicPath) config.publicPath = publicPath;

  const cut = await engine(blob, config);
  return trimToForeground(cut);
}
