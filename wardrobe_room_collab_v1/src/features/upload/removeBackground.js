// 衣物图片去背景：基于 @imgly/background-removal 的浏览器端 AI 分割。
// 懒加载——只在首次调用时 import 库，避免影响首屏。
// 处理后返回带透明通道的 PNG Blob；失败时抛错，由调用方决定是否降级用原图。

let lazy = null;

function loadEngine() {
  if (!lazy) {
    // 动态 import，让 Vite 单独分包，不阻塞主入口
    lazy = import("@imgly/background-removal").then(
      mod => mod.default || mod.removeBackground || mod
    );
  }
  return lazy;
}

/**
 * 去除图片背景，返回透明 PNG Blob。
 * @param {Blob} blob 原始图片
 * @param {(stage:string, progress:number)=>void} [onProgress] 进度回调
 * @returns {Promise<Blob>}
 */
export async function removeBackground(blob, onProgress) {
  const engine = await loadEngine();
  const result = await engine(blob, {
    output: { format: "image/png", quality: 0.9 },
    progress: (key, current) => {
      if (typeof onProgress === "function") onProgress(key, current);
    }
  });
  return result;
}
