export const MAX_REGIONS = 8;
export const REFERENCE_WIDTH = 960;
export const EFFECTS = ['jelly', 'sway', 'bounce', 'ripple'];
// Saturated so painted regions stay obvious over any photo; index matches region order.
export const REGION_COLORS = ['#f0186f', '#ff7a00', '#7c3aed', '#16a34a', '#e11d1d', '#0e7490', '#c026d3', '#ca8a04'];

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

// A signed edge distance produces inward feathering, including concave polygons.
// Subtracting one texel diagonal makes bilinear filtering conservative: its
// support cannot reach outside the original selection.
export function rasterizeMask(
  points,
  bounds,
  referenceHeight,
  size,
  feather,
  output,
  offset = 0
) {
  const scaleX = REFERENCE_WIDTH;
  const scaleY = referenceHeight;
  const stepX = (bounds[2] * scaleX) / size;
  const stepY = (bounds[3] * scaleY) / size;
  const inset = Math.hypot(stepX, stepY);
  const falloff = Math.max(feather, inset, 0.001);
  const vertices = points.map(([x, y]) => [x * scaleX, y * scaleY]);
  for (let row = 0; row < size; row++) {
    const y = bounds[1] * scaleY + (row + 0.5) * stepY;
    for (let col = 0; col < size; col++) {
      const x = bounds[0] * scaleX + (col + 0.5) * stepX;
      let inside = false;
      let distanceSquared = Infinity;
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[j],
          b = vertices[i];
        if (
          a[1] > y !== b[1] > y &&
          x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared
          ? Math.max(
              0,
              Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared)
            )
          : 0;
        const distanceX = x - a[0] - t * dx;
        const distanceY = y - a[1] - t * dy;
        distanceSquared = Math.min(
          distanceSquared,
          distanceX * distanceX + distanceY * distanceY
        );
      }
      output[offset + row * size + col] = inside
        ? Math.round(
            255 * smoothstep((Math.sqrt(distanceSquared) - inset) / falloff)
          )
        : 0;
    }
  }
}
