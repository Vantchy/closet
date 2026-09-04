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

/**
 * 去除图片背景，返回透明 PNG Blob。
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

  const result = await engine(blob, config);
  return result;
}
