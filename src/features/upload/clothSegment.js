// 方案三：服装专用分割模型 u2net_cloth_seg（U2Net，rembg 托管权重，~176MB）
// 与通用前景分割 @imgly/background-removal（ISNet）不同，该模型训练目标就是
// “把衣服从背景中分出来并区分上装/下装/连体装”，输出 4 类 argmax：
//   0=背景  1=上装(upper)  2=下装(lower)  3=连体(full/dress)
// 推理直接用 onnxruntime-web（已是 @imgly 的 peer 依赖，无需新增包）。
// 输出 RGBA PNG Blob（alpha=分类 mask），契约与 @imgly 引擎一致，
// 后续可复用 removeBackground.js 里的方案二 mask 后处理管线。

const MODEL_PATH = "/models/cloth-seg/u2net_cloth_seg.onnx";
const ORT_WASM_PATHS = new URL("/models/cloth-seg/ort/", window.location.href).toString();

const INPUT_SIZE = 768; // rembg 官方预处理尺寸（U2Net 全卷积，32 的倍数均可）
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// 我们的衣物分类 → 模型类别索引
//   top/coat → 1（上装）  pants → 2（下装）  hat 不支持（返回 null，调用方回退 ISNet）
const CATEGORY_TO_CLASS = {
  top: 1,
  coat: 1,
  pants: 2,
  lower: 2,
  overall: 3,
  full: 3,
  dress: 3
};

let ortPromise = null;
let sessionPromise = null;

function loadOrt() {
  if (!ortPromise) {
    // webgpu 子路径导出的 bundle 同时含 WebGPU 与 WASM 两套 EP（根入口仅 WASM）
    // @imgly 也用的这个入口，Vite 已预打包，无新增依赖
    ortPromise = import("onnxruntime-web/webgpu").then(mod => mod.default || mod);
  }
  return ortPromise;
}

async function createSession(ort) {
  // 让 ort 在 /models/cloth-seg/ort/ 下找 wasm/glue 文件（由 download-cloth-model.ps1 拷贝）
  ort.env.wasm.wasmPaths = ORT_WASM_PATHS;
  const modelUrl = new URL(MODEL_PATH, window.location.href).toString();
  // u2net_cloth_seg 的 MaxPool 带 ceil_mode=1，onnxruntime-web 的 WebGPU EP 不支持
  // （"using ceil() in shape computation is not yet supported for MaxPool"），
  // WASM EP 完整支持，故该模型固定走 WASM（单线程下约 1~3 分钟，一次性操作）。
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"]
  });
}

function getSession(ort) {
  if (!sessionPromise) sessionPromise = createSession(ort);
  return sessionPromise;
}

// 把图画到指定尺寸 canvas（rembg 做法：直接 resize，不保持宽高比）
function drawToCanvas(bmp, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx;
}

// 预处理：RGB / 255 → (x - mean) / std，NCHW float32
function buildInputTensor(ort, ctx) {
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const n = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(n * 3);
  const strideR = 0;
  const strideG = n;
  const strideB = n * 2;
  for (let p = 0, i = 0; p < data.length; p += 4, i += 1) {
    input[strideR + i] = (data[p] / 255 - MEAN[0]) / STD[0];
    input[strideG + i] = (data[p + 1] / 255 - MEAN[1]) / STD[1];
    input[strideB + i] = (data[p + 2] / 255 - MEAN[2]) / STD[2];
  }
  return new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

// 在输出 logits 上做逐像素 argmax，返回 Uint8Array 类别图（0..C-1）
function argmaxLabels(logits, channels) {
  const n = INPUT_SIZE * INPUT_SIZE;
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    let best = 0;
    let bestVal = -Infinity;
    for (let c = 0; c < channels; c += 1) {
      const v = logits[c * n + i];
      if (v > bestVal) { bestVal = v; best = c; }
    }
    labels[i] = best;
  }
  return labels;
}

// 统计每个服装类（1/2/3）的像素数，用于目标类缺失时的回退
function countClothClasses(labels) {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < labels.length; i += 1) counts[labels[i]] += 1;
  return counts;
}

// mask 精修：模型偶发把同一件衣服的一部分判成背景（实测裤子的腰臀整块漏检）。
// 两步补漏，核心目标是"只保留衣物本身"，不把照片里其他内容（人脸/手臂/衣架/
// 人台/旁边杂物）加回来：
//   A. 语义扩展：除 argmax 命中外，目标类 softmax 概率 ≥ PROB_THRESHOLD 的像素
//      也算衣物。整块漏检区（如裤腰）通常是模型的"犹豫区"，目标类概率仍不低；
//      而非衣物内容（皮肤/衣架钩）的目标类概率接近 0，不会被收进来。
//   B. 包围判定：以模型 mask 为屏障从图像四边泛洪（颜色不限），到不了、且颜色
//      明显不是背景色的像素，才是真正"被衣物轮廓包住的漏检衣物区"，补进前景；
//      被包住但仍是背景色的区域（袖窿/腋下空隙、领口洞）保持透明。
//   注意：泛洪不能只沿背景色走——那样所有非背景色像素都满足"到不了且非背景色"
//   （泛洪根本进不了非背景色区域），会把模型特意排除的内容全部误加回来。
const PROB_THRESHOLD = 0.3;
const BG_COLOR_DIST = 48; // RGB 欧氏距离阈值：< 视为背景色
function refineMaskByBackgroundFlood(ctx, labels, chosen, logits, channels) {
  const S = INPUT_SIZE;
  const n = S * S;
  const { data } = ctx.getImageData(0, 0, S, S);

  // 背景参考色：四边像素均值（白底/纯色底都适用）
  let br = 0, bg = 0, bb = 0, bc = 0;
  const sample = i => {
    const p = i * 4;
    br += data[p]; bg += data[p + 1]; bb += data[p + 2]; bc += 1;
  };
  for (let x = 0; x < S; x += 1) { sample(x); sample((S - 1) * S + x); }
  for (let y = 0; y < S; y += 1) { sample(y * S); sample(y * S + (S - 1)); }
  br /= bc; bg /= bc; bb /= bc;
  const thr2 = BG_COLOR_DIST * BG_COLOR_DIST;
  const bgLike = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const dr = data[p] - br;
    const dg = data[p + 1] - bg;
    const db = data[p + 2] - bb;
    if (dr * dr + dg * dg + db * db < thr2) bgLike[i] = 1;
  }

  // A. 前景屏障 = argmax 命中 ∪ 目标类高概率像素（softmax，减最大 logit 防溢出）
  const barrier = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (labels[i] === chosen) { barrier[i] = 1; continue; }
    let maxV = -Infinity;
    for (let c = 0; c < channels; c += 1) {
      const v = logits[c * n + i];
      if (v > maxV) maxV = v;
    }
    let sum = 0;
    let chosenExp = 0;
    for (let c = 0; c < channels; c += 1) {
      const e = Math.exp(logits[c * n + i] - maxV);
      sum += e;
      if (c === chosen) chosenExp = e;
    }
    if (chosenExp / sum >= PROB_THRESHOLD) barrier[i] = 1;
  }

  // 泛洪阻挡层 = 屏障向外 1px 膨胀：弥合模型 mask 上 1px 级裂缝，
  // 避免包围判定从裂缝"漏"进衣物内部（裂缝像素本身也会被 B 步补回）
  const block = new Uint8Array(n);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      if (!barrier[y * S + x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= S) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx >= 0 && nx < S) block[ny * S + nx] = 1;
        }
      }
    }
  }

  // B. 从四边泛洪：只被 block 挡住，颜色不限（这样才能判定"是否被轮廓包围"）
  const reached = new Uint8Array(n);
  const stack = [];
  const push = i => {
    if (!reached[i] && !block[i]) { reached[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < S; x += 1) { push(x); push((S - 1) * S + x); }
  for (let y = 0; y < S; y += 1) { push(y * S); push(y * S + (S - 1)); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % S;
    const y = (i / S) | 0;
    if (x > 0) push(i - 1);
    if (x < S - 1) push(i + 1);
    if (y > 0) push(i - S);
    if (y < S - 1) push(i + S);
  }

  // 前景 = 屏障 ∪（泛洪未到达 且 颜色非背景色的包围区）
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = barrier[i] || (!reached[i] && !bgLike[i]) ? 1 : 0;
  }
  // mask 之外把采样到的背景参考色一并返回：canvas 预乘存储下 alpha=0 的像素
  // RGB 会被乘成黑色，下游需要真实背景色做边缘反混合/背景色判定
  return { mask: out, bg: { r: Math.round(br), g: Math.round(bg), b: Math.round(bb) } };
}

// 背景像素写入的低 alpha：canvas 预乘存储用它携带背景色（16 级量化足够），
// 必须低于下游 trim 的前景阈值（FAIL_ALPHA 17 / TRIM_ALPHA 32），这些像素最终会被重写
const BG_PRESERVE_ALPHA = 15;

// 二值 mask（Uint8Array，768×768）→ 灰度 canvas 平滑缩放到原图尺寸，得到软 alpha
function maskToAlphaCanvas(mask, dstW, dstH) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = INPUT_SIZE;
  maskCanvas.height = INPUT_SIZE;
  const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const img = mctx.createImageData(INPUT_SIZE, INPUT_SIZE);
  for (let i = 0, p = 0; p < img.data.length; i += 1, p += 4) {
    const v = mask[i] ? 255 : 0;
    img.data[p] = v;
    img.data[p + 1] = v;
    img.data[p + 2] = v;
    img.data[p + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = dstW;
  out.height = dstH;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(maskCanvas, 0, 0, dstW, dstH);
  return octx;
}

/**
 * 用 u2net_cloth_seg 分割服装，返回带 alpha 的 PNG Blob。
 * 不支持的分类（hat）返回 null（调用方应回退 ISNet）。
 * @param {Blob} blob 原始/EXIF 校正后的图片
 * @param {string} category top|coat|pants|...
 * @param {(stage:string, progress:number)=>void} [onProgress]
 * @returns {Promise<Blob|null>}
 */
export async function segmentCloth(blob, category, onProgress) {
  const targetClass = CATEGORY_TO_CLASS[category];
  if (!targetClass) return null; // hat 等不走服装模型

  const ort = await loadOrt();
  onProgress?.("load:cloth-model", 0);
  const session = await getSession(ort);
  onProgress?.("load:cloth-model", 1);

  const bmp = await createImageBitmap(blob);
  const W = bmp.width;
  const H = bmp.height;

  // 预处理 + 推理
  const inputCtx = drawToCanvas(bmp, INPUT_SIZE);
  const inputTensor = buildInputTensor(ort, inputCtx);
  onProgress?.("compute:inference", 0);
  const feeds = { [session.inputNames[0]]: inputTensor };
  const outputs = await session.run(feeds);
  onProgress?.("compute:inference", 1);

  const outTensor = outputs[session.outputNames[0]];
  // 输出形状 [1, C, 768, 768]；C 通常为 4（bg/upper/lower/full）
  const channels = outTensor.dims[1] || 4;
  const labels = argmaxLabels(outTensor.data, channels);
  const counts = countClothClasses(labels);

  // 选类：目标类前景足够（>0.5%）就用；否则按 full → 最大服装类回退
  let chosen = targetClass;
  const minPixels = INPUT_SIZE * INPUT_SIZE * 0.005;
  if (!counts[chosen] || counts[chosen] < minPixels) {
    if (counts[3] >= minPixels) chosen = 3;
    else {
      let best = 0;
      for (let c = 1; c <= 3; c += 1) if (counts[c] > (counts[best] || 0)) best = c;
      if (best === 0) throw new Error("服装模型未识别出任何衣物区域");
      chosen = best;
    }
  }

  // 原图尺寸的 RGB canvas
  const full = document.createElement("canvas");
  full.width = W;
  full.height = H;
  const fctx = full.getContext("2d", { willReadFrequently: true });
  fctx.drawImage(bmp, 0, 0);

  // 模型漏检修补：语义概率扩展 + 背景包围泛洪，把漏检衣物区（如裤腰）补进前景；
  // 袖窿/领口等"包住但仍是背景色"的区域保持透明；人脸/衣架等非衣物内容不回收
  const refined = refineMaskByBackgroundFlood(inputCtx, labels, chosen, outTensor.data, channels);
  const bgRef = refined.bg;
  // 软 alpha（768 → 原图平滑缩放）
  const alphaCtx = maskToAlphaCanvas(refined.mask, W, H);
  const alphaData = alphaCtx.getImageData(0, 0, W, H).data;

  const outImg = fctx.getImageData(0, 0, W, H);
  for (let p = 0; p < outImg.data.length; p += 4) {
    // 灰度 mask 的 R 通道即 alpha
    const a = alphaData[p];
    if (a === 0) {
      // 预乘存储下 alpha=0 的 RGB 会在导出往返时变黑；这里写入真实背景色 +
      // 低 alpha 把背景色"捎"给下游（下游按背景重写这些像素，低 alpha 不会可见）
      outImg.data[p] = bgRef.r;
      outImg.data[p + 1] = bgRef.g;
      outImg.data[p + 2] = bgRef.b;
      outImg.data[p + 3] = BG_PRESERVE_ALPHA;
    } else {
      outImg.data[p + 3] = a;
    }
  }
  fctx.putImageData(outImg, 0, 0);

  return new Promise((resolve, reject) => {
    full.toBlob(result => {
      if (result) resolve(result);
      else reject(new Error("服装分割结果导出失败"));
    }, "image/png");
  });
}
