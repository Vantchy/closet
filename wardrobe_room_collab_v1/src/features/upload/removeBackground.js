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

// ================================================================
// 方案二：Mask 后处理管线（纯 Canvas 2D / Uint8Array，无外部依赖）
// 顺序：二值 mask → 形态学闭运算（膨胀→腐蚀，补小针孔/缝合线）
//      → 最大连通域（删背景角落杂物/噪点）→ 小空洞填充（补被模型挖错的织物针孔）
//      → 写回 alpha（严格不改 RGB）。
// ================================================================

// 以 alpha > threshold 为前景，生成 Uint8 二值 mask（0/1）
function buildMask(data, W, H, threshold) {
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; p < data.length; i += 1, p += 4) {
    if (data[p + 3] > threshold) mask[i] = 1;
  }
  return mask;
}

// 二值 mask 的 3x3 膨胀（8 邻域），输入输出不同数组避免就地错误
function dilate(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (mask[y * W + x]) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) out[ny * W + nx] = 1;
          }
        }
      }
    }
  }
  return out;
}

// 二值 mask 的 3x3 腐蚀（8 邻域全为 1 才保留）
function erode(mask, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || !mask[ny * W + nx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * W + x] = keep;
    }
  }
  return out;
}

// 闭运算 = 先膨胀再腐蚀：填补 1~2px 的小针孔/裂缝，主体外轮廓基本不变
function closeMask(mask, W, H) {
  return erode(dilate(mask, W, H), W, H);
}

// 4-连通域迭代 BFS（避免递归栈溢出），返回 { labelId -> pixelCount } 与 label 数组
function connectedComponents(mask, W, H) {
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  let nextId = 0;
  const stack = new Int32Array(W * H);
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = nextId++;
    let count = 0;
    let top = 0;
    stack[top++] = i;
    label[i] = id;
    while (top > 0) {
      const cur = stack[--top];
      count += 1;
      const x = cur % W;
      const y = (cur / W) | 0;
      // 四邻域
      if (x > 0 && mask[cur - 1] && label[cur - 1] === -1) { label[cur - 1] = id; stack[top++] = cur - 1; }
      if (x < W - 1 && mask[cur + 1] && label[cur + 1] === -1) { label[cur + 1] = id; stack[top++] = cur + 1; }
      if (y > 0 && mask[cur - W] && label[cur - W] === -1) { label[cur - W] = id; stack[top++] = cur - W; }
      if (y < H - 1 && mask[cur + W] && label[cur + W] === -1) { label[cur + W] = id; stack[top++] = cur + W; }
    }
    sizes[id] = count;
  }
  return { label, sizes };
}

// 只保留最大连通域，其余置 0（去掉背景里散落的噪点/小杂物块）
function keepLargestComponent(mask, W, H) {
  const { label, sizes } = connectedComponents(mask, W, H);
  if (sizes.length === 0) return mask;
  let bestId = 0;
  for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > sizes[bestId]) bestId = i;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i += 1) if (label[i] === bestId) out[i] = 1;
  return out;
}

// 从图像四周边界做背景 BFS，剩下没被访问到的背景像素就是“空洞”（被前景包围的内部透明区）。
// 只填面积 < HOLE_MAX_RATIO × 前景面积 的空洞（小针孔/织物纹理，领口大洞不填）。
function fillSmallHoles(mask, W, H, holeMaxRatio = 0.03) {
  const fgArea = mask.reduce((s, v) => s + (v ? 1 : 0), 0);
  if (fgArea === 0) return mask;
  const maxHole = Math.max(40, Math.round(fgArea * holeMaxRatio));

  const visited = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;
  // 把所有边界背景像素入栈
  for (let x = 0; x < W; x += 1) {
    for (const y of [0, H - 1]) {
      const i = y * W + x;
      if (!mask[i] && !visited[i]) { visited[i] = 1; stack[top++] = i; }
    }
  }
  for (let y = 0; y < H; y += 1) {
    for (const x of [0, W - 1]) {
      const i = y * W + x;
      if (!mask[i] && !visited[i]) { visited[i] = 1; stack[top++] = i; }
    }
  }
  while (top > 0) {
    const cur = stack[--top];
    const x = cur % W;
    const y = (cur / W) | 0;
    if (x > 0 && !mask[cur - 1] && !visited[cur - 1]) { visited[cur - 1] = 1; stack[top++] = cur - 1; }
    if (x < W - 1 && !mask[cur + 1] && !visited[cur + 1]) { visited[cur + 1] = 1; stack[top++] = cur + 1; }
    if (y > 0 && !mask[cur - W] && !visited[cur - W]) { visited[cur - W] = 1; stack[top++] = cur - W; }
    if (y < H - 1 && !mask[cur + W] && !visited[cur + W]) { visited[cur + W] = 1; stack[top++] = cur + W; }
  }

  // 对未访问的背景区（即空洞）再做连通域，面积 < maxHole 才填
  const holeLabel = new Int32Array(W * H).fill(-1);
  const holeSizes = [];
  let hid = 0;
  const hstack = new Int32Array(W * H);
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] || visited[i] || holeLabel[i] !== -1) continue;
    const id = hid++;
    let count = 0;
    let htop = 0;
    hstack[htop++] = i;
    holeLabel[i] = id;
    while (htop > 0) {
      const cur = hstack[--htop];
      count += 1;
      const x = cur % W;
      const y = (cur / W) | 0;
      if (x > 0 && !mask[cur - 1] && !visited[cur - 1] && holeLabel[cur - 1] === -1) { holeLabel[cur - 1] = id; hstack[htop++] = cur - 1; }
      if (x < W - 1 && !mask[cur + 1] && !visited[cur + 1] && holeLabel[cur + 1] === -1) { holeLabel[cur + 1] = id; hstack[htop++] = cur + 1; }
      if (y > 0 && !mask[cur - W] && !visited[cur - W] && holeLabel[cur - W] === -1) { holeLabel[cur - W] = id; hstack[htop++] = cur - W; }
      if (y < H - 1 && !mask[cur + W] && !visited[cur + W] && holeLabel[cur + W] === -1) { holeLabel[cur + W] = id; hstack[htop++] = cur + W; }
    }
    holeSizes[id] = count;
  }

  const out = new Uint8Array(mask);
  for (let i = 0; i < mask.length; i += 1) {
    if (holeLabel[i] !== -1 && holeSizes[holeLabel[i]] < maxHole) out[i] = 1;
  }
  return out;
}

// 把 mask 写回 RGBA 的 alpha 通道：
//   mask=0 → alpha=0（背景清零，RGB 不动——后续叠到角色上不会露出残影）
//   mask=1 且是“原前景” → 保留原 alpha（含羽化过渡带）
//   mask=1 且是“被填的洞” → alpha=255，RGB 用周围 8 邻域原前景像素均值（避免出现透明洞）
// 严格遵循：不改前景原像素的 RGB；只在新填洞的位置合成 RGB。
function applyMaskToRgba(imgData, mask, W, H, filledSet) {
  const data = imgData.data;
  const EDGE_LOW = 20;
  const EDGE_HIGH_FLOOR = 180;
  const EDGE_HIGH_CEIL = 220;

  for (let i = 0, p = 0; p < data.length; i += 1, p += 4) {
    if (!mask[i]) {
      data[p + 3] = 0;
      continue;
    }
    if (filledSet && filledSet[i]) {
      // 被填入的洞：取周围邻域原前景（alpha 较高的）像素平均 RGB，alpha 拉满
      let r = 0, g = 0, b = 0, cnt = 0;
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const np = (ny * W + nx) * 4;
          if (data[np + 3] > 128) {
            r += data[np]; g += data[np + 1]; b += data[np + 2]; cnt += 1;
          }
        }
      }
      if (cnt > 0) {
        data[p] = Math.round(r / cnt);
        data[p + 1] = Math.round(g / cnt);
        data[p + 2] = Math.round(b / cnt);
      }
      data[p + 3] = 255;
    } else {
      // 原前景：保留 RGB 不动，只对 alpha 做方案一的过渡带羽化
      const a = data[p + 3];
      if (a <= EDGE_LOW) data[p + 3] = 0;
      else if (a >= EDGE_HIGH_CEIL) data[p + 3] = 255;
      else if (a <= EDGE_HIGH_FLOOR) {
        const t = (a - EDGE_LOW) / (EDGE_HIGH_FLOOR - EDGE_LOW);
        data[p + 3] = Math.min(255, Math.max(0, Math.round(t * 255)));
      }
    }
  }
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

  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  // 两步阈值：TRIM_ALPHA 定 bbox，FAIL_ALPHA 统计真实前景
  const TRIM_ALPHA = 32;
  const FAIL_ALPHA = 16;
  let minX = W, minY = H, maxX = -1, maxY = -1, fgPixels = 0;
  const totalPixels = W * H;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const a = data[(y * W + x) * 4 + 3];
      if (a > FAIL_ALPHA) fgPixels += 1;
      if (a > TRIM_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const fgRatio = fgPixels / totalPixels;
  if (maxX < 0 || fgRatio < 0.01) {
    throw new Error(`抠图结果前景过少（${(fgRatio * 100).toFixed(2)}%）`);
  }

  const pad = Math.max(8, Math.round(0.03 * Math.max(maxX - minX, maxY - minY)));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = document.createElement("canvas");
  cropped.width = w;
  cropped.height = h;
  const cctx = cropped.getContext("2d", { willReadFrequently: true });
  cctx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);

  const cropImg = cctx.getImageData(0, 0, w, h);
  const cropData = cropImg.data;

  // —— 方案二：完整 mask 后处理管线 ——
  // 1) 从 alpha>32 建二值前景 mask
  // 2) 闭运算（膨胀→腐蚀）：补 1~2px 针孔/缝线/拉链缝隙，外轮廓基本不变
  // 3) 只保留最大连通域：背景角落散落的杂物/噪点整块消失
  // 4) 填小空洞：被前景包围、面积 <3% 的洞补上（织物纹理的小针孔）；领口大洞不填
  const rawMask = buildMask(cropData, w, h, TRIM_ALPHA);
  const closed = closeMask(rawMask, w, h);
  const largest = keepLargestComponent(closed, w, h);
  // 记录“哪些像素是被填上的洞”——写回时才需要合成 RGB
  const beforeHoles = new Uint8Array(largest);
  const filled = fillSmallHoles(largest, w, h, 0.03);
  const filledSet = new Uint8Array(w * h);
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] && !beforeHoles[i]) filledSet[i] = 1;
  }

  // 5) 把最终 mask 写回 alpha（保留原 RGB，填洞处用邻域均值合成）
  applyMaskToRgba(cropImg, filled, w, h, filledSet);
  cctx.putImageData(cropImg, 0, 0);

  return new Promise((resolve, reject) => {
    cropped.toBlob(result => {
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
  // —— 方案一：显式指定最大模型 + 最高输出质量 + 优先 GPU
  //   model: "isnet"（FP32 完整版，~80MB，精度最高一档，边缘细节比 fp16 再高 3~5%）。
  //   output.quality: 1，避免压缩损失边缘高频细节（拉链、缝线、蕾丝）。
  //   device: 'gpu'，走 WebGPU/WebGL 加速，推理速度更快且大模型不卡顿。
  //   progress：库传 (key, current, total) 三元组，归一化后回调给上层 UI。
  const config = {
    model: "isnet",
    device: "gpu",
    output: { format: "image/png", quality: 1 },
    progress: (key, current, total) => {
      if (typeof onProgress !== "function") return;
      const normalized =
        typeof total === "number" && total > 0 ? current / total : current;
      onProgress(key, normalized);
    }
  };
  if (publicPath) config.publicPath = publicPath;

  const cut = await engine(blob, config);
  return trimToForeground(cut);
}
