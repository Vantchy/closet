import {
  splitBodyIntoRotatableLegs,
  preparePants,
  computePantsLayout,
  drawSplitBody,
  drawPantsLayer,
  verifyLegSplit,
  pantsDebugGeometry,
  drawPantsDebugOverlay,
  recomposeSplitBody
} from "./pantsTryOn2d.js";

const MALE_REFERENCE = {
  width: 887,
  height: 1774
};

const FEMALE_REFERENCE = {
  width: 682,
  height: 2048
};

// Male configuration = tuned v5.13 geometry from the earlier prototype.
const MALE_CFG = {
  bodyWidth: 887,
  bodyHeight: 1774,
  shoulderLeft: { x: 293, y: 548 },
  shoulderRight: { x: 594, y: 548 },
  shoulderMidY: 438,
  shortsTopY: 990,
  bodyCenterX: 443.5,
  leftArmPivot: { x: 247, y: 96 },
  rightArmPivot: { x: 67, y: 96 },
  armScaleFactor: 0.48,
  rightArmScaleBias: 0.97,
  armInsetX: 24,
  leftArmExtraInsetX: 8,
  armAxisOutwardShiftPx: 8,
  armPostAlignArcNudgePx: 8,
  garmentTopDropPx: 14,
  garmentShoulderPadPx: 18,
  garmentTorsoCoverFactor: 1.03,
  garmentScaleNudge: 1.03,
  garmentMinVerticalRatio: 0.84,
  garmentCompressEpsilon: 0.0001,
  frontNeckBodyOverlapPx: 1.5,
  maxArmRotation: 0.62,
  horizontalCanvasOverscanRatio: 0.316798196,

  // Pants-only geometry. These fields are never read by the upper-body path.
  pantsThighMidRatio: 0.26,
  pantsMinVerticalRatio: 0.78,
  pantsCompressEpsilon: 0.0001,
  maxLegRotation: 0.38
};

// Female configuration rebuilt from the supplied split assets.
const FEMALE_CFG = {
  bodyWidth: 682,
  bodyHeight: 2048,

  // These two points continue to drive garment shoulder-width alignment.
  shoulderLeft: { x: 246, y: 615 },
  shoulderRight: { x: 437, y: 615 },
  shoulderMidY: 506,
  shortsTopY: 1143,
  bodyCenterX: 341.0,

  // v8: arm attachment is calibrated independently from garment shoulder width.
  armAttachLeft: { x: 173.36, y: 705.21 },
  armAttachRight: { x: 514.64, y: 693.21 },

  // Manual axis start acts as the actual rotation pivot for the split arm image.
  leftArmPivot: { x: 316.81, y: 250.0 },
  rightArmPivot: { x: 342.37, y: 250.0 },

  // The two supplied arm images are not the same native scale.
  // Use independently calibrated scales instead of forcing symmetry.
  armScaleFactor: 0.397964,
  leftArmScaleFactor: 0.444753,
  rightArmScaleFactor: 0.444753,
  rightArmScaleBias: 1,

  armInsetX: 0,
  leftArmExtraInsetX: 0,
  armAxisOutwardShiftPx: 0,
  armPostAlignArcNudgePx: 10,

  garmentTopDropPx: 15,
  garmentShoulderPadPx: 14,
  garmentTorsoCoverFactor: 1.03,
  garmentScaleNudge: 1.03,
  garmentMinVerticalRatio: 0.84,
  garmentCompressEpsilon: 0.0001,
  frontNeckBodyOverlapPx: 1.8,
  maxArmRotation: 0.62,
  horizontalCanvasOverscanRatio: 0.541055718,

  // Attach the approved arm-axis top point directly to the calibrated body point.
  attachArmPivotDirectly: true,

  // v8: runtime uses the approved contour-fitted axes directly.
  manualArmGeometry: {
    left: {
      topAnchor: { x: 316.81, y: 250.0 },
      wristPoint: { x: 158.85, y: 1101.0 },
      width: 173.06
    },
    right: {
      topAnchor: { x: 342.37, y: 250.0 },
      wristPoint: { x: 496.24, y: 1082.0 },
      width: 171.12
    }
  }
};

const FEMALE_DEBUG_GEOMETRY = {
  bodyCenterX: 0.500000,

  // garment/body shoulder reference
  shoulderLeft: { x: 0.360704, y: 0.300293 },
  shoulderRight: { x: 0.640762, y: 0.300293 },

  // actual arm-axis attachment points
  leftArmTop: { x: 0.254194, y: 0.344341 },
  rightArmTop: { x: 0.754604, y: 0.338481 },

  // natural reference wrist positions for visual calibration
  leftWrist: { x: 0.180674, y: 0.520020 },
  rightWrist: { x: 0.854947, y: 0.519162 }
};

const MALE_ASSETS = {
  body: new URL("../../assets/tryon2d/body.png", import.meta.url).href,
  leftArm: new URL("../../assets/tryon2d/left_arm.png", import.meta.url).href,
  rightArm: new URL("../../assets/tryon2d/right_arm.png", import.meta.url).href
};

const FEMALE_ASSETS = {
  body: new URL("../../assets/tryon2d/female_body.png", import.meta.url).href,
  leftArm: new URL("../../assets/tryon2d/female_left_arm.png", import.meta.url).href,
  rightArm: new URL("../../assets/tryon2d/female_right_arm.png", import.meta.url).href
};

let ACTIVE_REFERENCE = MALE_REFERENCE;
let ACTIVE_CFG = MALE_CFG;

function getSceneSpec(gender) {
  return gender === "female"
    ? {
        key: "female",
        reference: FEMALE_REFERENCE,
        cfg: FEMALE_CFG,
        assets: FEMALE_ASSETS,
        debugGeometry: FEMALE_DEBUG_GEOMETRY
      }
    : {
        key: "male",
        reference: MALE_REFERENCE,
        cfg: MALE_CFG,
        assets: MALE_ASSETS,
        debugGeometry: null
      };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function imageToReadableCanvas(img) {
  const c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
}

function horizontalRenderPadPx() {
  return Math.round(
    ACTIVE_REFERENCE.width *
    (ACTIVE_CFG.horizontalCanvasOverscanRatio || 0)
  );
}

function expandedRenderWidth() {
  return (
    ACTIVE_REFERENCE.width +
    horizontalRenderPadPx() * 2
  );
}

function hasUsefulTransparency(imageData) {
  const d = imageData.data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 16) {
    if (d[i] < 220) transparent += 1;
  }
  return transparent > 20;
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

  const med = k => {
    const a = samples.map(p => p[k]).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };

  const bg = [med(0), med(1), med(2)];
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < 24) data[i + 3] = 0;
  }
}

function alphaBBox(imageData, threshold = 12) {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  return maxX < 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropCanvas(src, box) {
  const out = makeCanvas(box.width, box.height);
  out
    .getContext("2d")
    .drawImage(
      src,
      box.x,
      box.y,
      box.width,
      box.height,
      0,
      0,
      box.width,
      box.height
    );
  return out;
}

function findGarmentFeatures(c, sourceInfo = {}) {
  const w = c.width;
  const h = c.height;
  const d = c
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, w, h).data;
  const alphaThreshold = 20;
  const a = (x, y) => d[(y * w + x) * 4 + 3];

  const top = new Array(w).fill(null);
  const bottom = new Array(w).fill(null);

  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      if (a(x, y) > alphaThreshold) {
        top[x] = y;
        break;
      }
    }
    for (let y = h - 1; y >= 0; y -= 1) {
      if (a(x, y) > alphaThreshold) {
        bottom[x] = y;
        break;
      }
    }
  }

  const cb = [];
  for (let x = Math.floor(w * 0.22); x < Math.ceil(w * 0.78); x += 1) {
    if (bottom[x] != null) cb.push(bottom[x]);
  }
  cb.sort((p, q) => p - q);

  const hemY = cb.length ? cb[Math.floor(cb.length * 0.58)] : Math.floor(h * 0.76);
  const tol = Math.max(4, h * 0.015);
  const hx = [];

  for (let x = Math.floor(w * 0.18); x < Math.ceil(w * 0.82); x += 1) {
    if (bottom[x] != null && Math.abs(bottom[x] - hemY) <= tol) hx.push(x);
  }

  const hemLeft = hx.length ? Math.min(...hx) : Math.floor(w * 0.28);
  const hemRight = hx.length ? Math.max(...hx) : Math.floor(w * 0.72);
  const centerX = (hemLeft + hemRight) / 2;

  const visibleLeft = top.findIndex(v => v != null);
  let visibleRight = w - 1;
  while (visibleRight > 0 && top[visibleRight] == null) visibleRight -= 1;

  const ct = [];
  for (let x = Math.floor(w * 0.36); x < Math.ceil(w * 0.64); x += 1) {
    if (top[x] != null) ct.push(top[x]);
  }
  ct.sort((p, q) => p - q);

  const collarY = ct.length
    ? ct[Math.max(0, Math.floor(ct.length * 0.18) - 1)]
    : Math.floor(h * 0.06);

  const shoulderBandTop = Math.floor(h * 0.03);
  const shoulderBandBottom = Math.max(shoulderBandTop + 2, Math.floor(h * 0.24));

  function upperMostOpaqueInBand(x0, x1) {
    let best = null;
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) {
      for (let y = shoulderBandTop; y < shoulderBandBottom; y += 1) {
        if (a(x, y) > alphaThreshold) {
          if (best === null || y < best.y || (y === best.y && x < best.x)) {
            best = { x, y };
          }
          break;
        }
      }
    }
    return best;
  }

  const leftShoulder =
    upperMostOpaqueInBand(Math.floor(w * 0.06), Math.floor(w * 0.40)) || {
      x: Math.floor(w * 0.24),
      y: Math.floor(collarY + h * 0.08)
    };

  const rightShoulder =
    upperMostOpaqueInBand(Math.floor(w * 0.60), Math.floor(w * 0.94)) || {
      x: Math.floor(w * 0.76),
      y: Math.floor(collarY + h * 0.08)
    };

  function smoothCurve(points, radius = 2) {
    if (!points?.length) return [];
    return points.map((p, i) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      const i0 = Math.max(0, i - radius);
      const i1 = Math.min(points.length - 1, i + radius);
      for (let j = i0; j <= i1; j += 1) {
        sx += points[j].x;
        sy += points[j].y;
        n += 1;
      }
      return { x: sx / n, y: sy / n };
    });
  }

  function decimateCurve(points, maxPoints = 28) {
    if (!points?.length || points.length <= maxPoints) return points ?? [];
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const index = Math.round((points.length - 1) * (i / (maxPoints - 1)));
      out.push(points[index]);
    }
    return out;
  }

  // v3 front-neckline detector:
  // Treat the visible "inside of the neck opening" as a region enclosed by
  // dark/strong contour lines. Flood-fill candidate regions around the upper
  // center of the garment, then use the LOWER boundary of the best region as
  // the front neckline. This handles round necks, V-necks, shirt collars and
  // hoodies much better than trying to follow one dark line directly.
  function detectFloodFrontNeckline() {
    const rx0 = Math.max(1, Math.floor(w * 0.18));
    const rx1 = Math.min(w - 1, Math.ceil(w * 0.82));
    const ry1 = Math.min(h - 1, Math.ceil(h * 0.36));
    const rw = rx1 - rx0;
    const rh = ry1;

    if (rw < 40 || rh < 40) return null;

    const size = rw * rh;
    const gray = new Float32Array(size);
    const opaque = new Uint8Array(size);

    const localIndex = (lx, ly) => ly * rw + lx;

    for (let ly = 0; ly < rh; ly += 1) {
      const y = ly;
      for (let lx = 0; lx < rw; lx += 1) {
        const x = rx0 + lx;
        const i = (y * w + x) * 4;
        const idx = localIndex(lx, ly);

        opaque[idx] = d[i + 3] > alphaThreshold ? 1 : 0;
        gray[idx] =
          d[i] * 0.299 +
          d[i + 1] * 0.587 +
          d[i + 2] * 0.114;
      }
    }

    const barrier = new Uint8Array(size);
    const darkThreshold = 155;
    const gradientThreshold = 150;

    for (let ly = 0; ly < rh; ly += 1) {
      for (let lx = 0; lx < rw; lx += 1) {
        const idx = localIndex(lx, ly);

        if (!opaque[idx]) {
          barrier[idx] = 1;
          continue;
        }

        const lx0 = Math.max(0, lx - 1);
        const lx1 = Math.min(rw - 1, lx + 1);
        const ly0 = Math.max(0, ly - 1);
        const ly1 = Math.min(rh - 1, ly + 1);

        const gx =
          gray[localIndex(lx1, ly)] -
          gray[localIndex(lx0, ly)];

        const gy =
          gray[localIndex(lx, ly1)] -
          gray[localIndex(lx, ly0)];

        const gradient = Math.hypot(gx, gy);

        if (gray[idx] < darkThreshold || gradient > gradientThreshold) {
          barrier[idx] = 1;
        }
      }
    }

    // Seal tiny anti-aliasing gaps in the drawn contour.
    const sealed = barrier.slice();

    for (let ly = 0; ly < rh; ly += 1) {
      for (let lx = 0; lx < rw; lx += 1) {
        const idx = localIndex(lx, ly);
        if (!barrier[idx]) continue;

        for (let oy = -1; oy <= 1; oy += 1) {
          const yy = ly + oy;
          if (yy < 0 || yy >= rh) continue;

          for (let ox = -1; ox <= 1; ox += 1) {
            const xx = lx + ox;
            if (xx < 0 || xx >= rw) continue;
            sealed[localIndex(xx, yy)] = 1;
          }
        }
      }
    }

    // Label every open region in the upper-center ROI once.
    const labels = new Int32Array(size);
    const queue = new Int32Array(size);
    const components = [null];
    let nextLabel = 1;

    for (let start = 0; start < size; start += 1) {
      if (sealed[start] || labels[start]) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      labels[start] = nextLabel;

      let area = 0;
      let minX = rw;
      let maxX = -1;
      let minY = rh;
      let maxY = -1;

      while (head < tail) {
        const idx = queue[head++];
        const ly = Math.floor(idx / rw);
        const lx = idx - ly * rw;

        area += 1;
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;

        if (lx > 0) {
          const n = idx - 1;
          if (!sealed[n] && !labels[n]) {
            labels[n] = nextLabel;
            queue[tail++] = n;
          }
        }

        if (lx + 1 < rw) {
          const n = idx + 1;
          if (!sealed[n] && !labels[n]) {
            labels[n] = nextLabel;
            queue[tail++] = n;
          }
        }

        if (ly > 0) {
          const n = idx - rw;
          if (!sealed[n] && !labels[n]) {
            labels[n] = nextLabel;
            queue[tail++] = n;
          }
        }

        if (ly + 1 < rh) {
          const n = idx + rw;
          if (!sealed[n] && !labels[n]) {
            labels[n] = nextLabel;
            queue[tail++] = n;
          }
        }
      }

      components[nextLabel] = {
        label: nextLabel,
        area,
        minX,
        maxX,
        minY,
        maxY
      };

      nextLabel += 1;
    }

    const centerLocalX = clamp(
      Math.round(centerX - rx0),
      0,
      rw - 1
    );

    function nearestLabelForSeed(seedFraction) {
      const targetY = clamp(
        Math.round(h * seedFraction),
        0,
        rh - 1
      );

      const radii = [6, 12, 20, 35, 60];

      for (const radius of radii) {
        let best = null;

        for (let dy = -radius; dy <= radius; dy += 1) {
          const yy = targetY + dy;
          if (yy < 0 || yy >= rh) continue;

          for (let dx = -radius; dx <= radius; dx += 1) {
            const xx = centerLocalX + dx;
            if (xx < 0 || xx >= rw) continue;

            const label = labels[localIndex(xx, yy)];
            if (!label) continue;

            const cost = Math.abs(dy) + Math.abs(dx) * 0.2;

            if (!best || cost < best.cost) {
              best = { label, cost };
            }
          }
        }

        if (best) return best.label;
      }

      return 0;
    }

    function median(values) {
      if (!values.length) return null;
      const copy = values.slice().sort((m, n) => m - n);
      const middle = Math.floor(copy.length / 2);
      return copy.length % 2
        ? copy[middle]
        : (copy[middle - 1] + copy[middle]) / 2;
    }

    function percentile(values, q) {
      if (!values.length) return null;
      const copy = values.slice().sort((m, n) => m - n);
      const index = clamp(
        Math.round((copy.length - 1) * q),
        0,
        copy.length - 1
      );
      return copy[index];
    }

    const seedFractions = [
      0.06, 0.07, 0.08, 0.09, 0.10, 0.11,
      0.12, 0.13, 0.14, 0.15, 0.16, 0.17,
      0.18, 0.20, 0.22
    ];

    const seenLabels = new Set();
    const candidates = [];

    for (const seedFraction of seedFractions) {
      const label = nearestLabelForSeed(seedFraction);
      if (!label || seenLabels.has(label)) continue;
      seenLabels.add(label);

      const component = components[label];
      if (!component) continue;

      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const areaRatio = component.area / Math.max(1, w * h);
      const widthRatio = boxWidth / Math.max(1, w);
      const topRatio = component.minY / Math.max(1, h);

      const centerBottoms = [];
      const centerHalf = Math.max(2, Math.round(w * 0.02));

      const centerX0 = clamp(
        centerLocalX - centerHalf,
        component.minX,
        component.maxX
      );

      const centerX1 = clamp(
        centerLocalX + centerHalf,
        component.minX,
        component.maxX
      );

      for (let lx = centerX0; lx <= centerX1; lx += 1) {
        for (let ly = component.maxY; ly >= component.minY; ly -= 1) {
          if (labels[localIndex(lx, ly)] === label) {
            centerBottoms.push(ly);
            break;
          }
        }
      }

      const centerBottom = median(centerBottoms);
      if (centerBottom == null) continue;

      const bottomRatio = centerBottom / Math.max(1, h);

      const valid =
        areaRatio >= 0.004 &&
        areaRatio <= 0.075 &&
        widthRatio >= 0.14 &&
        widthRatio <= 0.58 &&
        bottomRatio >= 0.09 &&
        bottomRatio <= 0.32 &&
        boxHeight / h <= 0.30 &&
        topRatio <= 0.18;

      if (!valid) continue;

      // Across the tested round-neck, V-neck, shirt-collar and hoodie images,
      // the true neck-opening region is usually about 18%-26% of garment width.
      // Favor that range while still considering how deep the front opening is.
      const score =
        bottomRatio * 3.0 -
        Math.abs(widthRatio - 0.235) * 3.2 +
        Math.min(areaRatio * 3.0, 0.12);

      candidates.push({
        label,
        component,
        score,
        areaRatio,
        widthRatio,
        bottomRatio
      });
    }

    if (!candidates.length) return null;

    candidates.sort((m, n) => n.score - m.score);
    const best = candidates[0];

    if (!(best.score > 0.24)) return null;

    const { component, label } = best;
    const raw = [];

    // For every x inside the selected opening region, take the lowest pixel.
    // That lower envelope is the FRONT neckline.
    for (let lx = component.minX; lx <= component.maxX; lx += 1) {
      let foundY = null;

      for (let ly = component.maxY; ly >= component.minY; ly -= 1) {
        if (labels[localIndex(lx, ly)] === label) {
          foundY = ly;
          break;
        }
      }

      if (foundY != null) {
        raw.push({
          x: rx0 + lx,
          y: foundY
        });
      }
    }

    if (raw.length < 18) return null;

    // Median smoothing removes one-pixel line-art noise without changing
    // the neckline type (round / V / collar / hood).
    const med = raw.map((p, i) => {
      const values = [];
      const i0 = Math.max(0, i - 5);
      const i1 = Math.min(raw.length - 1, i + 5);

      for (let j = i0; j <= i1; j += 1) {
        values.push(raw[j].y);
      }

      return {
        x: p.x,
        y: median(values)
      };
    });

    const yValues = med.map(p => p.y);
    const baseline = percentile(yValues, 0.15);
    const deepest = percentile(yValues, 0.98);

    if (baseline == null || deepest == null) return null;

    const depth = deepest - baseline;
    if (!(depth > Math.max(4, h * 0.018))) return null;

    // Strip away the upper/back collar edge if it is part of the same region.
    // Keep the contiguous lower segment containing the deepest point.
    const threshold = baseline + depth * 0.12;

    let peak = 0;
    for (let i = 1; i < med.length; i += 1) {
      if (med[i].y > med[peak].y) peak = i;
    }

    let left = peak;
    let right = peak;

    while (left > 0 && med[left - 1].y >= threshold) left -= 1;
    while (
      right + 1 < med.length &&
      med[right + 1].y >= threshold
    ) {
      right += 1;
    }

    let points = med.slice(left, right + 1);
    points = smoothCurve(points, 2);
    points = decimateCurve(points, 36);

    if (points.length < 6) return null;

    const span = points[points.length - 1].x - points[0].x;
    if (span < w * 0.07) return null;

    return {
      points,
      confidence: clamp(0.62 + best.score * 0.30, 0, 0.98),
      source: "opening-region"
    };
  }

  // Transparent / cut-out necklines:
  // For each central column, take the deepest transparent -> opaque transition
  // in the upper part of the garment. If the center is substantially deeper
  // than the nearby collar/shoulder top, that transition is the front neckline.
  function detectAlphaFrontNeckline() {
    const x0 = Math.max(1, Math.floor(centerX - w * 0.22));
    const x1 = Math.min(w - 2, Math.ceil(centerX + w * 0.22));
    const yMax = Math.min(h - 2, Math.ceil(h * 0.34));
    const samples = [];

    for (let x = x0; x <= x1; x += 1) {
      let lastTransition = null;
      let transparentRun = 0;

      for (let y = 1; y <= yMax; y += 1) {
        if (a(x, y - 1) <= alphaThreshold) transparentRun += 1;
        else transparentRun = 0;

        if (
          a(x, y) > alphaThreshold &&
          a(x, y - 1) <= alphaThreshold &&
          transparentRun >= 2
        ) {
          lastTransition = y;
        }
      }

      if (lastTransition != null) {
        samples.push({ x, y: lastTransition });
      }
    }

    if (samples.length < Math.max(12, (x1 - x0) * 0.25)) return null;

    const smooth = smoothCurve(samples, 3);
    const centerBand = smooth.filter(p => Math.abs(p.x - centerX) <= w * 0.11);
    if (!centerBand.length) return null;

    let deepest = centerBand[0];
    for (const p of centerBand) {
      if (p.y > deepest.y) deepest = p;
    }

    const sortedY = smooth.map(p => p.y).sort((m, n) => m - n);
    const baseline = sortedY[Math.floor(sortedY.length * 0.22)];
    const depth = deepest.y - baseline;
    const minDepth = Math.max(6, h * 0.025);

    if (!(depth > minDepth)) return null;

    const threshold = baseline + depth * 0.22;
    let deepestIndex = smooth.findIndex(p => p === deepest);
    if (deepestIndex < 0) {
      deepestIndex = smooth.reduce(
        (best, p, i) => (p.y > smooth[best].y ? i : best),
        0
      );
    }

    let left = deepestIndex;
    let right = deepestIndex;

    while (left > 0 && smooth[left].y > threshold) left -= 1;
    while (right < smooth.length - 1 && smooth[right].y > threshold) right += 1;

    if (smooth[right].x - smooth[left].x < w * 0.055) return null;

    const points = decimateCurve(
      smoothCurve(smooth.slice(left, right + 1), 2),
      26
    );

    return {
      points,
      confidence: clamp(depth / Math.max(1, h * 0.11), 0, 1),
      source: "alpha"
    };
  }

  function luminanceAt(x, y) {
    x = clamp(Math.round(x), 0, w - 1);
    y = clamp(Math.round(y), 0, h - 1);
    const i = (y * w + x) * 4;
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  function edgeStrengthAt(x, y) {
    if (x <= 1 || x >= w - 2 || y <= 1 || y >= h - 2) return 0;
    if (a(x, y) <= alphaThreshold) return 0;

    const gx = luminanceAt(x + 1, y) - luminanceAt(x - 1, y);
    const gy = luminanceAt(x, y + 1) - luminanceAt(x, y - 1);
    const l = luminanceAt(x, y);

    // Internal collar outlines are usually both locally dark and high-gradient.
    return Math.hypot(gx, gy) + Math.max(0, 205 - l) * 0.20;
  }

  // Internal painted collar lines are not alpha boundaries.
  // Use a geometry-guided edge trace in the upper-center ROI as a fallback.
  function detectEdgeFrontNeckline() {
    const half = Math.max(w * 0.10, (rightShoulder.x - leftShoulder.x) * 0.22);
    const x0 = Math.max(2, Math.floor(centerX - half));
    const x1 = Math.min(w - 3, Math.ceil(centerX + half));
    const topY = Math.max(2, Math.floor(Math.max(collarY, h * 0.035)));
    const bottomY = Math.min(h - 3, Math.ceil(h * 0.245));
    const edgeY = Math.max(topY + 1, Math.floor(collarY + h * 0.020));
    const apexY = Math.min(bottomY - 1, Math.floor(collarY + h * 0.165));

    if (x1 - x0 < 20 || bottomY - topY < 20) return null;

    const raw = [];
    const step = Math.max(2, Math.round(w / 260));

    for (let x = x0; x <= x1; x += step) {
      const t = Math.abs((x - centerX) / Math.max(1, half));
      const expectedY =
        edgeY + (apexY - edgeY) * Math.pow(Math.max(0, 1 - t), 1.15);

      const searchHalf = Math.max(8, Math.round(h * 0.045));
      const y0 = Math.max(topY, Math.floor(expectedY - searchHalf));
      const y1 = Math.min(bottomY, Math.ceil(expectedY + searchHalf));

      let bestY = null;
      let bestScore = -Infinity;

      for (let y = y0; y <= y1; y += 1) {
        const edge = edgeStrengthAt(x, y);
        const shapePenalty = Math.abs(y - expectedY) * 0.45;

        // Avoid following the shirt's vertical button placket near the center
        // unless the point is close to the expected neckline apex.
        const centerPenalty =
          Math.abs(x - centerX) < w * 0.018 &&
          Math.abs(y - apexY) > h * 0.025
            ? 18
            : 0;

        const score = edge - shapePenalty - centerPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestY = y;
        }
      }

      if (bestY != null) {
        raw.push({ x, y: bestY, score: bestScore });
      }
    }

    if (raw.length < 8) return null;

    const averageScore =
      raw.reduce((sum, p) => sum + Math.max(0, p.score), 0) / raw.length;

    if (averageScore < 8) return null;

    const points = decimateCurve(
      smoothCurve(raw.map(({ x, y }) => ({ x, y })), 2),
      24
    );

    return {
      points,
      confidence: clamp(averageScore / 45, 0, 1),
      source: "edge"
    };
  }

  // The current built-in blue shirt has a painted collar opening instead of a
  // transparent cut-out. Keep a tuned normalized fallback for that exact asset.
  // This is still mapped through the crop box, so it survives image scaling/cropping.
  function builtInFrontNecklinePreset() {
    const source = String(sourceInfo.source || "");
    if (!source.includes("clothing_top.png")) return null;

    const ow = sourceInfo.originalWidth || w;
    const oh = sourceInfo.originalHeight || h;
    const box = sourceInfo.cropBox || { x: 0, y: 0 };

    const normalized = [
      [0.412, 0.075],
      [0.421, 0.105],
      [0.436, 0.136],
      [0.455, 0.163],
      [0.476, 0.184],
      [0.494, 0.198],
      [0.511, 0.181],
      [0.531, 0.153],
      [0.548, 0.118],
      [0.560, 0.082]
    ];

    const points = normalized
      .map(([nx, ny]) => ({
        x: nx * ow - box.x,
        y: ny * oh - box.y
      }))
      .filter(p => p.x >= 0 && p.x < w && p.y >= 0 && p.y < h);

    return points.length >= 6
      ? { points, confidence: 1, source: "builtin-preset" }
      : null;
  }

  function detectFrontNeckline() {
    // v3: first find the enclosed central neck-opening region and use its
    // lower boundary. This is the primary path for both opaque and transparent
    // cartoon garments.
    const openingRegion = detectFloodFrontNeckline();
    if (openingRegion) return openingRegion;

    const alpha = detectAlphaFrontNeckline();
    if (alpha && alpha.confidence >= 0.48) return alpha;

    // Keep the old built-in preset only as a last-resort compatibility fallback.
    const builtin = builtInFrontNecklinePreset();
    if (builtin) return builtin;

    const edge = detectEdgeFrontNeckline();
    if (edge && edge.confidence >= 0.24) return edge;

    // Conservative geometry fallback: enough to keep the character neck above
    // the garment even when the image has weak internal contrast.
    const span = Math.max(20, rightShoulder.x - leftShoulder.x);
    const half = span * 0.17;
    const topLocalY = collarY + h * 0.025;
    const apexLocalY = collarY + h * 0.145;

    const points = [];
    const count = 11;
    for (let i = 0; i < count; i += 1) {
      const u = i / (count - 1);
      const x = centerX - half + 2 * half * u;
      const t = Math.abs(2 * u - 1);
      const y =
        topLocalY +
        (apexLocalY - topLocalY) * Math.pow(Math.max(0, 1 - t), 1.18);
      points.push({ x, y });
    }

    return {
      points,
      confidence: 0.18,
      source: "geometry-fallback"
    };
  }

  function fitLine(points, fallbackDir) {
    if (!points.length) {
      return {
        mean: { x: w * 0.5, y: h * 0.5 },
        dir: { x: fallbackDir.x, y: fallbackDir.y }
      };
    }

    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;

    for (const p of points) {
      sx += p.x;
      sy += p.y;
      sxx += p.x * p.x;
      syy += p.y * p.y;
      sxy += p.x * p.y;
    }

    const n = points.length;
    const mx = sx / n;
    const my = sy / n;
    const cxx = sxx / n - mx * mx;
    const cyy = syy / n - my * my;
    const cxy = sxy / n - mx * my;
    const tr = cxx + cyy;
    const disc = Math.sqrt(Math.max(0, (cxx - cyy) ** 2 + 4 * cxy * cxy));
    const lambda = (tr + disc) / 2;

    let vx = cxy;
    let vy = lambda - cxx;

    if (Math.abs(vx) + Math.abs(vy) < 1e-7) {
      if (cxx >= cyy) {
        vx = 1;
        vy = 0;
      } else {
        vx = 0;
        vy = 1;
      }
    }

    let norm = Math.hypot(vx, vy) || 1;
    vx /= norm;
    vy /= norm;

    if (vx * fallbackDir.x + vy * fallbackDir.y < 0) {
      vx = -vx;
      vy = -vy;
    }

    return { mean: { x: mx, y: my }, dir: { x: vx, y: vy } };
  }

  function sleeveGeometry(side) {
    const outerFractions = [0.62, 0.78, 0.92];
    const stride = Math.max(1, Math.floor(Math.max(w, h) / 800));

    function rangeFor(frac) {
      if (side === "left") {
        const x0 = Math.max(0, visibleLeft);
        const x1 = Math.max(x0 + 1, Math.round(x0 + frac * (hemLeft - x0)));
        return [x0, Math.min(w, x1)];
      }

      const x1 = Math.min(w, visibleRight + 1);
      const x0 = Math.min(
        x1 - 1,
        Math.round(visibleRight - frac * (visibleRight - hemRight))
      );
      return [Math.max(0, x0), x1];
    }

    function statsForRange(x0, x1) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;

      for (let y = 0; y < h; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          if (a(x, y) <= alphaThreshold) continue;
          n += 1;
          sx += x;
          sy += y;
          sxx += x * x;
          syy += y * y;
          sxy += x * y;
        }
      }

      return { n, sx, sy, sxx, syy, sxy };
    }

    let x0 = 0;
    let x1 = w;
    let s = null;

    for (const frac of outerFractions) {
      [x0, x1] = rangeFor(frac);
      s = statsForRange(x0, x1);
      if (s.n >= 80) break;
    }

    if (!s || s.n < 80) {
      x0 = side === "left" ? 0 : Math.floor(centerX);
      x1 = side === "left" ? Math.ceil(centerX) : w;
      s = statsForRange(x0, x1);
    }

    if (!s || s.n < 20) {
      return side === "left"
        ? {
            root: { x: w * 0.24, y: h * 0.34 },
            cuff: { x: w * 0.12, y: h * 0.55 },
            axis: { x: -0.3, y: 1 },
            confidence: 0
          }
        : {
            root: { x: w * 0.76, y: h * 0.34 },
            cuff: { x: w * 0.88, y: h * 0.55 },
            axis: { x: 0.3, y: 1 },
            confidence: 0
          };
    }

    const mx = s.sx / s.n;
    const my = s.sy / s.n;
    const cxx = s.sxx / s.n - mx * mx;
    const cyy = s.syy / s.n - my * my;
    const cxy = s.sxy / s.n - mx * my;
    const tr = cxx + cyy;
    const disc = Math.sqrt(Math.max(0, (cxx - cyy) ** 2 + 4 * cxy * cxy));
    const lambda = (tr + disc) / 2;

    let vx = cxy;
    let vy = lambda - cxx;

    if (Math.abs(vx) + Math.abs(vy) < 1e-7) {
      if (cxx >= cyy) {
        vx = 1;
        vy = 0;
      } else {
        vx = 0;
        vy = 1;
      }
    }

    let norm = Math.hypot(vx, vy) || 1;
    vx /= norm;
    vy /= norm;

    const ex = side === "left" ? -0.25 : 0.25;
    const ey = 1;

    if (vx * ex + vy * ey < 0) {
      vx = -vx;
      vy = -vy;
    }

    const nx = -vy;
    const ny = vx;

    let minP = Infinity;
    let maxP = -Infinity;

    for (let y = 0; y < h; y += stride) {
      for (let x = x0; x < x1; x += stride) {
        if (a(x, y) <= alphaThreshold) continue;
        const p = (x - mx) * vx + (y - my) * vy;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
    }

    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) {
      return {
        root: { x: mx + vx * h * 0.10, y: my - vy * h * 0.10 },
        cuff: { x: mx + vx * h * 0.26, y: my + vy * h * 0.26 },
        axis: { x: vx, y: vy },
        confidence: 0
      };
    }

    const span = maxP - minP;

    let cuffCount = 0;
    let cuffX = 0;
    let cuffY = 0;
    const tailCut = maxP - span * 0.10;
    const probe = Math.max(3, Math.round(Math.max(w, h) / 500));

    for (let y = 0; y < h; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (a(x, y) <= alphaThreshold) continue;
        const p = (x - mx) * vx + (y - my) * vy;
        if (p < tailCut) continue;

        const xa = Math.round(x + vx * probe);
        const ya = Math.round(y + vy * probe);
        const xb = Math.round(x - vx * probe);
        const yb = Math.round(y - vy * probe);

        const aheadOutside =
          xa < 0 ||
          xa >= w ||
          ya < 0 ||
          ya >= h ||
          a(xa, ya) <= alphaThreshold;

        const behindInside =
          xb >= 0 &&
          xb < w &&
          yb >= 0 &&
          yb < h &&
          a(xb, yb) > alphaThreshold;

        if (aheadOutside && behindInside) {
          cuffCount += 1;
          cuffX += x;
          cuffY += y;
        }
      }
    }

    let cuff = cuffCount
      ? { x: cuffX / cuffCount, y: cuffY / cuffCount }
      : {
          x: mx + vx * (maxP - span * 0.02),
          y: my + vy * (maxP - span * 0.02)
        };

    const midpoints = [];
    const sampleCount = 11;
    const radius = Math.max(10, Math.round(Math.min(w, h) * 0.11));
    const sampleStart = minP + span * 0.18;
    const sampleEnd = maxP - span * 0.06;

    for (let i = 0; i < sampleCount; i += 1) {
      const p = sampleStart + (sampleEnd - sampleStart) * (i / (sampleCount - 1));
      const cx = mx + vx * p;
      const cy = my + vy * p;

      let minT = Infinity;
      let maxT = -Infinity;

      for (let t = -radius; t <= radius; t += 1) {
        const xx = Math.round(cx + nx * t);
        const yy = Math.round(cy + ny * t);

        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        if (a(xx, yy) <= alphaThreshold) continue;

        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }

      if (Number.isFinite(minT) && Number.isFinite(maxT) && maxT - minT >= 2) {
        midpoints.push({
          x: cx + nx * ((minT + maxT) / 2),
          y: cy + ny * ((minT + maxT) / 2),
          p
        });
      }
    }

    let root = {
      x: mx + vx * (minP + span * 0.22),
      y: my + vy * (minP + span * 0.22)
    };

    let axis = { x: vx, y: vy };

    if (midpoints.length >= 4) {
      const fit = fitLine(midpoints, { x: vx, y: vy });
      axis = fit.dir;

      const sorted = midpoints.slice().sort((a, b) => a.p - b.p);
      const rootPts = sorted.slice(0, Math.min(3, sorted.length));
      const tipPts = sorted.slice(Math.max(0, sorted.length - 3));

      root = {
        x: rootPts.reduce((sum, p) => sum + p.x, 0) / rootPts.length,
        y: rootPts.reduce((sum, p) => sum + p.y, 0) / rootPts.length
      };

      const distalMid = {
        x: tipPts.reduce((sum, p) => sum + p.x, 0) / tipPts.length,
        y: tipPts.reduce((sum, p) => sum + p.y, 0) / tipPts.length
      };

      cuff = {
        x: cuff.x * 0.7 + distalMid.x * 0.3,
        y: cuff.y * 0.7 + distalMid.y * 0.3
      };
    }

    if ((cuff.x - root.x) * axis.x + (cuff.y - root.y) * axis.y < 0) {
      axis = { x: -axis.x, y: -axis.y };
    }

    return {
      root,
      cuff,
      axis,
      confidence: Math.min(1, midpoints.length / 8)
    };
  }

  const leftSleeve = sleeveGeometry("left");
  const rightSleeve = sleeveGeometry("right");
  const frontNeckline = detectFrontNeckline();

  return {
    collarY,
    hemY,
    hemLeft,
    hemRight,
    centerX,
    leftShoulder,
    rightShoulder,
    shoulderMidX: (leftShoulder.x + rightShoulder.x) / 2,
    shoulderMidY: (leftShoulder.y + rightShoulder.y) / 2,
    leftSleeveRoot: leftSleeve.root,
    rightSleeveRoot: rightSleeve.root,
    leftCuff: {
      x: leftSleeve.cuff.x,
      y: leftSleeve.cuff.y,
      axis: leftSleeve.axis,
      confidence: leftSleeve.confidence
    },
    rightCuff: {
      x: rightSleeve.cuff.x,
      y: rightSleeve.cuff.y,
      axis: rightSleeve.axis,
      confidence: rightSleeve.confidence
    },
    frontNeckline
  };
}

async function prepareGarment(src) {
  if (!src) throw new Error("没有衣物图片");

  const img = await loadImage(src);
  const c = imageToReadableCanvas(img);
  const cctx = c.getContext("2d", { willReadFrequently: true });
  const id = cctx.getImageData(0, 0, c.width, c.height);

  // Transparent PNGs are kept intact; otherwise remove only a flat border background.
  if (!hasUsefulTransparency(id)) {
    removeFlatBackground(id);
    cctx.putImageData(id, 0, 0);
  }

  const fresh = cctx.getImageData(0, 0, c.width, c.height);
  const box = alphaBBox(fresh);
  if (!box) throw new Error("未检测到衣物主体");

  const cropped = cropCanvas(c, box);
  return {
    canvas: cropped,
    features: findGarmentFeatures(cropped, {
      source: src,
      cropBox: box,
      originalWidth: c.width,
      originalHeight: c.height
    })
  };
}

const armGeomCache = {
  left: new WeakMap(),
  right: new WeakMap()
};

function armGeometry(img, side) {
  const cache = armGeomCache[side];
  if (cache.has(img)) return cache.get(img);

  const manual = ACTIVE_CFG.manualArmGeometry?.[side];
  if (manual) {
    const box = {
      x: 0,
      y: 0,
      width: img.width,
      height: img.height
    };

    const topAnchor = {
      x: manual.topAnchor.x,
      y: manual.topAnchor.y
    };

    const wristPoint = {
      x: manual.wristPoint.x,
      y: manual.wristPoint.y
    };

    const width =
      manual.width ?? Math.max(1, img.width * 0.3);

    const length = Math.max(
      1,
      Math.hypot(
        wristPoint.x - topAnchor.x,
        wristPoint.y - topAnchor.y
      )
    );

    const result = {
      box,
      topAnchor,
      wristPoint,
      length,
      width
    };

    cache.set(img, result);
    return result;
  }

  const c = imageToReadableCanvas(img);
  const id = c
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, c.width, c.height);

  const d = id.data;
  const w = c.width;
  const h = c.height;
  const alphaThreshold = 20;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let nAll = 0;
  let sxAll = 0;
  let syAll = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4 + 3] <= alphaThreshold) continue;

      nAll += 1;
      sxAll += x;
      syAll += y;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    const fallback = {
      box: { x: 0, y: 0, width: w, height: h },
      topAnchor: { x: w * 0.5, y: h * 0.05 },
      wristPoint: { x: w * 0.5, y: h * 0.76 },
      length: Math.max(1, h * 0.70),
      width: Math.max(1, w * 0.25)
    };
    cache.set(img, fallback);
    return fallback;
  }

  const outwardSign = side === "left" ? -1 : 1;
  const box = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };

  function bandMidpoint(startRatio, endRatio, fallbackRatio) {
    const y0 = Math.max(box.y, Math.floor(box.y + box.height * startRatio));
    const y1 = Math.min(
      h,
      Math.max(y0 + 1, Math.ceil(box.y + box.height * endRatio))
    );

    let n = 0;
    let sx = 0;
    let sy = 0;

    for (let y = y0; y < y1; y += 1) {
      let rowMin = w;
      let rowMax = -1;

      for (let x = 0; x < w; x += 1) {
        if (d[(y * w + x) * 4 + 3] <= alphaThreshold) continue;
        if (x < rowMin) rowMin = x;
        if (x > rowMax) rowMax = x;
      }

      if (rowMax >= rowMin) {
        n += 1;
        sx += (rowMin + rowMax) / 2;
        sy += y;
      }
    }

    if (n) return { x: sx / n, y: sy / n };
    return {
      x: box.x + box.width * 0.5,
      y: box.y + box.height * fallbackRatio
    };
  }

  const roughTop = bandMidpoint(0.00, 0.10, 0.05);
  const roughLower = bandMidpoint(0.68, 0.84, 0.76);

  let vx = roughLower.x - roughTop.x;
  let vy = roughLower.y - roughTop.y;

  if (Math.hypot(vx, vy) < 1e-6) {
    vx = 0;
    vy = 1;
  }

  let norm = Math.hypot(vx, vy) || 1;
  vx /= norm;
  vy /= norm;

  let nx = -vy;
  let ny = vx;

  if (nx * outwardSign < 0) {
    nx = -nx;
    ny = -ny;
  }

  const ox = nAll ? sxAll / nAll : box.x + box.width * 0.5;
  const oy = nAll ? syAll / nAll : box.y + box.height * 0.5;

  let minP = Infinity;
  let maxP = -Infinity;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (d[(y * w + x) * 4 + 3] <= alphaThreshold) continue;
      const p = (x - ox) * vx + (y - oy) * vy;
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
    }
  }

  if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) {
    const fallback = {
      box,
      topAnchor: roughTop,
      wristPoint: roughLower,
      length: Math.max(
        1,
        Math.hypot(roughLower.x - roughTop.x, roughLower.y - roughTop.y)
      ),
      width: Math.max(1, box.width * 0.35)
    };
    cache.set(img, fallback);
    return fallback;
  }

  const span = maxP - minP;
  const radius = Math.max(
    12,
    Math.round(Math.max(box.width, box.height) * 0.38)
  );
  const sampleCount = 15;
  const slices = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const u = 0.04 + 0.90 * (i / (sampleCount - 1));
    const p = minP + span * u;
    const cx = ox + vx * p;
    const cy = oy + vy * p;

    let minT = Infinity;
    let maxT = -Infinity;

    for (let t = -radius; t <= radius; t += 1) {
      const xx = Math.round(cx + nx * t);
      const yy = Math.round(cy + ny * t);

      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      if (d[(yy * w + xx) * 4 + 3] <= alphaThreshold) continue;

      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }

    if (Number.isFinite(minT) && Number.isFinite(maxT) && maxT - minT >= 2) {
      slices.push({
        u,
        p,
        width: maxT - minT,
        x: cx + nx * ((minT + maxT) / 2),
        y: cy + ny * ((minT + maxT) / 2)
      });
    }
  }

  let topBase = roughTop;
  if (slices.length >= 2) {
    const topSlices = slices.slice(0, Math.min(3, slices.length));
    topBase = {
      x: topSlices.reduce((sum, p) => sum + p.x, 0) / topSlices.length,
      y: topSlices.reduce((sum, p) => sum + p.y, 0) / topSlices.length
    };
  }

  // Wrist = the narrowest cross section in the lower forearm range.
  let wristCandidates = slices.filter(s => s.u >= 0.56 && s.u <= 0.82);
  if (!wristCandidates.length) {
    wristCandidates = slices.filter(s => s.u >= 0.52 && s.u <= 0.86);
  }

  let wristBase = roughLower;

  if (wristCandidates.length) {
    wristCandidates.sort((a, b) => a.width - b.width);
    const best = wristCandidates[0];
    wristBase = { x: best.x, y: best.y };
  } else if (slices.length) {
    const tail = slices.slice(
      Math.max(0, slices.length - 4),
      Math.max(0, slices.length - 1)
    );

    if (tail.length) {
      wristBase = {
        x: tail.reduce((sum, p) => sum + p.x, 0) / tail.length,
        y: tail.reduce((sum, p) => sum + p.y, 0) / tail.length
      };
    }
  }

  // Move the complete arm axis slightly outward without changing its direction.
  const outwardShift = ACTIVE_CFG.armAxisOutwardShiftPx || 0;

  const topAnchor = {
    x: topBase.x + nx * outwardShift,
    y: topBase.y + ny * outwardShift
  };

  const wristPoint = {
    x: wristBase.x + nx * outwardShift,
    y: wristBase.y + ny * outwardShift
  };

  const midWidths = slices
    .filter(s => s.u >= 0.40 && s.u <= 0.72)
    .map(s => s.width);

  const width = midWidths.length
    ? midWidths.reduce((a, b) => a + b, 0) / midWidths.length
    : Math.max(1, box.width * 0.35);

  const length = Math.max(
    1,
    Math.hypot(wristPoint.x - topAnchor.x, wristPoint.y - topAnchor.y)
  );

  const result = { box, topAnchor, wristPoint, length, width };
  cache.set(img, result);
  return result;
}

function matchedRightArmScale(leftArm, rightArm, baseScale) {
  const lg = armGeometry(leftArm, "left");
  const rg = armGeometry(rightArm, "right");

  const lenRatio = lg.length / Math.max(1, rg.length);
  const widthRatio = lg.width / Math.max(1, rg.width);
  const normalized = Math.sqrt(Math.max(0.01, lenRatio * widthRatio));
  const bias = ACTIVE_CFG.rightArmScaleBias ?? 1.0;

  return baseScale * clamp(normalized * bias, 0.86, 1.08);
}

function armShoulders(leftArm, rightArm, leftArmScale, rightArmScale) {
  const inset = ACTIVE_CFG.armInsetX || 0;
  const leftExtra = ACTIVE_CFG.leftArmExtraInsetX || 0;

  const leftAttach =
    ACTIVE_CFG.armAttachLeft ||
    ACTIVE_CFG.shoulderLeft;

  const rightAttach =
    ACTIVE_CFG.armAttachRight ||
    ACTIVE_CFG.shoulderRight;

  const leftBase = {
    x: leftAttach.x + inset + leftExtra,
    y: leftAttach.y
  };

  const rightBase = {
    x: rightAttach.x - inset,
    y: rightAttach.y
  };

  if (ACTIVE_CFG.attachArmPivotDirectly) {
    return {
      left: leftBase,
      right: rightBase
    };
  }

  const lg = armGeometry(leftArm, "left");
  const rg = armGeometry(rightArm, "right");

  return {
    left: {
      x: leftBase.x + (lg.topAnchor.x - ACTIVE_CFG.leftArmPivot.x) * leftArmScale,
      y: leftBase.y + (lg.topAnchor.y - ACTIVE_CFG.leftArmPivot.y) * leftArmScale
    },
    right: {
      x: rightBase.x + (rg.topAnchor.x - ACTIVE_CFG.rightArmPivot.x) * rightArmScale,
      y: rightBase.y + (rg.topAnchor.y - ACTIVE_CFG.rightArmPivot.y) * rightArmScale
    }
  };
}

function drawArm(ctx, img, shoulder, pivot, scale, rotation) {
  ctx.save();
  ctx.translate(shoulder.x, shoulder.y);
  ctx.rotate(rotation);
  ctx.drawImage(
    img,
    -pivot.x * scale,
    -pivot.y * scale,
    img.width * scale,
    img.height * scale
  );
  ctx.restore();
}

function projectArmPoint(anchor, pivot, point, scale, rotation) {
  const dx = (point.x - pivot.x) * scale;
  const dy = (point.y - pivot.y) * scale;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);

  return {
    x: anchor.x + dx * c - dy * s,
    y: anchor.y + dx * s + dy * c
  };
}

function snapshotCanvas(ctx) {
  const out = makeCanvas(ctx.canvas.width, ctx.canvas.height);
  out.getContext("2d").drawImage(ctx.canvas, 0, 0);
  return out;
}

function drawUnderlayAboveFrontNeckline(
  ctx,
  underlayCanvas,
  frontNeckline,
  garmentPlacement,
  gScaleX,
  gScaleY
) {
  const points = frontNeckline?.points;
  if (!underlayCanvas || !points || points.length < 2) return;

  const world = points.map(p => ({
    x: garmentPlacement.gx + p.x * gScaleX,
    y:
      garmentPlacement.gy +
      p.y * gScaleY +
      (ACTIVE_CFG.frontNeckBodyOverlapPx || 0)
  }));

  if (world.length < 2) return;

  ctx.save();
  ctx.beginPath();

  // Polygon = everything above the detected front neckline.
  ctx.moveTo(world[0].x, 0);
  ctx.lineTo(world[world.length - 1].x, 0);
  ctx.lineTo(world[world.length - 1].x, world[world.length - 1].y);

  for (let i = world.length - 2; i >= 0; i -= 1) {
    ctx.lineTo(world[i].x, world[i].y);
  }

  ctx.closePath();
  ctx.clip();

  // Repaint the complete lower-layer composite, not just bare skin.
  // This matters when a coat is over a top: the coat neckline can reveal
  // the top underneath, while the top neckline can reveal the character.
  ctx.drawImage(
    underlayCanvas,
    -horizontalRenderPadPx(),
    0
  );
  ctx.restore();
}

function createArmContext(state) {
  const { leftArm, rightArm } = state;

  const baseArmScale = ACTIVE_CFG.armScaleFactor;

  const leftArmScale =
    ACTIVE_CFG.leftArmScaleFactor ??
    baseArmScale;

  const rightArmScale =
    ACTIVE_CFG.rightArmScaleFactor ??
    matchedRightArmScale(
      leftArm,
      rightArm,
      baseArmScale
    );

  const lGeom = armGeometry(leftArm, "left");
  const rGeom = armGeometry(rightArm, "right");
  const lPivot = lGeom.topAnchor;
  const rPivot = rGeom.topAnchor;
  const lRest = angle(lPivot, lGeom.wristPoint);
  const rRest = angle(rPivot, rGeom.wristPoint);

  const shoulders = armShoulders(
    leftArm,
    rightArm,
    leftArmScale,
    rightArmScale
  );

  return {
    leftArmScale,
    rightArmScale,
    lGeom,
    rGeom,
    lPivot,
    rPivot,
    lRest,
    rRest,
    shoulders
  };
}

function createGarmentPlacement(garmentPrepared) {
  const gc = garmentPrepared.canvas;
  const f = garmentPrepared.features;

  const bodySL = ACTIVE_CFG.shoulderLeft;
  const bodySR = ACTIVE_CFG.shoulderRight;
  const shoulderY = ACTIVE_CFG.shoulderMidY;
  const bodyCenterX = ACTIVE_CFG.bodyCenterX;

  const garmentShoulderSpan = Math.max(
    20,
    f.rightShoulder.x - f.leftShoulder.x
  );

  const bodyShoulderSpan = Math.max(
    20,
    bodySR.x - bodySL.x
  );

  const shoulderPadPx = (ACTIVE_CFG.garmentShoulderPadPx || 0) * 2;

  const scaleByShoulder =
    (bodyShoulderSpan + shoulderPadPx) /
    garmentShoulderSpan;

  const garmentUpperToHem = Math.max(
    20,
    f.hemY - f.shoulderMidY
  );

  const bodyUpperToHem = Math.max(
    20,
    ACTIVE_CFG.shortsTopY - ACTIVE_CFG.shoulderMidY
  );

  const scaleByTorsoHeight =
    bodyUpperToHem *
    (ACTIVE_CFG.garmentTorsoCoverFactor || 1) /
    garmentUpperToHem;

  const gScaleX =
    Math.min(scaleByShoulder, scaleByTorsoHeight) *
    (ACTIVE_CFG.garmentScaleNudge || 1);

  let gScaleY = gScaleX;

  const topDropPx = ACTIVE_CFG.garmentTopDropPx || 0;

  // Freeze the upper placement before any vertical compression.
  const gxFixed = bodyCenterX - f.centerX * gScaleX;
  const gyFixed =
    shoulderY +
    topDropPx -
    f.shoulderMidY * gScaleY;

  function anchors(scaleY) {
    return {
      gx: gxFixed,
      gy: gyFixed,
      gls: {
        x: gxFixed + f.leftShoulder.x * gScaleX,
        y: gyFixed + f.leftShoulder.y * scaleY
      },
      grs: {
        x: gxFixed + f.rightShoulder.x * gScaleX,
        y: gyFixed + f.rightShoulder.y * scaleY
      },
      glu: {
        x: gxFixed + f.leftSleeveRoot.x * gScaleX,
        y: gyFixed + f.leftSleeveRoot.y * scaleY
      },
      gru: {
        x: gxFixed + f.rightSleeveRoot.x * gScaleX,
        y: gyFixed + f.rightSleeveRoot.y * scaleY
      },
      glc: {
        x: gxFixed + f.leftCuff.x * gScaleX,
        y: gyFixed + f.leftCuff.y * scaleY
      },
      grc: {
        x: gxFixed + f.rightCuff.x * gScaleX,
        y: gyFixed + f.rightCuff.y * scaleY
      }
    };
  }

  return {
    garmentPrepared,
    gc,
    f,
    gScaleX,
    gScaleY,
    gxFixed,
    gyFixed,
    anchors,
    G: anchors(gScaleY)
  };
}

function computeDriverLayout(garmentPrepared, armCtx) {
  const layout = createGarmentPlacement(garmentPrepared);

  const {
    leftArmScale,
    rightArmScale,
    lGeom,
    rGeom,
    lPivot,
    rPivot,
    lRest,
    rRest,
    shoulders
  } = armCtx;

  const gain = 1;

  // v25: the maximum opening angle is the exact horizontal arm pose.
  // Because lRest/rRest come from each fitted upper-anchor -> wrist axis,
  // this remains exact even when the fitted arm anchors are adjusted later.
  const leftHorizontalMaxRotation =
    Math.abs(
      angleDelta(
        Math.PI,
        lRest
      )
    );

  const rightHorizontalMaxRotation =
    Math.abs(
      angleDelta(
        0,
        rRest
      )
    );

  const compressEpsilon =
    ACTIVE_CFG.garmentCompressEpsilon || 0.0001;
  const minVerticalRatio =
    ACTIVE_CFG.garmentMinVerticalRatio || 0.84;

  function poseFromSleeveAxis(G) {
    const lTarget = angle(G.glu, G.glc);
    const rTarget = angle(G.gru, G.grc);

    const lr = clamp(
      angleDelta(lTarget, lRest) * gain,
      -leftHorizontalMaxRotation,
      leftHorizontalMaxRotation
    );

    const rr = clamp(
      angleDelta(rTarget, rRest) * gain,
      -rightHorizontalMaxRotation,
      rightHorizontalMaxRotation
    );

    const lWrist = projectArmPoint(
      shoulders.left,
      lPivot,
      lGeom.wristPoint,
      leftArmScale,
      lr
    );

    const rWrist = projectArmPoint(
      shoulders.right,
      rPivot,
      rGeom.wristPoint,
      rightArmScale,
      rr
    );

    return { lr, rr, lWrist, rWrist };
  }

  function poseToCuffWithExtraRotate(G) {
    const lTarget = angle(shoulders.left, G.glc);
    const rTarget = angle(shoulders.right, G.grc);

    const lBaseDelta =
      angleDelta(lTarget, lRest) * gain;

    const rBaseDelta =
      angleDelta(rTarget, rRest) * gain;

    let lr = clamp(
      lBaseDelta,
      -leftHorizontalMaxRotation,
      leftHorizontalMaxRotation
    );

    let rr = clamp(
      rBaseDelta,
      -rightHorizontalMaxRotation,
      rightHorizontalMaxRotation
    );

    const nudgePx =
      ACTIVE_CFG.armPostAlignArcNudgePx || 0;

    const leftRadius = Math.max(
      1,
      Math.hypot(
        lGeom.wristPoint.x - lGeom.topAnchor.x,
        lGeom.wristPoint.y - lGeom.topAnchor.y
      ) * leftArmScale
    );

    const rightRadius = Math.max(
      1,
      Math.hypot(
        rGeom.wristPoint.x - rGeom.topAnchor.x,
        rGeom.wristPoint.y - rGeom.topAnchor.y
      ) * rightArmScale
    );

    const lExtra =
      (nudgePx / leftRadius) *
      Math.sign(lBaseDelta || lr || 0);

    const rExtra =
      (nudgePx / rightRadius) *
      Math.sign(rBaseDelta || rr || 0);

    lr = clamp(
      lr + lExtra,
      -leftHorizontalMaxRotation,
      leftHorizontalMaxRotation
    );

    rr = clamp(
      rr + rExtra,
      -rightHorizontalMaxRotation,
      rightHorizontalMaxRotation
    );

    return { lr, rr };
  }

  function scaleYForCuffOnCircle(
    localCuff,
    shoulder,
    armRadius
  ) {
    const cuffX =
      layout.gxFixed +
      localCuff.x * layout.gScaleX;

    const dx = cuffX - shoulder.x;
    const r2 = armRadius * armRadius;

    if (dx * dx >= r2) return null;

    const targetY =
      shoulder.y +
      Math.sqrt(Math.max(0, r2 - dx * dx));

    return (
      (targetY - layout.gyFixed) /
      localCuff.y
    );
  }

  let G = layout.G;
  const initialPose = poseFromSleeveAxis(G);

  const leftNeedsCompress =
    G.glc.y > initialPose.lWrist.y;

  const rightNeedsCompress =
    G.grc.y > initialPose.rWrist.y;

  if (leftNeedsCompress || rightNeedsCompress) {
    const leftArmRadius =
      Math.hypot(
        lGeom.wristPoint.x - lGeom.topAnchor.x,
        lGeom.wristPoint.y - lGeom.topAnchor.y
      ) * leftArmScale;

    const rightArmRadius =
      Math.hypot(
        rGeom.wristPoint.x - rGeom.topAnchor.x,
        rGeom.wristPoint.y - rGeom.topAnchor.y
      ) * rightArmScale;

    let allowedScaleY = layout.gScaleY;

    if (leftNeedsCompress) {
      const target = scaleYForCuffOnCircle(
        layout.f.leftCuff,
        shoulders.left,
        leftArmRadius
      );

      if (Number.isFinite(target)) {
        allowedScaleY =
          Math.min(allowedScaleY, target);
      }
    }

    if (rightNeedsCompress) {
      const target = scaleYForCuffOnCircle(
        layout.f.rightCuff,
        shoulders.right,
        rightArmRadius
      );

      if (Number.isFinite(target)) {
        allowedScaleY =
          Math.min(allowedScaleY, target);
      }
    }

    const minAllowed =
      layout.gScaleX * minVerticalRatio;

    allowedScaleY = Math.max(
      minAllowed,
      Math.min(layout.gScaleY, allowedScaleY)
    );

    if (
      allowedScaleY <
      layout.gScaleY - compressEpsilon
    ) {
      layout.gScaleY = allowedScaleY;
      G = layout.anchors(layout.gScaleY);
      layout.G = G;
    }
  }

  layout.finalPose =
    poseToCuffWithExtraRotate(layout.G);

  return layout;
}

function drawGarmentLayer(ctx, layout) {
  if (!layout) return;

  const underlay = snapshotCanvas(ctx);

  ctx.drawImage(
    layout.gc,
    layout.G.gx,
    layout.G.gy,
    layout.gc.width * layout.gScaleX,
    layout.gc.height * layout.gScaleY
  );

  drawUnderlayAboveFrontNeckline(
    ctx,
    underlay,
    layout.f.frontNeckline,
    { gx: layout.G.gx, gy: layout.G.gy },
    layout.gScaleX,
    layout.gScaleY
  );
}

function renderTryOnComposite(
  ctx,
  state,
  {
    topPrepared = null,
    coatPrepared = null
  } = {}
) {
  const { body, leftArm, rightArm } = state;

  // Always clear the complete expanded canvas in device coordinates.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );
  ctx.restore();

  // The outermost upper-body garment drives the arm pose.
  // Coat > top, matching the existing project layer semantics.
  const driverPrepared =
    coatPrepared || topPrepared;

  if (!driverPrepared) {
    return;
  }

  const armCtx = createArmContext(state);
  const driverLayout =
    computeDriverLayout(driverPrepared, armCtx);

  // When a coat is present, the top remains underneath and follows body
  // placement only. The coat drives the single physical arm pose.
  const topLayout = topPrepared
    ? (
        coatPrepared
          ? createGarmentPlacement(topPrepared)
          : driverLayout
      )
    : null;

  const coatLayout = coatPrepared
    ? driverLayout
    : null;

  // Keep the existing body/garment coordinate system unchanged.
  // The extra canvas width lives outside it as transparent horizontal overscan.
  ctx.save();
  ctx.translate(
    horizontalRenderPadPx(),
    0
  );

  ctx.drawImage(
    body,
    0,
    0,
    ACTIVE_REFERENCE.width,
    ACTIVE_REFERENCE.height
  );

  drawArm(
    ctx,
    leftArm,
    armCtx.shoulders.left,
    armCtx.lPivot,
    armCtx.leftArmScale,
    driverLayout.finalPose.lr
  );

  drawArm(
    ctx,
    rightArm,
    armCtx.shoulders.right,
    armCtx.rPivot,
    armCtx.rightArmScale,
    driverLayout.finalPose.rr
  );

  // Upper-body stack:
  // body -> arms -> top -> coat.
  // Neckline masking re-exposes the complete lower stack, so a coat can
  // reveal the top through its neckline/opening instead of revealing bare skin.
  drawGarmentLayer(ctx, topLayout);
  drawGarmentLayer(ctx, coatLayout);

  ctx.restore();
}


function renderTryOnPantsComposite(
  ctx,
  state,
  {
    legSplit,
    pantsLayout,
    topPrepared = null,
    coatPrepared = null
  } = {}
) {
  const { leftArm, rightArm } = state;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );
  ctx.restore();

  // IMPORTANT: the complete upper-body fitting pipeline below is the same
  // helper path as renderTryOnComposite(). Pants only replace the body draw
  // with split/rotatable legs and insert one layer below top/coat.
  const driverPrepared =
    coatPrepared || topPrepared;

  const armCtx = createArmContext(state);
  const driverLayout = driverPrepared
    ? computeDriverLayout(driverPrepared, armCtx)
    : null;

  const topLayout = topPrepared
    ? (
        coatPrepared
          ? createGarmentPlacement(topPrepared)
          : driverLayout
      )
    : null;

  const coatLayout = coatPrepared
    ? driverLayout
    : null;

  const armPose = driverLayout?.finalPose ?? {
    lr: 0,
    rr: 0
  };

  ctx.save();
  ctx.translate(
    horizontalRenderPadPx(),
    0
  );

  // The body reference itself stays at (0, 0). Each leg layer is also a
  // full-size 887x1774 canvas in the original coordinate system; only the
  // leg pixels rotate around their thigh anchor.
  drawSplitBody(
    ctx,
    legSplit,
    pantsLayout.finalPose
  );

  drawArm(
    ctx,
    leftArm,
    armCtx.shoulders.left,
    armCtx.lPivot,
    armCtx.leftArmScale,
    armPose.lr
  );

  drawArm(
    ctx,
    rightArm,
    armCtx.shoulders.right,
    armCtx.rPivot,
    armCtx.rightArmScale,
    armPose.rr
  );

  // Existing project z-order is pants < top < coat.
  drawPantsLayer(ctx, pantsLayout);
  drawGarmentLayer(ctx, topLayout);
  drawGarmentLayer(ctx, coatLayout);

  ctx.restore();
}


export function mountTryOn2dController(store) {
  const stage =
    document.getElementById("characterStage");

  const character =
    document.getElementById("character");

  const topLayer =
    document.getElementById("wearable-top");

  const coatLayer =
    document.getElementById("wearable-coat");

  const pantsLayer =
    document.getElementById("wearable-pants");

  if (
    !stage ||
    !character ||
    !topLayer ||
    !coatLayer ||
    !pantsLayer
  ) {
    console.warn(
      "[tryon2d] character stage is not available."
    );
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.id = "tryOn2dCanvas";
  canvas.width = expandedRenderWidth();
  canvas.height = ACTIVE_REFERENCE.height;
  canvas.setAttribute("aria-hidden", "true");

  Object.assign(canvas.style, {
    position: "absolute",
    zIndex: "1",
    display: "none",
    pointerEvents: "none",
    userSelect: "none",
    filter:
      "drop-shadow(0 10px 8px rgba(63, 46, 36, .10))"
  });

  stage.appendChild(canvas);

  const debugCanvas =
    document.createElement("canvas");
  debugCanvas.id = "tryOn2dGuideCanvas";
  debugCanvas.setAttribute("aria-hidden", "true");

  Object.assign(debugCanvas.style, {
    position: "absolute",
    zIndex: "7",
    display: "none",
    pointerEvents: "none",
    userSelect: "none"
  });

  stage.appendChild(debugCanvas);

  const ctx = canvas.getContext("2d", {
    alpha: true,
    willReadFrequently: false
  });

  const debugCtx =
    debugCanvas.getContext("2d");

  const state = {
    body: null,
    leftArm: null,
    rightArm: null,
    sceneKey: "",
    assetsPromise: null,
    ready: false,
    renderSequence: 0,
    lastRenderedKey: null,
    hasFrame: false,
    debugEnabled: false,
    pantsDebugEnabled: false,
    usesPantsComposite: false,
    // While a male pants source is being prepared, never let the raw DOM
    // <img> flash through. That raw layer is only a source container; the
    // fitted canvas owns the visible pants presentation.
    suppressRawPants: false,
    lastPantsError: null,
    legSplit: null,
    legSplitSceneKey: "",
    legSplitPromise: null,
    lastPantsLayout: null
  };

  const garmentCache = new Map();
  const pantsCache = new Map();

  function applySceneSpec(gender) {
    const spec = getSceneSpec(gender);

    ACTIVE_REFERENCE = spec.reference;
    ACTIVE_CFG = spec.cfg;

    const renderWidth =
      expandedRenderWidth();

    if (
      canvas.width !== renderWidth ||
      canvas.height !== ACTIVE_REFERENCE.height
    ) {
      canvas.width = renderWidth;
      canvas.height = ACTIVE_REFERENCE.height;
    }

    if (
      debugCanvas.width !== renderWidth ||
      debugCanvas.height !== ACTIVE_REFERENCE.height
    ) {
      debugCanvas.width = renderWidth;
      debugCanvas.height = ACTIVE_REFERENCE.height;
    }

    return spec;
  }

  function layoutCanvasWithOverscan(
    targetCanvas
  ) {
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const referenceWidth =
      ACTIVE_REFERENCE.width;
    const referenceHeight =
      ACTIVE_REFERENCE.height;

    if (
      !stageWidth ||
      !stageHeight ||
      !referenceWidth ||
      !referenceHeight
    ) {
      return;
    }

    // This is exactly the old "contain" scale for the character reference.
    // We intentionally do NOT include the horizontal overscan in this scale,
    // so the character and clothing keep the same apparent size.
    const scale = Math.min(
      stageWidth / referenceWidth,
      stageHeight / referenceHeight
    );

    const padX =
      horizontalRenderPadPx();

    const referenceDisplayWidth =
      referenceWidth * scale;

    const width =
      (referenceWidth + padX * 2) * scale;

    const height =
      referenceHeight * scale;

    targetCanvas.style.width = `${width}px`;
    targetCanvas.style.height = `${height}px`;

    targetCanvas.style.left =
      `${
        (stageWidth - referenceDisplayWidth) / 2 -
        padX * scale
      }px`;

    targetCanvas.style.top =
      `${(stageHeight - height) / 2}px`;
  }

  function layoutCanvas() {
    layoutCanvasWithOverscan(canvas);
    layoutCanvasWithOverscan(debugCanvas);
  }

  function activate() {
    layoutCanvas();
    canvas.style.display = "block";
    character.style.visibility = "hidden";
    topLayer.style.visibility = "hidden";
    coatLayer.style.visibility = "hidden";

    if (state.usesPantsComposite || state.suppressRawPants) {
      pantsLayer.style.visibility = "hidden";
    } else {
      pantsLayer.style.removeProperty("visibility");
    }
  }

  function deactivate() {
    canvas.style.display = "none";
    character.style.removeProperty("visibility");
    topLayer.style.removeProperty("visibility");
    coatLayer.style.removeProperty("visibility");
    if (state.suppressRawPants) {
      pantsLayer.style.visibility = "hidden";
    } else {
      pantsLayer.style.removeProperty("visibility");
    }
    state.usesPantsComposite = false;
  }

  function hideDebug() {
    debugCanvas.style.display = "none";
  }

  function drawFemaleDebug() {
    if (!state.debugEnabled) {
      hideDebug();
      return;
    }

    const g = FEMALE_DEBUG_GEOMETRY;
    if (!g) {
      hideDebug();
      return;
    }

    debugCtx.save();
    debugCtx.setTransform(1, 0, 0, 1, 0, 0);
    debugCtx.clearRect(
      0,
      0,
      debugCanvas.width,
      debugCanvas.height
    );
    debugCtx.restore();

    const P = point => ({
      x: point.x * ACTIVE_REFERENCE.width,
      y: point.y * ACTIVE_REFERENCE.height
    });

    const sl = P(g.shoulderLeft);
    const sr = P(g.shoulderRight);
    const lt = P(g.leftArmTop);
    const rt = P(g.rightArmTop);
    const lw = P(g.leftWrist);
    const rw = P(g.rightWrist);
    const cx =
      g.bodyCenterX * ACTIVE_REFERENCE.width;

    debugCtx.save();
    debugCtx.translate(
      horizontalRenderPadPx(),
      0
    );
    debugCtx.lineWidth = 4;
    debugCtx.strokeStyle = "rgba(128,86,166,.92)";
    debugCtx.setLineDash([16, 10]);
    debugCtx.beginPath();
    debugCtx.moveTo(cx, 420);
    debugCtx.lineTo(cx, 1520);
    debugCtx.stroke();

    debugCtx.setLineDash([]);
    debugCtx.strokeStyle = "rgba(214,123,72,.95)";
    debugCtx.lineWidth = 5;
    debugCtx.beginPath();
    debugCtx.moveTo(sl.x, sl.y);
    debugCtx.lineTo(sr.x, sr.y);
    debugCtx.stroke();

    debugCtx.strokeStyle = "rgba(0,128,138,.96)";
    debugCtx.lineWidth = 6;
    debugCtx.beginPath();
    debugCtx.moveTo(lt.x, lt.y);
    debugCtx.lineTo(lw.x, lw.y);
    debugCtx.stroke();
    debugCtx.beginPath();
    debugCtx.moveTo(rt.x, rt.y);
    debugCtx.lineTo(rw.x, rw.y);
    debugCtx.stroke();

    function dot(p, fill, radius) {
      debugCtx.fillStyle = fill;
      debugCtx.beginPath();
      debugCtx.arc(
        p.x,
        p.y,
        radius,
        0,
        Math.PI * 2
      );
      debugCtx.fill();
      debugCtx.lineWidth = 2;
      debugCtx.strokeStyle = "rgba(255,255,255,.95)";
      debugCtx.stroke();
    }

    dot(sl, "rgba(214,123,72,.96)", 6);
    dot(sr, "rgba(214,123,72,.96)", 6);
    dot(lt, "rgba(229,75,98,.96)", 8);
    dot(rt, "rgba(229,75,98,.96)", 8);
    dot(lw, "rgba(31,118,214,.96)", 8);
    dot(rw, "rgba(31,118,214,.96)", 8);

    debugCtx.restore();
    layoutCanvas();
    debugCanvas.style.display = "block";
  }


  function drawMalePantsDebug() {
    if (
      !state.pantsDebugEnabled ||
      !state.legSplit ||
      !state.lastPantsLayout
    ) {
      hideDebug();
      return;
    }

    debugCtx.save();
    debugCtx.setTransform(1, 0, 0, 1, 0, 0);
    debugCtx.clearRect(
      0,
      0,
      debugCanvas.width,
      debugCanvas.height
    );
    debugCtx.restore();

    debugCtx.save();
    debugCtx.translate(
      horizontalRenderPadPx(),
      0
    );
    drawPantsDebugOverlay(
      debugCtx,
      state.legSplit,
      state.lastPantsLayout
    );
    debugCtx.restore();

    layoutCanvas();
    debugCanvas.style.display = "block";
  }

  async function ensureAssets(spec) {
    if (
      state.ready &&
      state.sceneKey === spec.key
    ) {
      return;
    }

    if (
      state.assetsPromise &&
      state.sceneKey === spec.key
    ) {
      await state.assetsPromise;
      return;
    }

    state.sceneKey = spec.key;
    state.ready = false;
    state.legSplit = null;
    state.legSplitSceneKey = "";
    state.legSplitPromise = null;

    state.assetsPromise = Promise.all([
      loadImage(spec.assets.body),
      loadImage(spec.assets.leftArm),
      loadImage(spec.assets.rightArm)
    ]).then(
      ([body, leftArm, rightArm]) => {
        state.body = body;
        state.leftArm = leftArm;
        state.rightArm = rightArm;
        state.ready = true;
      }
    );

    await state.assetsPromise;
  }

  async function getPreparedGarment(src) {
    if (garmentCache.has(src)) {
      return garmentCache.get(src);
    }

    const promise =
      prepareGarment(src).catch(error => {
        garmentCache.delete(src);
        throw error;
      });

    garmentCache.set(src, promise);
    return promise;
  }


  async function ensureMaleLegSplit() {
    if (
      state.legSplit &&
      state.legSplitSceneKey === "male"
    ) {
      return state.legSplit;
    }

    if (
      state.legSplitPromise &&
      state.legSplitSceneKey === "male"
    ) {
      return state.legSplitPromise;
    }

    if (!state.body || state.sceneKey !== "male") {
      throw new Error("男生身体素材尚未准备好，无法分割腿部");
    }

    state.legSplitSceneKey = "male";
    state.legSplitPromise = Promise.resolve().then(() =>
      splitBodyIntoRotatableLegs(
        state.body,
        MALE_CFG
      )
    );

    try {
      state.legSplit = await state.legSplitPromise;
      const verification = verifyLegSplit(state.legSplit);
      if (!verification?.partitionExact) {
        throw new Error(
          `腿部分割重组校验失败: ${JSON.stringify(verification)}`
        );
      }
      return state.legSplit;
    } catch (error) {
      state.legSplit = null;
      state.legSplitPromise = null;
      state.legSplitSceneKey = "";
      throw error;
    }
  }

  async function getPreparedPants(src) {
    if (pantsCache.has(src)) {
      return pantsCache.get(src);
    }

    const promise = preparePants(src).catch(error => {
      pantsCache.delete(src);
      throw error;
    });

    pantsCache.set(src, promise);
    return promise;
  }

  function resolveLayerSource(
    selectedCategory,
    category,
    layer,
    savedItem
  ) {
    if (
      selectedCategory === category &&
      layer.getAttribute("src")
    ) {
      return layer.src;
    }

    return savedItem?.image
      ? new URL(
          savedItem.image,
          document.baseURI
        ).href
      : null;
  }

  async function renderCompositeSources({
    topSrc = null,
    coatSrc = null,
    pantsSrc = null,
    key = "",
    gender = "male"
  } = {}) {
    const wantsPantsComposite =
      gender === "male" && Boolean(pantsSrc);

    // Hide the raw source layer synchronously, before any image decoding or
    // geometry work can yield. This prevents an opaque/checkerboard upload
    // from flashing at the legacy CSS size during preview.
    state.suppressRawPants = wantsPantsComposite;
    if (state.suppressRawPants) {
      pantsLayer.style.visibility = "hidden";
    }

    if (!topSrc && !coatSrc && !wantsPantsComposite) {
      state.suppressRawPants = false;
      state.renderSequence += 1;
      state.lastRenderedKey = null;
      state.hasFrame = false;
      deactivate();
      hideDebug();
      return;
    }

    const spec = applySceneSpec(gender);
    layoutCanvas();

    const sequence =
      ++state.renderSequence;

    const resolvedTop = topSrc
      ? new URL(
          topSrc,
          document.baseURI
        ).href
      : null;

    const resolvedCoat = coatSrc
      ? new URL(
          coatSrc,
          document.baseURI
        ).href
      : null;

    const resolvedPants = wantsPantsComposite
      ? new URL(
          pantsSrc,
          document.baseURI
        ).href
      : null;

    try {
      await ensureAssets(spec);

      const [
        topPrepared,
        coatPrepared
      ] = await Promise.all([
        resolvedTop
          ? getPreparedGarment(resolvedTop)
          : Promise.resolve(null),

        resolvedCoat
          ? getPreparedGarment(resolvedCoat)
          : Promise.resolve(null)
      ]);

      let pantsPrepared = null;
      let legSplit = null;
      let pantsLayout = null;

      // Pants are deliberately isolated from the upper-body promise. If pants
      // geometry ever fails, top/coat still render through the original path.
      if (resolvedPants) {
        try {
          [pantsPrepared, legSplit] = await Promise.all([
            getPreparedPants(resolvedPants),
            ensureMaleLegSplit()
          ]);

          pantsLayout = computePantsLayout(
            pantsPrepared,
            legSplit,
            MALE_CFG
          );
          state.lastPantsError = null;
        } catch (pantsError) {
          state.lastPantsError =
            pantsError instanceof Error
              ? pantsError.message
              : String(pantsError);
          console.warn(
            "[tryon2d] pants geometry failed; raw pants source remains hidden.",
            pantsError
          );
          pantsPrepared = null;
          legSplit = null;
          pantsLayout = null;
        }
      }

      if (
        sequence !== state.renderSequence
      ) {
        return;
      }

      if (pantsLayout && legSplit) {
        renderTryOnPantsComposite(
          ctx,
          state,
          {
            legSplit,
            pantsLayout,
            topPrepared,
            coatPrepared
          }
        );
      } else if (topPrepared || coatPrepared) {
        // Exact pre-existing upper-body render function.
        renderTryOnComposite(
          ctx,
          state,
          {
            topPrepared,
            coatPrepared
          }
        );
      } else {
        state.hasFrame = false;
        state.lastRenderedKey = null;
        state.usesPantsComposite = false;
        state.lastPantsLayout = null;
        deactivate();
        hideDebug();
        return;
      }

      state.lastRenderedKey =
        String(key);

      state.hasFrame = true;
      state.usesPantsComposite = Boolean(pantsLayout && legSplit);
      state.lastPantsLayout = pantsLayout;
      if (legSplit) state.legSplit = legSplit;
      activate();

      if (gender === "female") {
        drawFemaleDebug();
      } else if (state.usesPantsComposite && state.pantsDebugEnabled) {
        drawMalePantsDebug();
      } else {
        hideDebug();
      }
    } catch (error) {
      if (
        sequence !== state.renderSequence
      ) {
        return;
      }

      console.warn(
        "[tryon2d] composite render failed, falling back to original wearable layers.",
        error
      );

      state.hasFrame = false;
      state.lastRenderedKey = null;
      state.lastPantsLayout = null;
      state.usesPantsComposite = false;
      deactivate();
      hideDebug();
    }
  }

  function sync(appState) {
    const gender = appState.gender;
    const spec = applySceneSpec(gender);

    const selectedCategory =
      appState.wardrobe.selectedCategory;

    const savedTop =
      appState.wardrobe.savedOutfits.top;

    const savedCoat =
      appState.wardrobe.savedOutfits.coat;

    const savedPants =
      appState.wardrobe.savedOutfits.pants;

    const topSrc =
      resolveLayerSource(
        selectedCategory,
        "top",
        topLayer,
        savedTop
      );

    const coatSrc =
      resolveLayerSource(
        selectedCategory,
        "coat",
        coatLayer,
        savedCoat
      );

    const pantsSrc =
      resolveLayerSource(
        selectedCategory,
        "pants",
        pantsLayer,
        savedPants
      );

    const hasCustomMalePants =
      gender === "male" && Boolean(pantsSrc);

    if (!topSrc && !coatSrc && !hasCustomMalePants) {
      state.suppressRawPants = false;
      state.lastPantsError = null;
      state.renderSequence += 1;
      state.lastRenderedKey = null;
      state.hasFrame = false;
      state.lastPantsLayout = null;
      state.usesPantsComposite = false;
      deactivate();

      if (
        gender === "female" &&
        state.debugEnabled
      ) {
        drawFemaleDebug();
      } else {
        hideDebug();
      }

      return;
    }

    // Confirming pants changes selectedCategory from "pants" to null, but
    // the actual visual inputs are unchanged. Keep that transition on the
    // same key so a good preview frame is not thrown away and rebuilt.
    // Top/coat confirmation keeps its previous scheduling behaviour.
    const selectionRenderKey =
      selectedCategory === "pants" ||
      (!selectedCategory && hasCustomMalePants)
        ? "pants-stable"
        : (selectedCategory || "saved");

    const key =
      `${gender}` +
      `::${selectionRenderKey}` +
      `::top=${topSrc || ""}` +
      `::coat=${coatSrc || ""}` +
      `::pants=${hasCustomMalePants ? pantsSrc : ""}`;

    if (
      state.hasFrame &&
      state.lastRenderedKey === key
    ) {
      activate();

      if (
        gender === "female" &&
        state.debugEnabled
      ) {
        drawFemaleDebug();
      } else if (
        gender === "male" &&
        state.usesPantsComposite &&
        state.pantsDebugEnabled
      ) {
        drawMalePantsDebug();
      } else {
        hideDebug();
      }

      return;
    }

    renderCompositeSources({
      topSrc,
      coatSrc,
      pantsSrc: hasCustomMalePants ? pantsSrc : null,
      key,
      gender
    });
  }

  let resizeObserver = null;
  let wearableSourceObserver = null;

  if (
    typeof MutationObserver !== "undefined"
  ) {
    wearableSourceObserver =
      new MutationObserver(mutations => {
        if (
          !mutations.some(
            mutation =>
              mutation.type === "attributes" &&
              mutation.attributeName === "src"
          )
        ) {
          return;
        }

        const current =
          store.getState();

        if (
          current.wardrobe.selectedCategory === "top" ||
          current.wardrobe.selectedCategory === "coat" ||
          current.wardrobe.selectedCategory === "pants"
        ) {
          sync(current);
        }
      });

    wearableSourceObserver.observe(
      topLayer,
      {
        attributes: true,
        attributeFilter: ["src"]
      }
    );

    wearableSourceObserver.observe(
      coatLayer,
      {
        attributes: true,
        attributeFilter: ["src"]
      }
    );

    wearableSourceObserver.observe(
      pantsLayer,
      {
        attributes: true,
        attributeFilter: ["src"]
      }
    );
  }

  if (
    typeof ResizeObserver !== "undefined"
  ) {
    resizeObserver =
      new ResizeObserver(layoutCanvas);

    resizeObserver.observe(stage);
  } else {
    window.addEventListener(
      "resize",
      layoutCanvas
    );
  }

  const unsubscribe =
    store.subscribe(sync);

  sync(store.getState());
  layoutCanvas();

  const api = {
    canvas,
    guideCanvas: debugCanvas,

    rerender() {
      state.lastRenderedKey = null;
      state.hasFrame = false;
      sync(store.getState());
    },

    showFemaleDebug(value = true) {
      state.debugEnabled =
        Boolean(value);

      if (
        store.getState().gender === "female"
      ) {
        if (state.debugEnabled) {
          drawFemaleDebug();
        } else {
          hideDebug();
        }
      }

      return state.debugEnabled;
    },


    showPantsDebug(value = true) {
      state.pantsDebugEnabled = Boolean(value);

      if (
        store.getState().gender === "male" &&
        state.usesPantsComposite
      ) {
        if (state.pantsDebugEnabled) {
          drawMalePantsDebug();
        } else {
          hideDebug();
        }
      }

      return state.pantsDebugEnabled;
    },

    getPantsDebugReport() {
      if (!state.legSplit) return null;
      return {
        split: verifyLegSplit(state.legSplit),
        geometry: pantsDebugGeometry(
          state.legSplit,
          state.lastPantsLayout
        ),
        lastError: state.lastPantsError
      };
    },

    getPantsPieces() {
      if (!state.legSplit) return null;
      const recomposed = recomposeSplitBody(state.legSplit);
      return {
        body: state.legSplit.bodyCanvas,
        leftLeg: state.legSplit.leftLegCanvas,
        rightLeg: state.legSplit.rightLegCanvas,
        recomposed
      };
    },

    destroy() {
      unsubscribe();
      resizeObserver?.disconnect();
      wearableSourceObserver?.disconnect();

      window.removeEventListener(
        "resize",
        layoutCanvas
      );

      state.suppressRawPants = false;
      deactivate();
      hideDebug();
      canvas.remove();
      debugCanvas.remove();
    },

    currentConfig() {
      return ACTIVE_CFG;
    },

    femaleGeometry:
      FEMALE_DEBUG_GEOMETRY
  };

  if (import.meta.env.DEV) {
    window.__TRYON2D__ = api;
  }

  return api;
}
