
/**
 * Pants try-on geometry for the male 2D character.
 *
 * Design goals:
 * 1) Split the arm-less body image along the shorts/skin boundary into
 *    base body + two non-rectangular full-size leg layers. Every layer keeps
 *    the original body coordinate system, so rotating a leg never requires
 *    re-positioning a cropped rectangle.
 * 2) Build a body axis from the anatomical thigh midpoint to the ankle midpoint.
 * 3) Detect a pants axis from each leg-root midpoint to each ankle midpoint.
 * 4) Isotropically fit the pants' effective top width to the character waist,
 *    pin the top edge, then vertically compress when the target ankle is outside
 *    the rigid-leg rotation circle, then rotate the body legs to the final axes.
 */

const ALPHA_THRESHOLD = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function angleDelta(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  const t = index - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    image.src = src;
  });
}

function imageToCanvas(image, width = null, height = null) {
  const w = width ?? image.naturalWidth ?? image.width;
  const h = height ?? image.naturalHeight ?? image.height;
  const canvas = makeCanvas(w, h);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(
    image,
    0,
    0,
    w,
    h
  );
  return canvas;
}

function hasUsefulTransparency(imageData) {
  const data = imageData.data;
  let transparent = 0;
  let sampled = 0;
  for (let i = 3; i < data.length; i += 16) {
    sampled += 1;
    if (data[i] < 220) transparent += 1;
  }
  return sampled > 0 && transparent / sampled > 0.004;
}

function removeFlatBackground(imageData) {
  const { width, height, data } = imageData;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 70));
  const stepY = Math.max(1, Math.floor(height / 70));

  const push = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };

  for (let x = 0; x < width; x += stepX) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    push(0, y);
    push(width - 1, y);
  }

  const bg = [0, 1, 2].map(k => median(samples.map(sample => sample[k])) ?? 255);

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const dist = Math.hypot(dr, dg, db);
    if (dist < 24) data[i + 3] = 0;
  }
}

function removeBorderConnectedBackground(imageData) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  if (!width || !height || !pixelCount) {
    return {
      method: "border-cluster-flood",
      removedPixels: 0,
      removedRatio: 0,
      clusterCount: 0
    };
  }

  // Opaque pants screenshots often contain a *baked-in* checkerboard rather
  // than true alpha. A single median border colour is not enough for that
  // pattern. Build a small palette from the dominant border colours instead.
  const quantStep = 12;
  const bins = new Map();
  let borderSamples = 0;

  const addBorderPixel = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] <= ALPHA_THRESHOLD) return;

    const qr = Math.floor(data[i] / quantStep);
    const qg = Math.floor(data[i + 1] / quantStep);
    const qb = Math.floor(data[i + 2] / quantStep);
    const key = `${qr},${qg},${qb}`;
    const item = bins.get(key) ?? {
      count: 0,
      r: 0,
      g: 0,
      b: 0
    };
    item.count += 1;
    item.r += data[i];
    item.g += data[i + 1];
    item.b += data[i + 2];
    bins.set(key, item);
    borderSamples += 1;
  };

  for (let x = 0; x < width; x += 1) {
    addBorderPixel(x, 0);
    if (height > 1) addBorderPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    addBorderPixel(0, y);
    if (width > 1) addBorderPixel(width - 1, y);
  }

  if (!borderSamples || !bins.size) {
    return {
      method: "border-cluster-flood",
      removedPixels: 0,
      removedRatio: 0,
      clusterCount: 0
    };
  }

  const sorted = [...bins.values()].sort((a, b) => b.count - a.count);
  const colors = [];
  let covered = 0;
  const minClusterCount = Math.max(2, Math.floor(borderSamples * 0.008));

  for (const item of sorted) {
    if (colors.length >= 8) break;
    if (item.count < minClusterCount && colors.length >= 2) break;

    colors.push({
      r: item.r / item.count,
      g: item.g / item.count,
      b: item.b / item.count
    });
    covered += item.count;

    if (colors.length >= 2 && covered >= borderSamples * 0.88) break;
  }

  if (!colors.length) {
    return {
      method: "border-cluster-flood",
      removedPixels: 0,
      removedRatio: 0,
      clusterCount: 0
    };
  }

  // 34px RGB distance comfortably spans JPEG/resize noise around the common
  // white/grey checkerboard while staying conservative around garment edges.
  const toleranceSq = 34 * 34;
  const candidate = new Uint8Array(pixelCount);

  for (let idx = 0; idx < pixelCount; idx += 1) {
    const i = idx * 4;
    if (data[i + 3] <= ALPHA_THRESHOLD) {
      candidate[idx] = 1;
      continue;
    }

    let best = Infinity;
    for (const color of colors) {
      const dr = data[i] - color.r;
      const dg = data[i + 1] - color.g;
      const db = data[i + 2] - color.b;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 < best) best = d2;
    }
    if (best <= toleranceSq) candidate[idx] = 1;
  }

  // Only delete candidate pixels that are connected to the image boundary.
  // This protects same-coloured details such as a white button inside pants.
  const background = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueue = idx => {
    if (!candidate[idx] || background[idx]) return;
    background[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    if (height > 1) enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    if (width > 1) enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = Math.floor(idx / width);

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        enqueue(yy * width + xx);
      }
    }
  }

  let removedPixels = 0;
  for (let idx = 0; idx < pixelCount; idx += 1) {
    if (!background[idx]) continue;
    const i = idx * 4;
    if (data[i + 3] > 0) removedPixels += 1;
    data[i + 3] = 0;
  }

  return {
    method: "border-cluster-flood",
    removedPixels,
    removedRatio: removedPixels / Math.max(1, pixelCount),
    clusterCount: colors.length
  };
}

function alphaBBox(imageData, threshold = 12) {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return maxX < 0
    ? null
    : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      };
}

function cropCanvas(source, box) {
  const canvas = makeCanvas(box.width, box.height);
  canvas.getContext("2d").drawImage(
    source,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height
  );
  return canvas;
}

function rgbaAt(data, index) {
  const i = index * 4;
  return {
    r: data[i],
    g: data[i + 1],
    b: data[i + 2],
    a: data[i + 3]
  };
}

function isShortsBlue(r, g, b, a) {
  if (a <= ALPHA_THRESHOLD) return false;
  return (
    b > r + 25 &&
    b > g + 12 &&
    b > r * 1.18 &&
    r < 150 &&
    g < 165
  );
}

function largestContiguousRun(xs, maxGap = 3) {
  if (!xs.length) return null;
  const sorted = [...new Set(xs)].sort((a, b) => a - b);
  const runs = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] <= maxGap) {
      current.push(sorted[i]);
    } else {
      runs.push(current);
      current = [sorted[i]];
    }
  }
  runs.push(current);

  runs.sort((a, b) => {
    const widthA = a[a.length - 1] - a[0] + 1;
    const widthB = b[b.length - 1] - b[0] + 1;
    const scoreA = widthA * Math.sqrt(a.length);
    const scoreB = widthB * Math.sqrt(b.length);
    return scoreB - scoreA;
  });

  return runs[0];
}

function smoothSeamMap(seamMap, xs, radius = 3) {
  const smoothed = new Float64Array(seamMap.length);
  smoothed.fill(Number.NaN);

  for (const x of xs) {
    const ys = [];
    for (
      let xx = Math.max(0, x - radius);
      xx <= Math.min(seamMap.length - 1, x + radius);
      xx += 1
    ) {
      if (Number.isFinite(seamMap[xx])) ys.push(seamMap[xx]);
    }
    const value = median(ys);
    if (Number.isFinite(value)) smoothed[x] = value;
  }
  return smoothed;
}

function detectShortsColorGeometry(imageData, cfg) {
  const { width, height, data } = imageData;
  const centerX = cfg.bodyCenterX ?? width / 2;

  // Do not reuse cfg.shortsTopY here. In the original upper-body algorithm
  // that value is a torso/hem calibration point, not the visible top edge of
  // the navy shorts. Pants must align to the actual image pixels instead.
  const scanTop = clamp(Math.floor(height * 0.42), 0, height - 1);
  const scanBottom = clamp(Math.ceil(height * 0.68), scanTop + 1, height - 1);

  let topY = height;
  let bottomY = -1;
  let minX = width;
  let maxX = -1;
  const rowSpans = [];

  for (let y = scanTop; y <= scanBottom; y += 1) {
    let rowMinX = width;
    let rowMaxX = -1;
    let rowCount = 0;

    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (!isShortsBlue(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        continue;
      }

      rowCount += 1;
      if (x < rowMinX) rowMinX = x;
      if (x > rowMaxX) rowMaxX = x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    if (!rowCount) continue;
    if (y < topY) topY = y;
    if (y > bottomY) bottomY = y;
    rowSpans.push({
      y,
      minX: rowMinX,
      maxX: rowMaxX,
      width: rowMaxX - rowMinX + 1,
      centerX: (rowMinX + rowMaxX) / 2,
      count: rowCount
    });
  }

  if (bottomY < 0 || !rowSpans.length) {
    throw new Error("未检测到男生蓝色短裤区域");
  }

  const widest = rowSpans.reduce(
    (best, row) => (!best || row.width > best.width ? row : best),
    null
  );

  // Measure the *top waistband width* separately from the widest shorts row.
  // The first few anti-aliased pixels at topY form a shallow curved contour,
  // so using the literal top row would report only a handful of blue pixels.
  // The first nearly-solid row is a much better representation of the waist
  // width at the top-lock position.
  const shortsHeight = Math.max(1, bottomY - topY + 1);
  const topBandEnd = Math.min(
    bottomY,
    topY + Math.max(18, Math.floor(shortsHeight * 0.10))
  );
  const topBandRows = rowSpans.filter(row => row.y <= topBandEnd);
  const firstSolidTop =
    topBandRows.find(row =>
      row.width >= 8 && row.count / Math.max(1, row.width) >= 0.90
    ) ?? topBandRows[0] ?? widest;
  const topSamples = topBandRows.filter(row =>
    row.y >= firstSolidTop.y &&
    row.y <= firstSolidTop.y + 6 &&
    row.count / Math.max(1, row.width) >= 0.85
  );
  const stableTopRows = topSamples.length ? topSamples : [firstSolidTop];
  const topWaistSpan =
    median(stableTopRows.map(row => row.width)) ?? widest?.width ?? 1;
  const topWaistCenterX =
    median(stableTopRows.map(row => row.centerX)) ?? widest?.centerX ?? centerX;
  const topWaistSampleY =
    median(stableTopRows.map(row => row.y)) ?? topY;

  return {
    topY,
    bottomY,
    minX,
    maxX,
    width: maxX - minX + 1,
    centerX,
    widestSpan: widest?.width ?? (maxX - minX + 1),
    widestCenterX: widest?.centerX ?? centerX,
    topWaistSpan,
    topWaistCenterX,
    topWaistSampleY,
    rowSpans
  };
}

function detectShortsLegSeams(imageData, cfg, shortsGeometry = null) {
  const { width, height, data } = imageData;
  const shorts = shortsGeometry ?? detectShortsColorGeometry(imageData, cfg);
  const centerX = shorts.centerX;
  const shortsHeight = Math.max(1, shorts.bottomY - shorts.topY + 1);

  // Restrict seam search to the lower portion of the detected shorts. This
  // finds the real navy/skin contour and avoids treating any rectangular crop
  // boundary as a leg edge.
  const y0 = clamp(
    Math.floor(shorts.topY + shortsHeight * 0.52),
    0,
    height - 2
  );
  const y1 = clamp(
    Math.ceil(shorts.bottomY + Math.max(18, height * 0.018)),
    y0 + 2,
    height - 1
  );

  const seamRaw = new Float64Array(width);
  seamRaw.fill(Number.NaN);
  const lastBlue = new Int32Array(width);
  lastBlue.fill(-1);

  for (let x = 0; x < width; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const i = (y * width + x) * 4;
      if (isShortsBlue(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        lastBlue[x] = y;
      }
    }

    if (lastBlue[x] < y0) continue;

    const searchBottom = Math.min(
      height - 1,
      lastBlue[x] + Math.max(18, Math.floor(height * 0.018))
    );

    for (let y = lastBlue[x] + 1; y <= searchBottom; y += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= ALPHA_THRESHOLD) continue;
      if (isShortsBlue(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      seamRaw[x] = y;
      break;
    }
  }

  const leftXs = [];
  const rightXs = [];
  for (let x = 0; x < width; x += 1) {
    if (!Number.isFinite(seamRaw[x])) continue;
    if (x < centerX - 2) leftXs.push(x);
    else if (x > centerX + 2) rightXs.push(x);
  }

  const leftRun = largestContiguousRun(leftXs, 4);
  const rightRun = largestContiguousRun(rightXs, 4);

  if (!leftRun || !rightRun || leftRun.length < 8 || rightRun.length < 8) {
    throw new Error("未能稳定检测到蓝色短裤与两条腿之间的两段分界线");
  }

  const leftSeam = smoothSeamMap(seamRaw, leftRun, 3);
  const rightSeam = smoothSeamMap(seamRaw, rightRun, 3);

  const allY = [
    ...leftRun.map(x => leftSeam[x]),
    ...rightRun.map(x => rightSeam[x])
  ].filter(Number.isFinite);

  const globalUnlockY = Math.ceil((percentile(allY, 0.92) ?? shorts.bottomY) + 3);

  return {
    centerX,
    y0,
    y1,
    leftRun,
    rightRun,
    leftSeam,
    rightSeam,
    globalUnlockY,
    shorts,
    confidence: clamp(
      Math.min(leftRun.length, rightRun.length) /
        Math.max(24, Math.min(width * 0.12, 100)),
      0,
      1
    )
  };
}

function seamValueForX(seams, side, x) {
  const map = side === "left" ? seams.leftSeam : seams.rightSeam;
  return Number.isFinite(map[x]) ? map[x] : null;
}

function floodLegMask(imageData, seams, side) {
  const { width, height, data } = imageData;
  const size = width * height;
  const mask = new Uint8Array(size);
  const queued = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  const run = side === "left" ? seams.leftRun : seams.rightRun;
  const centerX = seams.centerX;

  const sideAllows = x =>
    side === "left"
      ? x < Math.ceil(centerX)
      : x > Math.floor(centerX);

  const allowed = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height || !sideAllows(x)) {
      return false;
    }

    const idx = y * width + x;
    const i = idx * 4;
    const a = data[i + 3];
    if (a <= ALPHA_THRESHOLD) return false;
    if (isShortsBlue(data[i], data[i + 1], data[i + 2], a)) return false;

    const seamY = seamValueForX(seams, side, x);
    if (seamY != null) return y >= Math.floor(seamY) - 1;
    return y >= seams.globalUnlockY;
  };

  const push = (x, y) => {
    if (!allowed(x, y)) return;
    const idx = y * width + x;
    if (queued[idx]) return;
    queued[idx] = 1;
    queue[tail++] = idx;
  };

  for (const x of run) {
    const seamY = seamValueForX(seams, side, x);
    if (seamY == null) continue;
    const sy = clamp(Math.floor(seamY), 0, height - 1);
    push(x, sy);
    push(x, sy + 1);
    push(x, sy + 2);
  }

  while (head < tail) {
    const idx = queue[head++];
    if (mask[idx]) continue;
    mask[idx] = 1;

    const x = idx % width;
    const y = (idx - x) / width;

    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);

    // Diagonal connectivity keeps anti-aliased contour pixels attached.
    push(x - 1, y - 1);
    push(x + 1, y - 1);
    push(x - 1, y + 1);
    push(x + 1, y + 1);
  }

  return mask;
}

function maskBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let idx = 0; idx < mask.length; idx += 1) {
    if (!mask[idx]) continue;
    count += 1;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return maxX < 0
    ? null
    : {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        count
      };
}

function rowSpan(mask, width, y) {
  if (y < 0) return null;
  const start = y * width;
  if (start >= mask.length) return null;

  let minX = width;
  let maxX = -1;
  for (let x = 0; x < width; x += 1) {
    if (!mask[start + x]) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }

  return maxX < 0
    ? null
    : {
        minX,
        maxX,
        width: maxX - minX + 1,
        centerX: (minX + maxX) / 2
      };
}

function stableRowCenter(mask, width, height, y, radius = 3) {
  const centers = [];
  const widths = [];
  const ys = [];

  for (
    let yy = Math.max(0, Math.round(y) - radius);
    yy <= Math.min(height - 1, Math.round(y) + radius);
    yy += 1
  ) {
    const span = rowSpan(mask, width, yy);
    if (!span || span.width < 3) continue;
    centers.push(span.centerX);
    widths.push(span.width);
    ys.push(yy);
  }

  if (!centers.length) return null;
  return {
    x: median(centers),
    y: median(ys),
    width: median(widths)
  };
}

function detectAnkle(mask, width, height, bounds) {
  const yStart = Math.floor(bounds.minY + bounds.height * 0.70);
  const yEnd = Math.min(
    bounds.maxY,
    Math.ceil(bounds.minY + bounds.height * 0.93)
  );

  let best = null;
  for (let y = yStart; y <= yEnd; y += 1) {
    const widths = [];
    const centers = [];
    for (let yy = Math.max(yStart, y - 3); yy <= Math.min(yEnd, y + 3); yy += 1) {
      const span = rowSpan(mask, width, yy);
      if (!span || span.width < 3) continue;
      widths.push(span.width);
      centers.push(span.centerX);
    }
    if (widths.length < 3) continue;

    const smoothWidth = median(widths);
    const centerX = median(centers);
    if (!Number.isFinite(smoothWidth) || !Number.isFinite(centerX)) continue;

    // Prefer the narrowest stable section; on ties, prefer the lower row.
    if (
      !best ||
      smoothWidth < best.width - 0.25 ||
      (Math.abs(smoothWidth - best.width) <= 0.25 && y > best.y)
    ) {
      best = { x: centerX, y, width: smoothWidth };
    }
  }

  if (best) return best;

  return stableRowCenter(
    mask,
    width,
    height,
    bounds.minY + bounds.height * 0.84,
    5
  );
}

function detectLegAxis(mask, width, height, cfg) {
  const bounds = maskBounds(mask, width, height);
  if (!bounds || bounds.count < Math.max(100, width * height * 0.002)) {
    throw new Error("腿部分割像素过少，无法建立腿部轴线");
  }

  const ankle = detectAnkle(mask, width, height, bounds);
  if (!ankle) throw new Error("未检测到脚踝中点");

  // "Thigh midpoint" is the midpoint of the anatomical thigh segment.
  // With the knee approximately halfway from the shorts seam to the ankle,
  // the thigh midpoint sits at ~1/4 of that top-to-ankle distance.
  const thighMidRatio = cfg.pantsThighMidRatio ?? 0.26;
  const thighTargetY =
    bounds.minY +
    (ankle.y - bounds.minY) * thighMidRatio;

  const thigh = stableRowCenter(
    mask,
    width,
    height,
    thighTargetY,
    4
  );

  if (!thigh) throw new Error("未检测到大腿中点");

  const radius = Math.hypot(
    ankle.x - thigh.x,
    ankle.y - thigh.y
  );

  return {
    bounds,
    thigh: { x: thigh.x, y: thigh.y },
    ankle: { x: ankle.x, y: ankle.y },
    radius,
    restAngle: angle(thigh, ankle)
  };
}

function partitionCanvas(sourceImageData, mask, invertMasks = null) {
  const { width, height, data } = sourceImageData;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(width, height);

  for (let idx = 0; idx < mask.length; idx += 1) {
    let keep = Boolean(mask[idx]);
    if (invertMasks) {
      keep = true;
      for (let k = 0; k < invertMasks.length; k += 1) {
        if (invertMasks[k][idx]) {
          keep = false;
          break;
        }
      }
    }
    if (!keep) continue;
    const i = idx * 4;
    out.data[i] = data[i];
    out.data[i + 1] = data[i + 1];
    out.data[i + 2] = data[i + 2];
    out.data[i + 3] = data[i + 3];
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}

function opaqueSpanAtRow(imageData, y, alphaThreshold = ALPHA_THRESHOLD) {
  const { width, height, data } = imageData;
  const yy = clamp(Math.round(y), 0, height - 1);
  let minX = width;
  let maxX = -1;

  for (let x = 0; x < width; x += 1) {
    if (data[(yy * width + x) * 4 + 3] <= alphaThreshold) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }

  return maxX < 0
    ? null
    : {
        minX,
        maxX,
        width: maxX - minX + 1,
        centerX: (minX + maxX) / 2
      };
}

export function splitBodyIntoRotatableLegs(bodyImage, cfg) {
  const width = Math.round(cfg.bodyWidth ?? bodyImage.naturalWidth ?? bodyImage.width);
  const height = Math.round(cfg.bodyHeight ?? bodyImage.naturalHeight ?? bodyImage.height);
  const sourceCanvas = imageToCanvas(bodyImage, width, height);
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const sourceImageData = sourceCtx.getImageData(0, 0, width, height);

  const shortsGeometry = detectShortsColorGeometry(sourceImageData, cfg);
  const seams = detectShortsLegSeams(sourceImageData, cfg, shortsGeometry);
  const leftMask = floodLegMask(sourceImageData, seams, "left");
  const rightMask = floodLegMask(sourceImageData, seams, "right");

  let overlap = false;
  for (let idx = 0; idx < leftMask.length; idx += 1) {
    if (leftMask[idx] && rightMask[idx]) {
      overlap = true;
      break;
    }
  }
  if (overlap) {
    throw new Error("左右腿掩膜发生重叠，拒绝继续合成");
  }

  const leftAxis = detectLegAxis(leftMask, width, height, cfg);
  const rightAxis = detectLegAxis(rightMask, width, height, cfg);

  const bodyCanvas = partitionCanvas(
    sourceImageData,
    new Uint8Array(width * height),
    [leftMask, rightMask]
  );
  const leftLegCanvas = partitionCanvas(sourceImageData, leftMask);
  const rightLegCanvas = partitionCanvas(sourceImageData, rightMask);


  const leftCount = leftAxis.bounds.count;
  const rightCount = rightAxis.bounds.count;
  const areaBalance =
    Math.min(leftCount, rightCount) /
    Math.max(1, Math.max(leftCount, rightCount));

  return {
    sourceCanvas,
    sourceImageData,
    bodyCanvas,
    leftLegCanvas,
    rightLegCanvas,
    leftMask,
    rightMask,
    width,
    height,
    seams,
    features: {
      centerX: cfg.bodyCenterX ?? width / 2,
      pantsTopY: shortsGeometry.topY,
      shortsTopY: shortsGeometry.topY,
      shortsBottomY: shortsGeometry.bottomY,
      shortsSpan: shortsGeometry.widestSpan,
      shortsCenterX: shortsGeometry.widestCenterX,
      shortsTopSpan: shortsGeometry.topWaistSpan,
      shortsTopCenterX: shortsGeometry.topWaistCenterX,
      shortsTopSampleY: shortsGeometry.topWaistSampleY,
      left: leftAxis,
      right: rightAxis,
      confidence: clamp(seams.confidence * 0.7 + areaBalance * 0.3, 0, 1)
    }
  };
}

function alphaRunsAtRow(data, width, y, threshold = ALPHA_THRESHOLD) {
  const runs = [];
  let start = -1;

  for (let x = 0; x < width; x += 1) {
    const opaque = data[(y * width + x) * 4 + 3] > threshold;
    if (opaque && start < 0) start = x;
    if ((!opaque || x === width - 1) && start >= 0) {
      const end = opaque && x === width - 1 ? x : x - 1;
      runs.push({
        start,
        end,
        width: end - start + 1,
        centerX: (start + end) / 2
      });
      start = -1;
    }
  }

  return runs;
}

function mergeRuns(runs, maxGap) {
  if (!runs.length) return [];
  const out = [{ ...runs[0] }];

  for (let i = 1; i < runs.length; i += 1) {
    const prev = out[out.length - 1];
    const next = runs[i];
    if (next.start - prev.end - 1 <= maxGap) {
      prev.end = next.end;
      prev.width = prev.end - prev.start + 1;
      prev.centerX = (prev.start + prev.end) / 2;
    } else {
      out.push({ ...next });
    }
  }

  return out;
}

function centralTransparentGap(data, width, height, y, centerX) {
  if (y < 0 || y >= height) return null;
  const threshold = ALPHA_THRESHOLD;
  const searchRadius = Math.max(8, Math.floor(width * 0.10));
  const minGapWidth = Math.max(3, Math.floor(width * 0.008));
  const minLegWidth = Math.max(10, Math.floor(width * 0.12));
  const x0 = Math.max(1, Math.floor(centerX - searchRadius));
  const x1 = Math.min(width - 2, Math.ceil(centerX + searchRadius));

  let best = null;
  let start = -1;

  const evaluate = (s, e) => {
    const gapWidth = e - s + 1;
    if (gapWidth < minGapWidth) return;

    let leftOpaque = 0;
    for (let x = s - 1; x >= 0; x -= 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) leftOpaque += 1;
      else if (leftOpaque) break;
    }

    let rightOpaque = 0;
    for (let x = e + 1; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) rightOpaque += 1;
      else if (rightOpaque) break;
    }

    if (leftOpaque < minLegWidth || rightOpaque < minLegWidth) return;

    const mid = (s + e) / 2;
    const dist = Math.abs(mid - centerX);
    if (!best || dist < best.dist || (dist === best.dist && gapWidth > best.width)) {
      best = {
        start: s,
        end: e,
        width: gapWidth,
        centerX: mid,
        dist
      };
    }
  };

  for (let x = x0; x <= x1; x += 1) {
    const transparent = data[(y * width + x) * 4 + 3] <= threshold;
    if (transparent && start < 0) start = x;
    if ((!transparent || x === x1) && start >= 0) {
      const end = transparent && x === x1 ? x : x - 1;
      evaluate(start, end);
      start = -1;
    }
  }

  return best;
}

function detectPantsFeatures(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  const box = alphaBBox(imageData);
  if (!box) throw new Error("未检测到裤子主体");

  const topY = box.y;
  const bottomY = box.y + box.height - 1;
  const centerX = box.x + box.width / 2;

  // Detect the pants' effective top-edge width before looking for the widest
  // waistband row. This is the width that must match the character's waist
  // when the pants are initially placed isotropically.
  const topBandEnd = Math.min(
    bottomY,
    Math.ceil(topY + box.height * 0.05)
  );
  const topRows = [];
  for (let y = topY; y <= topBandEnd; y += 1) {
    const runs = mergeRuns(
      alphaRunsAtRow(data, width, y),
      Math.max(1, width * 0.004)
    );
    if (!runs.length) continue;
    const widest = runs.reduce(
      (best, run) => (!best || run.width > best.width ? run : best),
      null
    );
    topRows.push({ y, ...widest });
  }
  if (!topRows.length) throw new Error("未检测到裤子顶端宽度");
  const topBandMax = Math.max(...topRows.map(row => row.width));
  const firstStableTop =
    topRows.find(row => row.width >= topBandMax * 0.95) ?? topRows[0];
  const topSamples = topRows.filter(row =>
    row.y >= firstStableTop.y &&
    row.y <= firstStableTop.y + 5 &&
    row.width >= topBandMax * 0.92
  );
  const stableTopRows = topSamples.length ? topSamples : [firstStableTop];
  const topWaistSpan = median(stableTopRows.map(row => row.width));
  const topWaistCenterX = median(stableTopRows.map(row => row.centerX));
  const topWaistY = median(stableTopRows.map(row => row.y));

  let waist = null;
  const waistEnd = Math.min(
    bottomY,
    Math.ceil(topY + box.height * 0.13)
  );

  for (let y = topY; y <= waistEnd; y += 1) {
    const runs = mergeRuns(alphaRunsAtRow(data, width, y), Math.max(1, width * 0.004));
    if (!runs.length) continue;
    const widest = runs.reduce((best, run) => (!best || run.width > best.width ? run : best), null);
    if (!waist || widest.width > waist.width) {
      waist = {
        y,
        left: widest.start,
        right: widest.end,
        width: widest.width,
        centerX: widest.centerX
      };
    }
  }

  if (!waist) throw new Error("未检测到裤腰");

  let crotchY = null;
  let crotchGap = null;
  const crotchStart = Math.floor(topY + box.height * 0.16);
  const crotchEnd = Math.floor(topY + box.height * 0.58);
  const persistenceRows = Math.max(6, Math.floor(box.height * 0.018));

  for (let y = crotchStart; y <= crotchEnd; y += 1) {
    const gap = centralTransparentGap(data, width, height, y, waist.centerX);
    if (!gap) continue;

    let hits = 0;
    for (let k = 0; k < persistenceRows; k += 1) {
      if (
        centralTransparentGap(
          data,
          width,
          height,
          Math.min(height - 1, y + k),
          waist.centerX
        )
      ) {
        hits += 1;
      }
    }

    if (hits >= Math.ceil(persistenceRows * 0.75)) {
      crotchY = y;
      crotchGap = gap;
      break;
    }
  }

  if (crotchY == null) {
    throw new Error("未检测到裤裆分叉，无法建立两条裤腿轴线");
  }

  const halfRunAt = (y, side) => {
    const merged = mergeRuns(
      alphaRunsAtRow(data, width, y),
      Math.max(1, Math.floor(width * 0.004))
    );
    const candidates = merged.filter(run =>
      side === "left"
        ? run.centerX < waist.centerX
        : run.centerX > waist.centerX
    );
    if (!candidates.length) return null;
    return candidates.reduce((best, run) => (!best || run.width > best.width ? run : best), null);
  };

  const rootSamples = { left: [], right: [] };
  const rootStart = Math.min(
    bottomY,
    crotchY + Math.max(2, Math.floor(box.height * 0.012))
  );
  const rootEnd = Math.min(
    bottomY,
    rootStart + Math.max(5, Math.floor(box.height * 0.045))
  );

  for (let y = rootStart; y <= rootEnd; y += 1) {
    for (const side of ["left", "right"]) {
      const run = halfRunAt(y, side);
      if (run && run.width >= width * 0.08) {
        rootSamples[side].push({ x: run.centerX, y, width: run.width });
      }
    }
  }

  const ankleSamples = { left: [], right: [] };
  const ankleStart = Math.floor(topY + box.height * 0.90);
  const ankleEnd = Math.min(bottomY, Math.floor(topY + box.height * 0.985));

  for (let y = ankleStart; y <= ankleEnd; y += 1) {
    for (const side of ["left", "right"]) {
      const run = halfRunAt(y, side);
      if (run && run.width >= width * 0.06) {
        ankleSamples[side].push({ x: run.centerX, y, width: run.width });
      }
    }
  }

  const pointFromSamples = (samples, label) => {
    if (samples.length < 3) throw new Error(`未稳定检测到${label}`);
    return {
      x: median(samples.map(p => p.x)),
      y: median(samples.map(p => p.y))
    };
  };

  const leftRoot = pointFromSamples(rootSamples.left, "左裤腿根部中点");
  const rightRoot = pointFromSamples(rootSamples.right, "右裤腿根部中点");
  const leftAnkle = pointFromSamples(ankleSamples.left, "左裤腿脚踝中点");
  const rightAnkle = pointFromSamples(ankleSamples.right, "右裤腿脚踝中点");

  return {
    topY,
    bottomY,
    centerX: waist.centerX,
    waistLeft: waist.left,
    waistRight: waist.right,
    waistSpan: waist.width,
    waistY: waist.y,
    topWaistSpan,
    topWaistCenterX,
    topWaistY,
    crotchY,
    crotchGap,
    leftRoot,
    rightRoot,
    leftAnkle,
    rightAnkle,
    leftAxisAngle: angle(leftRoot, leftAnkle),
    rightAxisAngle: angle(rightRoot, rightAnkle)
  };
}

export async function preparePants(src) {
  if (!src) throw new Error("没有裤子图片");

  const image = await loadImage(src);
  const source = imageToCanvas(image);
  const ctx = source.getContext("2d", { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, source.width, source.height);

  let backgroundCleanup = {
    method: "existing-alpha",
    removedPixels: 0,
    removedRatio: 0,
    clusterCount: 0
  };

  if (!hasUsefulTransparency(id)) {
    backgroundCleanup = removeBorderConnectedBackground(id);

    // Keep the old flat-background routine as a conservative fallback for
    // unusual single-colour photos where the clustered flood removed almost
    // nothing. This is pants-only; the upper-garment path is untouched.
    if (backgroundCleanup.removedRatio < 0.01) {
      removeFlatBackground(id);
      backgroundCleanup = {
        ...backgroundCleanup,
        method: "border-cluster-flood+flat-fallback"
      };
    }

    ctx.putImageData(id, 0, 0);
  }

  const fresh = ctx.getImageData(0, 0, source.width, source.height);
  const box = alphaBBox(fresh);
  if (!box) throw new Error("未检测到裤子主体");

  const cropped = cropCanvas(source, box);
  return {
    canvas: cropped,
    features: detectPantsFeatures(cropped),
    sourceInfo: {
      source: src,
      cropBox: box,
      originalWidth: source.width,
      originalHeight: source.height,
      backgroundCleanup
    }
  };
}

function projectPointAroundPivot(pivot, point, rotation) {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c
  };
}

function transformedPantsPoint(layout, localPoint, scaleY = layout.gScaleY) {
  return {
    x: layout.gxFixed + localPoint.x * layout.gScaleX,
    y: layout.gyForScale(scaleY) + localPoint.y * scaleY
  };
}

export function computePantsLayout(pantsPrepared, legSplit, cfg) {
  if (!pantsPrepared || !legSplit) return null;

  const f = pantsPrepared.features;
  const body = legSplit.features;

  // New first step: while the pants are still isotropic, make their effective
  // top-edge width exactly match the character shorts' top-waist width.
  // Only after this waist fit do we run the existing vertical-compression and
  // physical-leg-rotation stages.
  const bodyTopSpan = Math.max(
    1,
    body.shortsTopSpan ?? body.shortsSpan
  );
  const pantsTopSpan = Math.max(
    1,
    f.topWaistSpan ?? f.waistSpan
  );
  const uniformScale = bodyTopSpan / pantsTopSpan;
  const gScaleX = uniformScale;

  const bodyTopCenterX =
    body.shortsTopCenterX ?? body.shortsCenterX ?? body.centerX;
  const pantsTopCenterX =
    f.topWaistCenterX ?? f.centerX;
  const gxFixed = bodyTopCenterX - pantsTopCenterX * gScaleX;

  const topWorldY = body.pantsTopY;

  // Mirror the upper-garment algorithm: start from an isotropic placement
  // (scaleY === scaleX), then only shorten the vertical axis if a pants ankle
  // lies outside the rigid body-leg rotation circle.
  const initialScaleY = gScaleX;

  const layout = {
    pantsPrepared,
    gc: pantsPrepared.canvas,
    f,
    gScaleX,
    gScaleY: initialScaleY,
    initialScaleY,
    uniformScale,
    topWorldY,
    gxFixed,
    topWidthFit: {
      bodySpan: bodyTopSpan,
      pantsLocalSpan: pantsTopSpan,
      pantsWorldSpan: pantsTopSpan * gScaleX,
      error: Math.abs(bodyTopSpan - pantsTopSpan * gScaleX),
      bodyCenterX: bodyTopCenterX,
      pantsWorldCenterX: gxFixed + pantsTopCenterX * gScaleX
    },
    gyForScale(scaleY) {
      // Keep the literal topmost pants pixel locked to the detected visible
      // top edge of the male shorts, including after vertical compression.
      return topWorldY - f.topY * scaleY;
    }
  };

  const anchors = scaleY => {
    const gy = layout.gyForScale(scaleY);
    return {
      gx: gxFixed,
      gy,
      leftRoot: transformedPantsPoint(layout, f.leftRoot, scaleY),
      rightRoot: transformedPantsPoint(layout, f.rightRoot, scaleY),
      leftAnkle: transformedPantsPoint(layout, f.leftAnkle, scaleY),
      rightAnkle: transformedPantsPoint(layout, f.rightAnkle, scaleY)
    };
  };

  layout.anchors = anchors;
  layout.G = anchors(layout.gScaleY);

  const maxLegRotation = cfg.maxLegRotation ?? 0.38;

  const initialPoseForSide = side => {
    const bodyLeg = body[side];
    const root = side === "left" ? layout.G.leftRoot : layout.G.rightRoot;
    const ankle = side === "left" ? layout.G.leftAnkle : layout.G.rightAnkle;
    const garmentAxis = angle(root, ankle);

    const rotation = clamp(
      angleDelta(garmentAxis, bodyLeg.restAngle),
      -maxLegRotation,
      maxLegRotation
    );

    const projectedAnkle = projectPointAroundPivot(
      bodyLeg.thigh,
      bodyLeg.ankle,
      rotation
    );

    return { rotation, projectedAnkle };
  };

  const initialLeft = initialPoseForSide("left");
  const initialRight = initialPoseForSide("right");

  const scaleYForAnkleOnCircle = (side, localAnkle) => {
    const bodyLeg = body[side];
    const targetX = gxFixed + localAnkle.x * gScaleX;
    const dx = targetX - bodyLeg.thigh.x;
    const r2 = bodyLeg.radius * bodyLeg.radius;

    if (dx * dx >= r2) return null;

    const targetY =
      bodyLeg.thigh.y +
      Math.sqrt(Math.max(0, r2 - dx * dx));

    const denom = localAnkle.y - f.topY;
    if (Math.abs(denom) < 1e-6) return null;

    return (targetY - topWorldY) / denom;
  };

  const compressEpsilon = cfg.pantsCompressEpsilon ?? 0.0001;
  const minVerticalRatio = cfg.pantsMinVerticalRatio ?? 0.78;
  let allowedScaleY = layout.gScaleY;

  const leftNeedsCompress =
    layout.G.leftAnkle.y >
    initialLeft.projectedAnkle.y + 0.5;
  const rightNeedsCompress =
    layout.G.rightAnkle.y >
    initialRight.projectedAnkle.y + 0.5;

  if (leftNeedsCompress) {
    const target = scaleYForAnkleOnCircle("left", f.leftAnkle);
    if (Number.isFinite(target)) {
      allowedScaleY = Math.min(allowedScaleY, target);
    }
  }

  if (rightNeedsCompress) {
    const target = scaleYForAnkleOnCircle("right", f.rightAnkle);
    if (Number.isFinite(target)) {
      allowedScaleY = Math.min(allowedScaleY, target);
    }
  }

  const minAllowed = layout.gScaleX * minVerticalRatio;
  allowedScaleY = Math.max(
    minAllowed,
    Math.min(layout.gScaleY, allowedScaleY)
  );

  if (allowedScaleY < layout.gScaleY - compressEpsilon) {
    layout.gScaleY = allowedScaleY;
    layout.G = anchors(layout.gScaleY);
  }

  const finalRotationForSide = side => {
    const bodyLeg = body[side];
    const ankle = side === "left" ? layout.G.leftAnkle : layout.G.rightAnkle;
    return clamp(
      angleDelta(
        angle(bodyLeg.thigh, ankle),
        bodyLeg.restAngle
      ),
      -maxLegRotation,
      maxLegRotation
    );
  };

  layout.initialPose = {
    left: initialLeft.rotation,
    right: initialRight.rotation
  };
  layout.finalPose = {
    left: finalRotationForSide("left"),
    right: finalRotationForSide("right")
  };
  layout.compressed =
    layout.gScaleY < layout.initialScaleY - compressEpsilon;
  layout.compressionRatio =
    layout.gScaleY / Math.max(1e-6, layout.initialScaleY);

  const rotatedBodyAnkle = (side, rotation) =>
    projectPointAroundPivot(
      body[side].thigh,
      body[side].ankle,
      rotation
    );

  const leftBodyAnkle = rotatedBodyAnkle("left", layout.finalPose.left);
  const rightBodyAnkle = rotatedBodyAnkle("right", layout.finalPose.right);
  layout.alignmentError = {
    left: Math.hypot(
      leftBodyAnkle.x - layout.G.leftAnkle.x,
      leftBodyAnkle.y - layout.G.leftAnkle.y
    ),
    right: Math.hypot(
      rightBodyAnkle.x - layout.G.rightAnkle.x,
      rightBodyAnkle.y - layout.G.rightAnkle.y
    )
  };

  return layout;
}

function drawRotatedFullSizeLayer(ctx, layer, pivot, rotation) {
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(rotation);
  ctx.translate(-pivot.x, -pivot.y);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

export function drawSplitBody(ctx, legSplit, pose = null) {
  if (!legSplit) return;

  const leftRotation = pose?.left ?? 0;
  const rightRotation = pose?.right ?? 0;

  // Legs first, then the body/shorts mask. This lets the shorts hem cover the
  // rotated upper-leg seam naturally while all source pixels remain in place.
  drawRotatedFullSizeLayer(
    ctx,
    legSplit.leftLegCanvas,
    legSplit.features.left.thigh,
    leftRotation
  );
  drawRotatedFullSizeLayer(
    ctx,
    legSplit.rightLegCanvas,
    legSplit.features.right.thigh,
    rightRotation
  );
  ctx.drawImage(legSplit.bodyCanvas, 0, 0);
}

export function drawPantsLayer(ctx, layout) {
  if (!layout) return;
  ctx.drawImage(
    layout.gc,
    layout.G.gx,
    layout.G.gy,
    layout.gc.width * layout.gScaleX,
    layout.gc.height * layout.gScaleY
  );
}

export function verifyLegSplit(legSplit) {
  if (!legSplit) return null;

  const {
    sourceImageData,
    bodyCanvas,
    leftLegCanvas,
    rightLegCanvas,
    leftMask,
    rightMask,
    width,
    height
  } = legSplit;

  const size = width * height;
  let overlapPixels = 0;
  let leftPixels = 0;
  let rightPixels = 0;
  let sourceOpaquePixels = 0;

  for (let idx = 0; idx < size; idx += 1) {
    if (leftMask[idx]) leftPixels += 1;
    if (rightMask[idx]) rightPixels += 1;
    if (leftMask[idx] && rightMask[idx]) overlapPixels += 1;
    if (sourceImageData.data[idx * 4 + 3] > ALPHA_THRESHOLD) {
      sourceOpaquePixels += 1;
    }
  }

  const reconstructed = makeCanvas(width, height);
  const rctx = reconstructed.getContext("2d", { willReadFrequently: true });
  rctx.drawImage(bodyCanvas, 0, 0);
  rctx.drawImage(leftLegCanvas, 0, 0);
  rctx.drawImage(rightLegCanvas, 0, 0);
  const rebuilt = rctx.getImageData(0, 0, width, height).data;
  const original = sourceImageData.data;

  let changedPixels = 0;
  let maxChannelDiff = 0;
  let totalChannelDiff = 0;

  for (let idx = 0; idx < size; idx += 1) {
    let pixelChanged = false;
    const base = idx * 4;
    for (let k = 0; k < 4; k += 1) {
      const diff = Math.abs(original[base + k] - rebuilt[base + k]);
      if (diff) pixelChanged = true;
      if (diff > maxChannelDiff) maxChannelDiff = diff;
      totalChannelDiff += diff;
    }
    if (pixelChanged) changedPixels += 1;
  }

  const partitionExact = overlapPixels === 0 && changedPixels === 0;

  return {
    partitionExact,
    overlapPixels,
    changedPixels,
    maxChannelDiff,
    meanChannelDiff: totalChannelDiff / Math.max(1, size * 4),
    leftPixels,
    rightPixels,
    sourceOpaquePixels,
    confidence: legSplit.features.confidence
  };
}

export function recomposeSplitBody(legSplit) {
  if (!legSplit) return null;
  const canvas = makeCanvas(legSplit.width, legSplit.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(legSplit.bodyCanvas, 0, 0);
  ctx.drawImage(legSplit.leftLegCanvas, 0, 0);
  ctx.drawImage(legSplit.rightLegCanvas, 0, 0);
  return canvas;
}

function drawAxis(ctx, from, to, color, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  for (const p of [from, to]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,.96)";
    ctx.stroke();
    ctx.strokeStyle = color;
  }

  if (label) {
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(label, from.x + 12, from.y - 10);
  }
  ctx.restore();
}

export function drawPantsDebugOverlay(ctx, legSplit, layout) {
  if (!ctx || !legSplit) return;

  const body = legSplit.features;
  drawAxis(
    ctx,
    body.left.thigh,
    body.left.ankle,
    "rgba(0,132,255,.96)",
    "body L"
  );
  drawAxis(
    ctx,
    body.right.thigh,
    body.right.ankle,
    "rgba(0,132,255,.96)",
    "body R"
  );

  if (!layout) return;
  drawAxis(
    ctx,
    layout.G.leftRoot,
    layout.G.leftAnkle,
    "rgba(255,85,0,.96)",
    "pants L"
  );
  drawAxis(
    ctx,
    layout.G.rightRoot,
    layout.G.rightAnkle,
    "rgba(255,85,0,.96)",
    "pants R"
  );
}

export function pantsDebugGeometry(legSplit, layout) {
  if (!legSplit) return null;
  return {
    body: {
      left: {
        thigh: legSplit.features.left.thigh,
        ankle: legSplit.features.left.ankle
      },
      right: {
        thigh: legSplit.features.right.thigh,
        ankle: legSplit.features.right.ankle
      }
    },
    pants: layout
      ? {
          left: {
            root: layout.G.leftRoot,
            ankle: layout.G.leftAnkle
          },
          right: {
            root: layout.G.rightRoot,
            ankle: layout.G.rightAnkle
          },
          scaleX: layout.gScaleX,
          initialScaleY: layout.initialScaleY,
          finalScaleY: layout.gScaleY,
          compressionRatio: layout.compressionRatio,
          uniformScale: layout.uniformScale,
          topWidthFit: layout.topWidthFit,
          finalPose: layout.finalPose,
          topWorldY: layout.topWorldY,
          alignmentError: layout.alignmentError
        }
      : null
  };
}
