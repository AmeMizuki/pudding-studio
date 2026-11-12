import { REFERENCE_WIDTH } from './motion.js';
// ponytail: 512-cell detail cap (~2 reference px per cell); raise with the GPU atlas cap for finer painting.
const MAX_SIZE = 512;

function validateMask(mask) {
  if (
    !mask ||
    !Number.isInteger(mask.width) || mask.width < 1 || mask.width > MAX_SIZE ||
    !Number.isInteger(mask.height) || mask.height < 1 || mask.height > MAX_SIZE ||
    !(mask.data instanceof Uint8Array) ||
    mask.data.length !== mask.width * mask.height ||
    !Number.isInteger(mask.version) || mask.version < 0
  ) throw new RangeError('Invalid brush mask.');
}

function validateBounds(bounds) {
  if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
      bounds[2] <= 0 || bounds[3] <= 0) {
    throw new RangeError('Mask bounds must have finite coordinates and positive dimensions.');
  }
}

export function createMask(imageWidth, imageHeight) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
      imageWidth <= 0 || imageHeight <= 0) {
    throw new RangeError('Image dimensions must be finite and positive.');
  }
  const scale = Math.min(1, MAX_SIZE / Math.max(imageWidth, imageHeight));
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return { width, height, data: new Uint8Array(width * height), version: 0 };
}

export function maskBounds(mask) {
  validateMask(mask);
  const { width, height, data } = mask;
  let left = width, top = height, right = -1, bottom = -1;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!data[row * width + col]) continue;
      left = Math.min(left, col);
      right = Math.max(right, col);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  return right < left ? null : [left / width, top / height,
    (right - left + 1) / width, (bottom - top + 1) / height];
}

export function sampleMask(mask, x, y) {
  validateMask(mask);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return 0;
  const col = Math.min(mask.width - 1, Math.floor(x * mask.width));
  const row = Math.min(mask.height - 1, Math.floor(y * mask.height));
  return mask.data[row * mask.width + col];
}

// True when a round brush of `diameter` reference px centred at `point`
// overlaps any painted cell; decides whether a stroke extends a region.
export function maskTouches(mask, point, diameter, referenceHeight) {
  validateMask(mask);
  const { width, height, data } = mask;
  const px = point[0] * REFERENCE_WIDTH, py = point[1] * referenceHeight;
  const stepX = REFERENCE_WIDTH / width, stepY = referenceHeight / height;
  const radius = diameter / 2;
  const left = Math.max(0, Math.floor((px - radius) / stepX));
  const right = Math.min(width - 1, Math.floor((px + radius) / stepX));
  const top = Math.max(0, Math.floor((py - radius) / stepY));
  const bottom = Math.min(height - 1, Math.floor((py + radius) / stepY));
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (data[row * width + col] && segmentCellDistanceSquared(px, py, px, py,
        col * stepX, row * stepY, (col + 1) * stepX, (row + 1) * stepY) < radius * radius) return true;
    }
  }
  return false;
}

// Distance in reference px from `point` to the farthest painted cell corner:
// the anchor's falloff spans exactly the painted region.
export function maskReach(mask, point, referenceHeight) {
  validateMask(mask);
  const { width, height, data } = mask;
  const px = point[0] * REFERENCE_WIDTH, py = point[1] * referenceHeight;
  const stepX = REFERENCE_WIDTH / width, stepY = referenceHeight / height;
  let reach = 0;
  for (let row = 0; row < height; row++) {
    const dy = Math.max(Math.abs(row * stepY - py), Math.abs((row + 1) * stepY - py));
    for (let col = 0; col < width; col++) {
      if (!data[row * width + col]) continue;
      const dx = Math.max(Math.abs(col * stepX - px), Math.abs((col + 1) * stepX - px));
      reach = Math.max(reach, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(reach);
}

// Squared distance from a finite segment to a texel rectangle. Unlike a
// center-only test, this keeps small clicks effective on coarse portrait masks.
function segmentCellDistanceSquared(ax, ay, bx, by, left, top, right, bottom) {
  const dx = bx - ax, dy = by - ay;
  let near = 0, far = 1;
  if (dx === 0) {
    if (ax < left || ax > right) far = -1;
  } else {
    const a = (left - ax) / dx, b = (right - ax) / dx;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (dy === 0) {
    if (ay < top || ay > bottom) far = -1;
  } else {
    const a = (top - ay) / dy, b = (bottom - ay) / dy;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (near <= far) return 0;
  let distance = Math.min(
    Math.max(left - ax, 0, ax - right) ** 2 + Math.max(top - ay, 0, ay - bottom) ** 2,
    Math.max(left - bx, 0, bx - right) ** 2 + Math.max(top - by, 0, by - bottom) ** 2,
  );
  const length = dx * dx + dy * dy;
  for (let corner = 0; corner < 4; corner++) {
    const x = (corner & 1 ? right : left) - ax;
    const y = (corner & 2 ? bottom : top) - ay;
    const t = length ? Math.max(0, Math.min(1, (x * dx + y * dy) / length)) : 0;
    distance = Math.min(distance, (x - t * dx) ** 2 + (y - t * dy) ** 2);
  }
  return distance;
}

// `base` (the mask data when the stroke began) caps a stroke at one pass of
// `amount`, however slowly or often the pointer crosses the same cells.
// Without it every call accumulates.
export function paintMask(mask, from, to, diameter, amount, referenceHeight, base = null) {
  validateMask(mask);
  if (!from || !to || from.length !== 2 || to.length !== 2 ||
      !from.every(Number.isFinite) || !to.every(Number.isFinite) ||
      !Number.isFinite(diameter) || diameter <= 0 ||
      !Number.isFinite(amount) || amount < -1 || amount > 1 ||
      !Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw new RangeError('Brush geometry and amount must be finite and valid.');
  }
  if (base && !(base instanceof Uint8Array && base.length === mask.data.length)) {
    throw new RangeError('Brush stroke base must match the mask.');
  }
  if (amount === 0) return false;
  const { width, height, data } = mask;
  const ax = from[0] * REFERENCE_WIDTH, ay = from[1] * referenceHeight;
  const bx = to[0] * REFERENCE_WIDTH, by = to[1] * referenceHeight;
  const stepX = REFERENCE_WIDTH / width, stepY = referenceHeight / height;
  const radius = diameter / 2, radiusSquared = radius * radius;
  const left = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / stepX));
  const right = Math.min(width - 1, Math.floor((Math.max(ax, bx) + radius) / stepX));
  const top = Math.max(0, Math.floor((Math.min(ay, by) - radius) / stepY));
  const bottom = Math.min(height - 1, Math.floor((Math.max(ay, by) + radius) / stepY));
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  if (![ax, ay, bx, by, length, radiusSquared].every(Number.isFinite)) {
    throw new RangeError('Brush geometry exceeds the supported coordinate range.');
  }
  const strength = 255 * Math.abs(amount), direction = Math.sign(amount);
  const cell = Math.max(stepX, stepY);
  let changed = false;
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const cellLeft = col * stepX, cellTop = row * stepY;
      const distanceSquared = segmentCellDistanceSquared(ax, ay, bx, by,
        cellLeft, cellTop, cellLeft + stepX, cellTop + stepY);
      if (distanceSquared >= radiusSquared) continue;
      const x = cellLeft + stepX / 2 - ax, y = cellTop + stepY / 2 - ay;
      const t = length ? Math.max(0, Math.min(1, (x * dx + y * dy) / length)) : 0;
      const centerDistance = Math.hypot(x - t * dx, y - t * dy);
      // A hard round brush, anti-aliased over one cell: what the cursor circle
      // covers is painted, nothing beyond half a cell outside it.
      const coverage = Math.max(0, Math.min(1, (radius - centerDistance) / cell + 0.5));
      if (!coverage) continue;
      const delta = Math.max(1, Math.round(strength * coverage));
      const index = row * width + col;
      let next;
      if (base) {
        const target = Math.max(0, Math.min(255, base[index] + direction * delta));
        next = direction > 0 ? Math.max(data[index], target) : Math.min(data[index], target);
      } else next = Math.max(0, Math.min(255, data[index] + direction * delta));
      if (next === data[index]) continue;
      data[index] = next;
      changed = true;
    }
  }
  if (changed) mask.version++;
  return changed;
}

export function transformMask(mask, fromBounds, toBounds) {
  validateMask(mask);
  validateBounds(fromBounds);
  validateBounds(toBounds);
  const { width, height, data } = mask;
  const result = { width, height, data: new Uint8Array(data.length), version: mask.version + 1 };
  for (let row = 0; row < height; row++) {
    const v = ((row + 0.5) / height - toBounds[1]) / toBounds[3];
    if (v < 0 || v >= 1) continue;
    const y = fromBounds[1] + v * fromBounds[3];
    if (y < 0 || y >= 1) continue;
    const sourceRow = Math.floor(y * height);
    for (let col = 0; col < width; col++) {
      const u = ((col + 0.5) / width - toBounds[0]) / toBounds[2];
      if (u < 0 || u >= 1) continue;
      const x = fromBounds[0] + u * fromBounds[2];
      if (x < 0 || x >= 1) continue;
      result.data[row * width + col] = data[sourceRow * width + Math.floor(x * width)];
    }
  }
  return result;
}

// Motion field: the painted strengths blurred by `softness` reference px.
// Unlike an inward feather, the field reaches past the stroke edge, so the
// object's silhouette moves with it (dragging nearby background along)
// instead of staying pinned while only the interior warps.
export function blurMask(mask, softness, referenceHeight) {
  validateMask(mask);
  if (!Number.isFinite(softness) || softness < 0 ||
      !Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    throw new RangeError('Blur softness and reference height must be finite.');
  }
  const { width, height, data } = mask;
  // Three box passes approximate a Gaussian whose support is 3x the box radius.
  const rx = Math.round(softness / 3 / (REFERENCE_WIDTH / width));
  const ry = Math.round(softness / 3 / (referenceHeight / height));
  let field = Float32Array.from(data);
  let scratch = new Float32Array(data.length);
  for (let pass = 0; pass < 3; pass++) {
    if (rx > 0) { boxPass(field, scratch, width, height, rx, 1, width); [field, scratch] = [scratch, field]; }
    if (ry > 0) { boxPass(field, scratch, height, width, ry, width, 1); [field, scratch] = [scratch, field]; }
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < out.length; i++) out[i] = field[i] + 0.5;
  return out;
}

// Running-sum box blur along one axis (`count` samples `step` apart, for
// `lines` lines `lineStep` apart), replicating edge values past the image.
function boxPass(source, target, count, lines, radius, step, lineStep) {
  const size = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    const start = line * lineStep;
    const first = source[start], last = source[start + (count - 1) * step];
    let sum = 0;
    for (let i = -radius; i <= radius; i++)
      sum += i < 0 ? first : i >= count ? last : source[start + i * step];
    const scale = 1 / size;
    for (let i = 0; i < count; i++) {
      target[start + i * step] = sum * scale;
      const add = i + radius + 1, drop = i - radius;
      sum += (add < count ? source[start + add * step] : last) - (drop >= 0 ? source[start + drop * step] : first);
    }
  }
}
