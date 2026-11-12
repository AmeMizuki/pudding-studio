import { EFFECTS, MAX_REGIONS, REFERENCE_WIDTH, REGION_COLORS } from './motion.js';
import { blurMask, maskBounds, maskReach } from './brush.js';

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform sampler2D u_masks;
uniform vec2 u_reference;
uniform float u_count;
uniform float u_tileSize;
uniform float u_still;
uniform float u_overlay;
uniform float u_selected;
uniform vec4 u_bounds[${MAX_REGIONS}];
uniform vec4 u_motion[${MAX_REGIONS}];
uniform vec4 u_hotspot[${MAX_REGIONS}];
uniform vec4 u_shape[${MAX_REGIONS}];
uniform vec3 u_colors[${MAX_REGIONS}];
const float TAU = 6.28318530718;

// Atlas tile per region, on the mask grid: r = blurred motion field (reaches
// past the strokes), a = support, 0 unpainted and 0.5..1 painted strength.
vec4 maskAt(float row, vec2 uv, vec2 shape) {
  vec2 at = clamp(uv * shape, vec2(0.5), shape - 0.5) / u_tileSize;
  return texture2D(u_masks, vec2(at.x, (row + at.y) / ${MAX_REGIONS}.0));
}

void main() {
  vec2 displacement = vec2(0.0);
  float totalWeight = 0.0;
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (float(i) >= u_count || u_still > 0.5) break;
    vec4 motion = u_motion[i];
    if (motion.x <= 0.0) continue;
    if (u_bounds[i].z <= 0.0) continue;
    vec4 shape = u_shape[i];
    vec4 hotspot = u_hotspot[i];
    vec2 delta = (v_uv - hotspot.xy) * u_reference;
    float r = length(delta) / shape.w;
    if (r >= 1.0) continue;
    // Full strength inside the core (shape.z of the range), fading to zero at its edge.
    float weight = maskAt(float(i), v_uv, shape.xy).r * (1.0 - smoothstep(shape.z, 1.0, r));
    if (weight <= 0.002) continue;
    vec2 direction = hotspot.zw;
    vec2 sideways = vec2(-direction.y, direction.x);
    // Local frame: x along the start angle, y across it, 1 = farthest painted point.
    vec2 p = vec2(dot(delta, direction), dot(delta, sideways)) / shape.w;
    float e = motion.z;
    // Small regions get proportionally smaller travel so the image never folds.
    float amplitude = min(motion.x, 0.35 * shape.w);
    vec2 offset;
    if (motion.w < 0.5) {
      // Jelly: each cycle is a tap followed by decaying wobbles; parts far
      // from the origin lag, and the body squashes at twice the sway rate.
      float t = fract(motion.y - r * 0.18);
      float wobbles = mix(1.5, 4.0, e);
      float envelope = exp(-mix(4.5, 2.0, e) * t) * (1.0 - t);
      float s = sin(TAU * wobbles * t) * envelope;
      float q = sin(2.0 * TAU * wobbles * t) * envelope * 0.45;
      offset = vec2(-p.x * q, s * (0.55 + 0.45 * clamp(p.x, -1.0, 1.0)) + p.y * q * 0.6);
    } else if (motion.w < 1.5) {
      // Sway: the anchor glides side to side and the painted weight follows,
      // farther parts trailing behind (springier = more follow-through).
      float t = TAU * (motion.y - r * mix(0.08, 0.3, e));
      float s = sin(t);
      // A pendulum rises slightly at both ends of its swing.
      offset = vec2(-0.15 * s * s, s);
    } else if (motion.w < 2.5) {
      // Bounce: smooth rise and fall along the start angle; squashes at the
      // bottom and stretches at the top around the anchor.
      float t = TAU * (motion.y - r * mix(0.05, 0.2, e));
      float height = 0.5 - 0.5 * cos(t);
      float squash = cos(t) * mix(0.15, 0.4, e);
      offset = vec2(height - p.x * squash, p.y * squash * 0.6);
    } else {
      // Ripple: two rings travelling outward. Travel is limited so neighbouring
      // crests never cross, and it fades in at the anchor to avoid a pinch.
      float t = TAU * (motion.y - r * 2.0);
      float wave = (sin(t) + e * 0.25 * sin(2.0 * t)) / (1.0 + e * 0.25);
      float limit = min(1.0, 0.45 * shape.w / (TAU * 2.0 * amplitude));
      offset = p / max(length(p), 1e-4) * wave * limit * smoothstep(0.0, 0.15, r);
    }
    displacement += (direction * offset.x + sideways * offset.y) * amplitude * weight;
    totalWeight += weight;
  }
  vec2 sourceUV = clamp(v_uv - displacement / (u_reference * max(1.0, totalWeight)), 0.0, 1.0);
  gl_FragColor = texture2D(u_image, sourceUV);
  if (u_overlay < 0.5) return;
  // Weight paint inside the strokes: painted strength x falloff from the
  // anchor, so colour is deepest at the anchor and fades toward the stroke's
  // far edge. Follows the moving content; the selected region is outlined.
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (float(i) >= u_count) break;
    if (u_bounds[i].z <= 0.0) continue;
    float row = float(i);
    float support = maskAt(row, sourceUV, u_shape[i].xy).a;
    if (support < 0.05) continue;
    float strength = clamp((support - 0.5) * 2.0, 0.0, 1.0);
    float r = length((sourceUV - u_hotspot[i].xy) * u_reference) / u_shape[i].w;
    float weight = strength * (1.0 - smoothstep(u_shape[i].z, 1.0, r));
    float inside = smoothstep(0.2, 0.3, support);
    float alpha = (0.1 + 0.4 * weight) * inside;
    if (row == u_selected)
      alpha = max((0.14 + 0.72 * weight) * inside, 0.95 * (1.0 - smoothstep(0.15, 0.24, abs(support - 0.25))));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, u_colors[i], alpha);
  }
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not allocate a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) || 'Unknown shader compiler error.';
    gl.deleteShader(shader);
    throw new Error(`Image renderer shader failed: ${message}`);
  }
  return shader;
}

function bounded(value, fallback, min, max) {
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

/**
 * GPU image-space deformation. Call setRegions after edits, then
 * render(seconds, { loop, overlay, selected, still }).
 */
export function createRenderer(canvas, image) {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (!(width > 0 && height > 0))
    throw new Error('The image must be loaded before creating the renderer.');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl)
    throw new Error(
      'WebGL is unavailable. Enable hardware acceleration or try another browser.'
    );

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  // ponytail: eight 512px strength/support tiles (needs 4096px textures); raise for finer masks.
  const tileSize = Math.min(512, Math.floor(maxTextureSize / MAX_REGIONS));
  if (tileSize < 4)
    throw new Error('This GPU cannot allocate the region mask atlas.');
  const referenceHeight = (REFERENCE_WIDTH * height) / width;
  const atlas = new Uint8Array(tileSize * tileSize * MAX_REGIONS * 2);
  const boundsUniform = new Float32Array(MAX_REGIONS * 4);
  const motionUniform = new Float32Array(MAX_REGIONS * 4);
  const hotspotUniform = new Float32Array(MAX_REGIONS * 4);
  const shapeUniform = new Float32Array(MAX_REGIONS * 4);
  const regions = new Array(MAX_REGIONS).fill(null);
  const masks = new Array(MAX_REGIONS).fill(null);
  let count = 0;
  let destroyed = false;
  let program, vertexShader, fragmentShader, buffer, sourceTexture, maskTexture;
  let locations;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (sourceTexture) gl.deleteTexture(sourceTexture);
    if (maskTexture) gl.deleteTexture(maskTexture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }

  function assertAvailable() {
    if (destroyed) throw new Error('The image renderer has been destroyed.');
    if (gl.isContextLost())
      throw new Error(
        'The WebGL context was lost. Reload the image to continue.'
      );
  }

  function configureTexture(texture, unit) {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  try {
    const precision = gl.getShaderPrecisionFormat(
      gl.FRAGMENT_SHADER,
      gl.HIGH_FLOAT
    );
    const highPrecision = precision && precision.precision > 0;
    vertexShader = compileShader(
      gl,
      gl.VERTEX_SHADER,
      highPrecision
        ? VERTEX_SHADER
        : VERTEX_SHADER.replace(
            'varying vec2 v_uv;',
            'varying mediump vec2 v_uv;'
          )
    );
    fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      highPrecision
        ? FRAGMENT_SHADER
        : FRAGMENT_SHADER.replace(
            'precision highp float;',
            'precision mediump float;'
          )
    );
    program = gl.createProgram();
    if (!program)
      throw new Error('WebGL could not allocate the image program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Image renderer linking failed: ${gl.getProgramInfoLog(program) || 'Unknown linker error.'}`
      );
    }
    gl.detachShader(program, vertexShader);
    gl.detachShader(program, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    vertexShader = fragmentShader = null;
    gl.useProgram(program);
    locations = Object.fromEntries(
      [
        'image',
        'masks',
        'reference',
        'count',
        'tileSize',
        'still',
        'overlay',
        'selected',
        'bounds',
        'motion',
        'hotspot',
        'shape',
        'colors',
      ].map((name) => [
        name,
        gl.getUniformLocation(
          program,
          `u_${name}${['bounds', 'motion', 'hotspot', 'shape', 'colors'].includes(name) ? '[0]' : ''}`
        ),
      ])
    );
    buffer = gl.createBuffer();
    sourceTexture = gl.createTexture();
    maskTexture = gl.createTexture();
    if (!buffer || !sourceTexture || !maskTexture)
      throw new Error('WebGL could not allocate the image textures.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    configureTexture(sourceTexture, gl.TEXTURE0);
    let source = image;
    if (width > maxTextureSize || height > maxTextureSize) {
      source = document.createElement('canvas');
      const scale = Math.min(maxTextureSize / width, maxTextureSize / height);
      source.width = Math.max(1, Math.floor(width * scale));
      source.height = Math.max(1, Math.floor(height * scale));
      const context = source.getContext('2d');
      if (!context)
        throw new Error('The browser could not resize this image for the GPU.');
      context.drawImage(image, 0, 0, source.width, source.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    configureTexture(maskTexture, gl.TEXTURE1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE_ALPHA,
      tileSize,
      tileSize * MAX_REGIONS,
      0,
      gl.LUMINANCE_ALPHA,
      gl.UNSIGNED_BYTE,
      atlas
    );
    if (gl.getError() !== gl.NO_ERROR)
      throw new Error(
        'The GPU could not upload this image or its region masks.'
      );
    gl.uniform1i(locations.image, 0);
    gl.uniform1i(locations.masks, 1);
    gl.uniform2f(locations.reference, REFERENCE_WIDTH, referenceHeight);
    gl.uniform1f(locations.tileSize, tileSize);
    gl.uniform3fv(locations.colors, REGION_COLORS.flatMap((hex) =>
      [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)));
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
  } catch (error) {
    destroy();
    throw error;
  }

  function setRegions(nextRegions) {
    assertAvailable();
    if (!Array.isArray(nextRegions) || nextRegions.length > MAX_REGIONS) {
      throw new Error(`The renderer supports at most ${MAX_REGIONS} regions.`);
    }
    // Validate the complete snapshot before changing the live renderer.
    const snapshot = nextRegions.map((region) => {
      if (!region || typeof region !== 'object')
        throw new Error('Each region must be an object.');
      if (!region.enabled) return null;
      const mask = region.mask;
      if (
        !mask ||
        !Number.isInteger(mask.width) || mask.width < 1 || mask.width > 512 ||
        !Number.isInteger(mask.height) || mask.height < 1 || mask.height > 512 ||
        !(mask.data instanceof Uint8Array) ||
        mask.data.length !== mask.width * mask.height ||
        !Number.isSafeInteger(mask.version) || mask.version < 0
      )
        throw new Error('Region masks must contain valid dimensions, byte strengths and a version.');
      if (mask.width > tileSize || mask.height > tileSize)
        throw new Error('This GPU cannot allocate masks at this resolution.');
      const origin = region.origin;
      if (
        !origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) ||
        origin.x < 0 || origin.x > 1 || origin.y < 0 || origin.y > 1
      )
        throw new Error('Region origins must be finite coordinates between 0 and 1.');
      if (!Number.isFinite(region.angle))
        throw new Error('Region angle must be a finite number.');
      const effect = EFFECTS.indexOf(region.effect);
      if (effect < 0)
        throw new Error(`Unknown region effect: ${region.effect}`);
      const bounds = maskBounds(mask);
      if (!bounds) return null;
      const angle = ((region.angle % 360) * Math.PI) / 180;
      // Edge softness of at least 2x the travel keeps the displacement slope
      // below 1 across the stroke edge, so the image never tears or folds.
      const amplitude = bounded(region.amplitude, 16, 0, 60);
      const softness = Math.max(bounded(region.feather, 8, 0, 30), 2 * amplitude);
      // Range scales the anchor's reach over the strokes (100% = farthest stroke).
      const reach = maskReach(mask, [origin.x, origin.y], referenceHeight) * bounded(region.range, 100, 20, 300) / 100;
      return {
        mask,
        data: mask.data,
        width: mask.width,
        height: mask.height,
        version: mask.version,
        bounds,
        originX: origin.x,
        originY: origin.y,
        directionX: Math.cos(angle),
        directionY: Math.sin(angle),
        // Falloff spans the (range-scaled) strokes plus their soft skirt.
        radius: Math.max(16, reach + softness),
        effect,
        amplitude,
        core: bounded(region.core, 30, 0, 90) / 100,
        speed: bounded(region.speed, 1, 0.25, 3),
        elasticity: bounded(region.elasticity, 50, 0, 100) / 100,
        softness,
      };
    });
    count = snapshot.length;
    boundsUniform.fill(0);
    motionUniform.fill(0);
    hotspotUniform.fill(0);
    shapeUniform.fill(0);
    for (let i = 0; i < MAX_REGIONS; i++) {
      const region = snapshot[i] || null;
      const previous = masks[i];
      regions[i] = region;
      if (
        Boolean(region) !== Boolean(previous) ||
        (region && (
          region.data !== previous.data || region.version !== previous.version ||
          region.width !== previous.width || region.height !== previous.height ||
          region.softness !== previous.softness ||
          region.bounds.some((value, index) => value !== previous.bounds[index])
        ))
      ) {
        const offset = i * tileSize * tileSize;
        const field = region && blurMask(region.mask, region.softness, referenceHeight);
        for (let row = 0; row < tileSize; row++) {
          for (let col = 0; col < tileSize; col++) {
            const pixel = offset + row * tileSize + col;
            const source = region && row < region.height && col < region.width
              ? row * region.width + col : -1;
            // r: blurred motion field; a: support, 0 unpainted, 128..255 painted strength.
            atlas[pixel * 2] = source < 0 ? 0 : field[source];
            const raw = source < 0 ? 0 : region.data[source];
            atlas[pixel * 2 + 1] = raw ? 128 + (raw >> 1) : 0;
          }
        }
        masks[i] = region;
        // Upload just this region's tile (~0.5 MB) rather than the whole atlas.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i * tileSize, tileSize, tileSize,
          gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, atlas.subarray(offset * 2, (offset + tileSize * tileSize) * 2));
      }
      if (region) {
        const offset = i * 4;
        boundsUniform.set(region.bounds, offset);
        motionUniform[offset] = region.amplitude;
        motionUniform[offset + 2] = region.elasticity;
        motionUniform[offset + 3] = region.effect;
        hotspotUniform[offset] = region.originX;
        hotspotUniform[offset + 1] = region.originY;
        hotspotUniform[offset + 2] = region.directionX;
        hotspotUniform[offset + 3] = region.directionY;
        shapeUniform[offset] = region.width;
        shapeUniform[offset + 1] = region.height;
        shapeUniform[offset + 2] = region.core;
        shapeUniform[offset + 3] = region.radius;
      }
    }
    gl.useProgram(program);
    gl.uniform1f(locations.count, count);
    gl.uniform4fv(locations.bounds, boundsUniform);
    gl.uniform4fv(locations.hotspot, hotspotUniform);
    gl.uniform4fv(locations.shape, shapeUniform);
  }

  // `loop` (seconds) snaps each region to whole cycles so exports loop
  // seamlessly; `still` renders undeformed, e.g. while painting.
  function render(timeSeconds = 0, { loop = 0, overlay = false, selected = -1, still = false } = {}) {
    assertAvailable();
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(loop) || loop < 0)
      throw new Error('Animation time and loop length must be finite.');
    if (!Number.isInteger(selected) || selected < -1 || selected >= MAX_REGIONS)
      throw new Error(`Selected region must be an integer between -1 and ${MAX_REGIONS - 1}.`);
    for (let i = 0; i < count; i++) {
      const region = regions[i];
      if (!region) continue;
      const frequency = loop > 0 ? Math.max(1, Math.round(region.speed * loop)) / loop : region.speed;
      // Reduce on the CPU before float upload, retaining phase at long times.
      motionUniform[i * 4 + 1] = (((timeSeconds * frequency) % 1) + 1) % 1;
    }
    gl.useProgram(program);
    gl.uniform4fv(locations.motion, motionUniform);
    gl.uniform1f(locations.still, still ? 1 : 0);
    gl.uniform1f(locations.overlay, overlay ? 1 : 0);
    gl.uniform1f(locations.selected, selected);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const viewportWidth = Math.max(1, Math.round(width * scale));
    const viewportHeight = Math.max(1, Math.round(height * scale));
    gl.viewport(
      Math.floor((canvas.width - viewportWidth) / 2),
      Math.floor((canvas.height - viewportHeight) / 2),
      viewportWidth,
      viewportHeight
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return { setRegions, render, destroy };
}
