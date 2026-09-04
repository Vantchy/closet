// 衣物图片方向自动校正。
// 目标：上传的衣服照片如果被拍颠倒/横放，纠正为正向（衣领/腰带在上，袖口/裤脚在下）。
// 路径分层（从不引入依赖 → 轻量启发式）：
//  1) EXIF Orientation（手机/相机最常见，80% 颠倒的根本原因）
//  2) 基于衣物类别的几何启发式（腰口比下摆窄 → 在上方；肩部有领口缺口 → 在上方；等）
//  3) 视觉梯度辅助（上衣/裤子上轻下重 → 垂直像素总权重）
//  若启发式不确定（置信度不足）保持原方向，不做瞎改。

// -------------------- 第一层：EXIF Orientation --------------------

// 解析 JPEG 文件的 APP1 EXIF 方向标记。PNG/WebP 不含 EXIF 时直接返回 1（原图）。
// 返回值是标准 EXIF Orientation 值（1~8），无法解析或不支持返回 1。
function readExifOrientation(blob) {
  return new Promise(resolve => {
    if (!/jpeg|jpg/i.test(blob.type)) {
      resolve(1);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const view = new DataView(reader.result);
        if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) { resolve(1); return; }
        let offset = 2;
        const len = view.byteLength;
        while (offset < len) {
          if (offset + 1 >= len) break;
          if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
          const marker = view.getUint8(offset + 1);
          if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
          if (offset + 4 >= len) break;
          const segLen = view.getUint16(offset + 2);
          if (offset + 2 + segLen > len) break;
          // APP1 (0xE1) + "Exif" 标识
          if (marker === 0xe1 && segLen >= 8 &&
              view.getUint8(offset + 4) === 0x45 &&
              view.getUint8(offset + 5) === 0x78 &&
              view.getUint8(offset + 6) === 0x69 &&
              view.getUint8(offset + 7) === 0x66) {
            const tiffStart = offset + 10;
            if (tiffStart + 8 >= len) { resolve(1); return; }
            const le = view.getUint16(tiffStart) === 0x4949;
            const rd16 = (p) => view.getUint16(p, le);
            const rd32 = (p) => view.getUint32(p, le);
            if (rd16(tiffStart + 2) !== 0x002a) { resolve(1); return; }
            const ifdOff = rd32(tiffStart + 4);
            const ifdStart = tiffStart + ifdOff;
            if (ifdStart + 2 >= len) { resolve(1); return; }
            const n = rd16(ifdStart);
            for (let i = 0; i < n; i++) {
              const e = ifdStart + 2 + i * 12;
              if (e + 12 > len) break;
              if (rd16(e) === 0x0112) { // Orientation tag
                const v = rd16(e + 8);
                resolve((v >= 1 && v <= 8) ? v : 1);
                return;
              }
            }
            resolve(1);
            return;
          }
          offset += 2 + segLen;
        }
        resolve(1);
      } catch {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    // EXIF 出现在文件头部，读前 128KB 足够
    reader.readAsArrayBuffer(blob.slice(0, 131072));
  });
}

// 根据 EXIF 方向把图片正确绘到 canvas 上，返回规范后的 Blob（PNG）。
// orientation: 1~8；1 = 正常无需旋转。
function applyOrientationToBlob(blob, orientation) {
  return new Promise((resolve, reject) => {
    if (orientation === 1) { resolve(blob); return; }
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const cv = document.createElement("canvas");
        let outW = w;
        let outH = h;
        if (orientation >= 5 && orientation <= 8) { outW = h; outH = w; }
        cv.width = outW;
        cv.height = outH;
        const ctx = cv.getContext("2d");
        ctx.save();
        switch (orientation) {
          case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
          case 3: ctx.translate(cv.width, cv.height); ctx.rotate(Math.PI); break;
          case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
          case 5: cv.width = h; cv.height = w; ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
          // EXIF 6 = 顺时针 90°；与 rotateBlob/detectClothingOrientation 的 90° 一致
          case 6: cv.width = h; cv.height = w; ctx.translate(cv.width, 0); ctx.rotate(0.5 * Math.PI); break;
          case 7: cv.width = h; cv.height = w; ctx.rotate(0.5 * Math.PI); ctx.translate(w, -h); ctx.scale(-1, 1); break;
          // EXIF 8 = 逆时针 90°（270°）；与 rotateBlob/detectClothingOrientation 的 270° 一致
          case 8: cv.width = h; cv.height = w; ctx.translate(0, cv.height); ctx.rotate(-0.5 * Math.PI); break;
        }
        ctx.drawImage(img, 0, 0);
        ctx.restore();
        URL.revokeObjectURL(url);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error("方向校正导出失败"))), "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("方向校正解码失败")); };
    img.src = url;
  });
}

// -------------------- 第二层：衣物几何启发式 --------------------

// 裁剪前景后，衣物主体已经铺满画布。按分类判断是否 0/90/180/270。
// 只在置信度超过阈值时才旋转，避免误判。
export function detectClothingOrientation(imageData, category) {
  const { width: W, height: H, data } = imageData;
  const FG = 16; // alpha > FG 视为前景

  // 按行 + 按列统计前景像素
  const rowCount = new Uint32Array(H);
  const colCount = new Uint32Array(W);
  // 按行统计前景亮度加权（上轻下重 → 裤子/上衣上暗下亮/图案集中在下摆）
  const rowLumTop = new Float32Array(H);
  const rowLumBot = new Float32Array(H);
  let total = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = data[i + 3];
      if (a > FG) {
        rowCount[y]++;
        colCount[x]++;
        total++;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (y < H / 2) rowLumTop[y] += lum; else rowLumBot[y] += lum;
      }
    }
  }
  if (total < Math.max(100, 0.002 * W * H)) {
    return { angle: 0, confidence: 0 }; // 无法判断
  }

  // 找到前景最顶端/bottom/left/right 行，用于判断轮廓收窄位置
  let topRow = 0, botRow = H - 1;
  while (topRow < H && rowCount[topRow] < Math.max(4, rowCount[0] || 1)) topRow++;
  while (botRow > 0 && rowCount[botRow] < Math.max(4, rowCount[H - 1] || 1)) botRow--;
  // 取衣物垂直中部（避免领口/裤脚空洞干扰）
  const bodyTop = topRow + Math.max(1, Math.round((botRow - topRow) * 0.12));
  const bodyBot = botRow - Math.max(1, Math.round((botRow - topRow) * 0.12));

  // 每一行的“水平宽度”
  const widths = new Float32Array(H);
  for (let y = topRow; y <= botRow; y++) {
    // 最左非空列、最右非空列
    let l = 0, r = W - 1;
    while (l < W && colCount[l] && !isFgCol(data, W, l, y, FG)) l++; // colCount 不够准，重判单列
    // 这里用更快速：从左右两端向里扫该单像素行
    const rowBase = y * W * 4;
    let left = 0, right = W - 1;
    while (left <= right && data[rowBase + left * 4 + 3] <= FG) left++;
    while (right >= left && data[rowBase + right * 4 + 3] <= FG) right--;
    widths[y] = right >= left ? right - left + 1 : 0;
  }

  // —— 多候选角度评分（每角度重新建立轮廓 → 保证 90/270 的信号不丢失） ——
  // 对 0/90/180/270 每个角度：把原图像真实旋转绘到独立 canvas 上，再沿新
  // 主轴重算 widths、topRow/botRow、顶部中央缺口、上下宽度差；
  // 这样 90°/270 的横向缺口（横放衬衫的领口）会自然出现在顶端/底端的中央，
  // 不再需要水平/垂直两套独立规则。
  const rotateImgData = (deg) => {
    const cv = document.createElement("canvas");
    if (deg === 0 || deg === 180) { cv.width = W; cv.height = H; }
    else { cv.width = H; cv.height = W; }
    const ctx = cv.getContext("2d");
    // 目标：让原 (0,0) -> (0,0)，原 (W-1,0) -> 正确的对角。
    // 90°  (顺时针)：原顶行 → 右列， (x,y) -> (H-1-y, x)
    //        等价：ctx.translate(cv.width, 0); ctx.rotate(π/2);  // 然后绘 (0,0) 处
    // 180°：(x,y) -> (W-1-x, H-1-y)
    //        等价：ctx.translate(cv.width, cv.height); ctx.rotate(π);
    // 270° (逆时针 90°)：原顶行 -> 左列， (x,y) -> (y, W-1-x)
    //        等价：ctx.translate(0, cv.height); ctx.rotate(-π/2);
    ctx.save();
    if (deg === 90) {
      ctx.translate(cv.width, 0);
      ctx.rotate(Math.PI / 2);
    } else if (deg === 180) {
      ctx.translate(cv.width, cv.height);
      ctx.rotate(Math.PI);
    } else if (deg === 270) {
      ctx.translate(0, cv.height);
      ctx.rotate(-Math.PI / 2);
    }
    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    src.getContext("2d").putImageData(imageData, 0, 0);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
    return {
      data: ctx.getImageData(0, 0, cv.width, cv.height),
      w: cv.width,
      h: cv.height
    };
  };

  const scoreDeg = (deg, cat) => {
    const { data: d, w, h } = rotateImgData(deg);
    const pix = d.data;
    const widths = new Float32Array(h);
    let topRow = 0, botRow = h - 1;
    for (let y = 0; y < h; y++) {
      const rb = y * w * 4;
      let left = 0, right = w - 1;
      while (left <= right && pix[rb + left * 4 + 3] <= FG) left++;
      while (right >= left && pix[rb + right * 4 + 3] <= FG) right--;
      const v = right >= left ? right - left + 1 : 0;
      widths[y] = v;
      if (!topRow && v > 4) topRow = y;
      if (v > 4) botRow = y;
    }
    if (botRow <= topRow + 3) return { s: 0, w, h };
    const bodyTop = topRow + Math.max(1, Math.round((botRow - topRow) * 0.12));
    const bodyBot = botRow - Math.max(1, Math.round((botRow - topRow) * 0.12));

    // 上下宽度：仅当此候选角度输出为纵向（h ≥ w）时才奖励“上窄下宽”。
    // 横放（w > h）时的上窄下宽是衣服水平翼形（袖口/下摆展开）造成的假象，不能当正向依据。
    // 不做“上宽下窄扣分”，见上方说明。
    let topHalf = 0, botHalf = 0, nt = 0, nb = 0;
    const mid = Math.floor((bodyTop + bodyBot) / 2);
    for (let i = bodyTop; i < mid; i++) { topHalf += widths[i]; nt++; }
    for (let i = mid; i <= bodyBot; i++) { botHalf += widths[i]; nb++; }
    let s = 0;
    if (h >= w && nt && nb && botHalf) {
      const ratio = (topHalf / nt) / (botHalf / nb);
      const thr = cat === "pants" ? 1.15 : 1.08;
      if (ratio < 1 / thr) s += 1.0;
    }
    // 顶端 vs 底端中央缺口：奖励“缺口在顶”（领口/帽檐口在上就是正向），
    // 缺口在底不扣分——因为把图旋转 180° 后原底变成顶，自然得奖。
    const band = Math.max(3, Math.round((botRow - topRow) * 0.12));
    const tg = measureGap(d, widths, topRow, band, w, FG);
    const bg = measureGap(d, widths, Math.max(topRow, botRow - band), band, w, FG);
    if (tg > 0.07 && tg > 1.6 * Math.max(0.01, bg)) s += 1.0;
    return { s, w, h };
  };

  // 评分后做 tie-break：多个候选同分且分数 ≥0 时，
  // 优先选纵向 (h > w) 的角度——直立的衣服一定是纵长比横宽更长。
  const degs = [0, 90, 180, 270];
  const entries = degs.map(d => {
    const { s, w, h } = scoreDeg(d, category);
    return { d, s, h, w };
  });
  entries.sort((a, b) => {
    const ds = b.s - a.s;
    if (Math.abs(ds) > 0.01) return ds;
    // 同分：选纵长比（h/w）更大的角度
    const pa = a.h / a.w;
    const pb = b.h / b.w;
    return pb - pa;
  });
  const best = entries[0];
  const second = entries[1];
  const margin = best.s - second.s;
  const tiePortrait = best.h > best.w;
  const confidence = Math.max(
    0.2,
    Math.min(0.95, 0.2 + 0.3 * Math.max(0, best.s) + 0.5 * Math.max(0, margin) + (tiePortrait ? 0.2 : 0))
  );
  return { angle: best.d, confidence };
}

// 水平方向缺口：在 x 起 cols 列里，中间行 vs 上下行的前景比。
// side=left/right：指示侧方向
function measureSideGap(imageData, x, cols, FG, side) {
  const W = imageData.width;
  const H = imageData.height;
  let centerFg = 0, centerTotal = 0;
  let edgeFg = 0, edgeTotal = 0;
  const yTop0 = Math.floor(H * 0.08);
  const yTop1 = Math.floor(H * 0.4);
  const yBot0 = Math.ceil(H * 0.6);
  const yBot1 = Math.ceil(H * 0.92);
  const yMid0 = Math.floor(H * 0.42);
  const yMid1 = Math.ceil(H * 0.58);
  const x0 = Math.max(0, x);
  const x1 = Math.min(W - 1, x + cols - 1);
  const data = imageData.data;
  for (let xx = x0; xx <= x1; xx++) {
    for (let yy = yMid0; yy <= yMid1; yy++) {
      centerTotal++;
      if (data[(yy * W + xx) * 4 + 3] > FG) centerFg++;
    }
    for (let yy = yTop0; yy <= yTop1; yy++) {
      edgeTotal++;
      if (data[(yy * W + xx) * 4 + 3] > FG) edgeFg++;
    }
    for (let yy = yBot0; yy <= yBot1; yy++) {
      edgeTotal++;
      if (data[(yy * W + xx) * 4 + 3] > FG) edgeFg++;
    }
  }
  if (!edgeTotal || !centerTotal) return 0;
  const eR = edgeFg / edgeTotal;
  const cR = centerFg / centerTotal;
  if (eR < 0.1) return 0;
  return Math.max(0, eR - cR) / Math.max(0.2, eR);
}

// 像素行内左/右向里扫时 isFgCol 占位。
function isFgCol(data, W, x, _y, FG) {
  return false; // 上方已 inline 实现，这里保留签名
}

function avgWindow(arr, a, b) {
  const i0 = Math.max(0, Math.floor(a));
  const i1 = Math.min(arr.length - 1, Math.floor(b));
  if (i1 <= i0) return 0;
  let s = 0;
  for (let i = i0; i <= i1; i++) s += arr[i];
  return s / (i1 - i0 + 1);
}

// 检测衣物顶端/底端的中央“缺口”（领口、帽檐口、裤腰扣口）。
function detectNeckGap(imageData, widths, topRow, botRow, FG) {
  const W = imageData.width, H = imageData.height;
  const topBandLen = Math.max(3, Math.round((botRow - topRow) * 0.12));
  const topY = topRow + 1;
  const botY = botRow - topBandLen;

  const gapTop = measureGap(imageData, widths, topY, topBandLen, W, FG);
  const gapBot = measureGap(imageData, widths, botY, topBandLen, W, FG);

  // 明显缺口才算，避免把衣服自然边缘的起伏当缺口
  if (gapTop > 0.08 && gapTop > 1.8 * gapBot) return "top";
  if (gapBot > 0.08 && gapBot > 1.8 * gapTop) return "bottom";
  return "none";
}

// 在 [y..y+rows) 的带状区域里：若中央列前景比例明显低于两侧，则是缺口。
function measureGap(imageData, widths, y, rows, W, FG) {
  let centerFg = 0, centerTotal = 0, sideFg = 0, sideTotal = 0;
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(imageData.height - 1, y0 + rows - 1);
  const left1 = Math.floor(W * 0.08);
  const left2 = Math.floor(W * 0.4);
  const right1 = Math.ceil(W * 0.6);
  const right2 = Math.ceil(W * 0.92);
  for (let yy = y0; yy <= y1; yy++) {
    const rowBase = yy * W * 4;
    const lw = widths[yy] || W;
    const midX0 = Math.floor(W / 2 - lw * 0.18);
    const midX1 = Math.ceil(W / 2 + lw * 0.18);
    for (let xx = midX0; xx <= midX1; xx++) {
      if (xx < 0 || xx >= W) continue;
      centerTotal++;
      if (imageData.data[rowBase + xx * 4 + 3] > FG) centerFg++;
    }
    for (let xx = left1; xx <= left2; xx++) {
      if (xx < 0 || xx >= W) continue;
      sideTotal++;
      if (imageData.data[rowBase + xx * 4 + 3] > FG) sideFg++;
    }
    for (let xx = right1; xx <= right2; xx++) {
      if (xx < 0 || xx >= W) continue;
      sideTotal++;
      if (imageData.data[rowBase + xx * 4 + 3] > FG) sideFg++;
    }
  }
  if (!sideTotal || !centerTotal) return 0;
  const sideRatio = sideFg / sideTotal;
  const centerRatio = centerFg / centerTotal;
  if (sideRatio < 0.1) return 0;
  // 缺口越深返回越大，0~1
  return Math.max(0, sideRatio - centerRatio) / Math.max(0.2, sideRatio);
}

// 把 blob 按角度旋转（0/90/180/270），返回 PNG Blob。
// 除自动校正外，也供预览面板的“旋转”按钮手动修正衣物方向使用。
export function rotateBlob(blob, angle) {
  return new Promise((resolve, reject) => {
    if (angle % 360 === 0) { resolve(blob); return; }
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const cv = document.createElement("canvas");
        const rot = (angle % 360 + 360) % 360;
        if (rot === 90 || rot === 270) { cv.width = h; cv.height = w; } else { cv.width = w; cv.height = h; }
        const ctx = cv.getContext("2d");
        ctx.save();
        // 与内部 detectClothingOrientation.rotateImgData 使用同一组旋转矩阵，
        // 保证检测和输出方向一致。
        if (rot === 90) { ctx.translate(cv.width, 0); ctx.rotate(Math.PI / 2); }
        else if (rot === 180) { ctx.translate(cv.width, cv.height); ctx.rotate(Math.PI); }
        else if (rot === 270) { ctx.translate(0, cv.height); ctx.rotate(-Math.PI / 2); }
        ctx.drawImage(img, 0, 0);
        ctx.restore();
        URL.revokeObjectURL(url);
        cv.toBlob(b => (b ? resolve(b) : reject(new Error("旋转导出失败"))), "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("旋转解码失败")); };
    img.src = url;
  });
}

/**
 * 第一步（去背景前）：应用 EXIF 方向。
 * 手机/相机拍的 JPEG 经常写入了 Orientation 但浏览器 canvas 默认不应用，
 * 导致我们对图片的旋转判断和 UI 显示都基于错的像素顺序。
 * 这一步必须先做，因为去背景的 canvas 会丢弃 EXIF 元数据。
 */
export async function applyExifOrientation(blob) {
  const orientation = await readExifOrientation(blob);
  return applyOrientationToBlob(blob, orientation);
}

/**
 * 第二步（去背景后、前景主体已孤立）：基于衣物几何启发式判定是否需要进一步旋转。
 * 解决 EXIF 未写入、相机方向对但用户把衣服倒着平铺拍了等 EXIF 覆盖不到的场景。
 *
 * 置信度阈值放宽（≥ 0.4），配合“结果必为纵向（h ≥ w）”的结构自检兜底：
 *   - 检测命中要旋转 → 真的旋转 → 若结果是 landscape 则撤销（这是衣服天然特征，
 *     除了裙子/某些外套外基本都是纵长≥横宽）。
 * 把“误判”的风险从视觉错误降到了“偶尔没转”的保守错误。
 */
export async function applyClothingHeuristic(foregroundBlob, category) {
  try {
    const bmp = await createImageBitmap(foregroundBlob);
    const origW = bmp.width;
    const origH = bmp.height;
    const cv = document.createElement("canvas");
    cv.width = origW;
    cv.height = origH;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const imgData = ctx.getImageData(0, 0, cv.width, cv.height);

    const { angle, confidence } = detectClothingOrientation(imgData, category);
    if (confidence < 0.4 || angle === 0) return foregroundBlob;

    const rotated = await rotateBlob(foregroundBlob, angle);
    const dims = blob => new Promise((res, rej) => {
      const i = new Image();
      const u = URL.createObjectURL(blob);
      i.onload = () => { URL.revokeObjectURL(u); res({ w: i.naturalWidth, h: i.naturalHeight }); };
      i.onerror = e => { URL.revokeObjectURL(u); rej(e); };
      i.src = u;
    });
    const { w, h } = await dims(rotated);
    // 结构兜底：旋转后 landscape（w > h）就撤销。
    // 衣物天然是上→下的纵长结构，90% 以上案例下 h ≥ w 是正向的强约束。
    if (w > h) return foregroundBlob;
    return rotated;
  } catch {
    return foregroundBlob;
  }
}

/**
 * 一站式方向校正（在只有上传文件、不做去背景的场景下可用）。
 * 完整流程：EXIF → 近似前景掩码 → 几何启发式。
 * 上传链路内部会改用 applyExifOrientation + applyClothingHeuristic 的两段拆分形式，
 * 因为几何启发式在去背景（AI 已把前景完全孤立）后准确率显著更高。
 */
export async function autoOrientImage(blob, category) {
  let result = await applyExifOrientation(blob);
  try {
    const bmp = await createImageBitmap(result);
    const cv = document.createElement("canvas");
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const imgData = ctx.getImageData(0, 0, cv.width, cv.height);

    const heuristicData = toForegroundMaskedImage(imgData);
    const { angle, confidence } = detectClothingOrientation(heuristicData, category);
    if (confidence >= 0.6 && angle !== 0) {
      result = await rotateBlob(result, angle);
    }
  } catch {
    // 第二层启发式失败静默降级：EXIF 已生效，不会让情况更糟。
  }

  return result;
}

// 粗略前景掩码：去掉极白（典型挂拍/平铺背景）和纯透明/接近透明的背景区域。
// 返回新的 ImageData（像素值保留原图，非前景区域 alpha=0，用于判断衣物主体形状）。
function toForegroundMaskedImage(imgData) {
  const W = imgData.width, H = imgData.height;
  const out = new Uint8ClampedArray(imgData.data);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = out[i], g = out[i + 1], b = out[i + 2], a = out[i + 3];
      if (a < 16) continue; // 本来透明，保留
      // 极白背景（挂拍）
      if (r > 240 && g > 240 && b > 240) { out[i + 3] = 0; continue; }
      // 极暗背景（夜晚/影棚黑背景）
      if (r < 15 && g < 15 && b < 15) { out[i + 3] = 0; continue; }
    }
  }
  return { width: W, height: H, data: out };
}
