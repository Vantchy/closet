// 衣物图片去背景。
// 方案三：服装专用分割模型 u2net_cloth_seg（clothSegment.js）优先，专门识别
//   上装/下装/连体装轮廓，对领口/袖口/褶皱的边界精度高于通用前景分割；
//   不支持的分类（hat）或服装模型加载/推理失败时，回退 @imgly/background-removal
//   的通用 ISNet 模型（模型文件在 public/models/bg-removal/，缺失时回退官方 CDN）。
// 两条路输出均为带透明通道的 PNG Blob，统一走 trimToForeground 的方案二 mask 后处理。
// 所有库/模型均懒加载，避免影响首屏；失败时抛错，由调用方决定是否降级用原图。

import { segmentCloth } from "./clothSegment.js";

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
//      → 写回：背景 RGB 抹白、alpha≈0（透明且下游丢 alpha 时仍是白底），
//        边缘羽化带做背景色反混合去光晕，前景 RGB 不动。
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

// 闭运算 = 先膨胀再腐蚀：填补小针孔/裂缝，主体外轮廓基本不变
// iters=2 时可闭合 2~3px 的缝隙（模型分割在袖子/裤腿边缘偶发的断裂）
function closeMask(mask, W, H, iters = 1) {
  let cur = mask;
  for (let i = 0; i < iters; i += 1) cur = dilate(cur, W, H);
  for (let i = 0; i < iters; i += 1) cur = erode(cur, W, H);
  return cur;
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

// 保留“最大连通域 + 面积达到最大块 12% 的大块”，其余置 0：
// 去掉背景散落噪点/小杂物；同时保住同一件衣服被分割成多块的情况
// （典型：裤子两条裤腿在腰口以下互不相连，只留最大块会只剩一条裤腿）。
function keepMajorComponents(mask, W, H) {
  const { label, sizes } = connectedComponents(mask, W, H);
  if (sizes.length === 0) return mask;
  let largest = 0;
  for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > largest) largest = sizes[i];
  const minKeep = Math.max(40, Math.round(largest * 0.12));
  const keep = new Set();
  sizes.forEach((sz, id) => { if (sz >= minKeep) keep.add(id); });
  const out = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i += 1) if (keep.has(label[i])) out[i] = 1;
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

// 把 mask 写回 RGBA：
//   mask=0（背景）→ alpha=1（视觉透明，且 RGB 能在 canvas 预乘存储中存活），
//     RGB 置纯白：透明通道供衣柜叠加；背景在 RGB 上也被真正抹掉——
//     AI 试穿服务端 convert("RGB") 会丢弃 alpha，白底也与 CatVTON
//     训练用的白底电商服装图一致。
//   mask=1 且是“原前景” → 保留前景 RGB；对羽化过渡带做背景色反混合
//     （C = a·F + (1-a)·B → F = (C-(1-a)·B)/a），消除边缘残留的背景色光晕/白边。
//   mask=1 且是“被填的洞” → alpha=255，RGB 用周围 8 邻域原前景像素均值（避免出现透明洞）
function applyMaskToRgba(imgData, mask, W, H, filledSet, bgRGB) {
  const bg = bgRGB || { r: 255, g: 255, b: 255 };
  const data = imgData.data;
  const EDGE_LOW = 20;
  const EDGE_HIGH_FLOOR = 180;
  const EDGE_HIGH_CEIL = 220;
  // 背景像素 alpha 不设 0 而设 1：canvas 为预乘存储，alpha=0 时 RGB 会在
  // 导出 PNG 的预乘往返中被抹成黑色——下游（AI 试穿服务端 convert("RGB")）
  // 丢弃 alpha 后会得到黑底。alpha=1/255 视觉上与全透明无异，RGB 纯白又能存活，
  // 丢 alpha 的下游得到干净的白底服装图。
  const BG_ALPHA = 1;
  const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  for (let i = 0, p = 0; p < data.length; i += 1, p += 4) {
    if (!mask[i]) {
      // 背景：RGB 抹白，alpha 取 BG_ALPHA（防预乘吞掉白色，视觉仍透明）
      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = BG_ALPHA;
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
      // 原前景：先做方案一的过渡带羽化，再用原始覆盖度反解前景纯色（去背景色光晕）
      const a = data[p + 3];
      // 模型 mask 的羽化带可能向外扩 1~2px 盖到“纯背景色”像素上（织物覆盖≈0），
      // 反混合无法从中恢复织物色，会留下一圈半透明背景色光晕；
      // 半透明且本身就接近背景色的像素直接按背景处理
      const dr0 = data[p] - bg.r;
      const dg0 = data[p + 1] - bg.g;
      const db0 = data[p + 2] - bg.b;
      const isBgColor = dr0 * dr0 + dg0 * dg0 + db0 * db0 < 30 * 30;
      let a2;
      if (a <= EDGE_LOW) a2 = 0;
      else if (a >= EDGE_HIGH_CEIL) a2 = 255;
      else if (a <= EDGE_HIGH_FLOOR) {
        const t = (a - EDGE_LOW) / (EDGE_HIGH_FLOOR - EDGE_LOW);
        a2 = Math.min(255, Math.max(0, Math.round(t * 255)));
      } else a2 = a;

      if (a2 === 0 || (a2 < 255 && isBgColor)) {
        // 覆盖度过低、或半透明带里的纯背景色像素：按背景处理（白 RGB + BG_ALPHA）
        data[p] = 255;
        data[p + 1] = 255;
        data[p + 2] = 255;
        data[p + 3] = BG_ALPHA;
      } else {
        if (a2 < 255) {
          // 边缘半透明像素：观测色 C 是前景 F 与背景 B 按覆盖度 a 的混合，反解 F
          const an = a / 255;
          const inv = (1 - an) / an;
          data[p] = clamp255(data[p] / an - inv * bg.r);
          data[p + 1] = clamp255(data[p + 1] / an - inv * bg.g);
          data[p + 2] = clamp255(data[p + 2] / an - inv * bg.b);
        }
        data[p + 3] = a2;
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
  // 2) 闭运算（2 次膨胀→2 次腐蚀）：补 2~3px 针孔/缝线/裤腿断裂，外轮廓基本不变
  // 3) 保留最大连通域及其 ≥12% 的大块：背景噪点消失，同时保住分段的裤腿
  // 4) 填小空洞：被前景包围、面积 <3% 的洞补上（织物纹理的小针孔）；领口大洞不填
  // 5) 写回：背景 alpha 清零且 RGB 抹白（下游丢 alpha 时背景也真正移除），
  //    边缘羽化带按背景色反混合去光晕
  const rawMask = buildMask(cropData, w, h, TRIM_ALPHA);
  const closed = closeMask(rawMask, w, h, 2);
  const largest = keepMajorComponents(closed, w, h);
  // 记录“哪些像素是被填上的洞”——写回时才需要合成 RGB
  const beforeHoles = new Uint8Array(largest);
  const filled = fillSmallHoles(largest, w, h, 0.03);
  const filledSet = new Uint8Array(w * h);
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] && !beforeHoles[i]) filledSet[i] = 1;
  }

  // 5) 估计背景色：取裁切框四边上 alpha 很低的像素（基本是原照片背景）求均值，
  //    供边缘反混合去光晕；采样不足时按白底处理。
  //    注意 alpha=0 的像素不可用：canvas 预乘存储下其 RGB 在导出往返时已变黑，
  //    不是真实背景色（上游服装分割会用低 alpha 携带真实背景色，即 a>0 的那些）
  let br = 0, bgc = 0, bb = 0, bcnt = 0;
  const sampleBg = (cx, cy) => {
    const sp = (cy * w + cx) * 4;
    const sa = cropData[sp + 3];
    if (sa > 0 && sa < 64) {
      br += cropData[sp];
      bgc += cropData[sp + 1];
      bb += cropData[sp + 2];
      bcnt += 1;
    }
  };
  for (let x = 0; x < w; x += 1) { sampleBg(x, 0); sampleBg(x, h - 1); }
  for (let y = 0; y < h; y += 1) { sampleBg(0, y); sampleBg(w - 1, y); }
  const bgRGB = bcnt > 0
    ? { r: br / bcnt, g: bgc / bcnt, b: bb / bcnt }
    : { r: 255, g: 255, b: 255 };

  // 6) 把最终 mask 写回：背景 alpha 清零且 RGB 抹白（防 alpha 被下游丢弃），
  //    边缘按背景色反混合去光晕，填洞处用邻域均值合成
  applyMaskToRgba(cropImg, filled, w, h, filledSet, bgRGB);
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
 * 上衣/外套/裤子优先走方案三服装专用模型（u2net_cloth_seg），失败或帽子回退 ISNet。
 * 抠图为空时抛错，由调用方决定是否回退原图。
 * @param {Blob} blob 原始图片
 * @param {(stage:string, progress:number)=>void} [onProgress] 进度回调
 * @param {string} [category] top|coat|pants|hat
 * @returns {Promise<Blob>}
 */
export async function removeBackground(blob, onProgress, category) {
  // —— 方案三：服装专用分割模型优先（hat 不在训练类别内，直接跳过）
  if (category && category !== "hat") {
    try {
      const clothBlob = await segmentCloth(blob, category, onProgress);
      if (clothBlob) return trimToForeground(clothBlob);
    } catch (err) {
      console.warn("服装专用分割失败，回退通用 ISNet 模型：", err);
    }
  }

  // —— 回退/默认：@imgly/background-removal 通用前景分割（ISNet FP32）
  const [engine, publicPath] = await Promise.all([loadEngine(), resolvePublicPath()]);
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
