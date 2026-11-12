import { GIFEncoder, quantize, applyPalette } from 'gifenc';

let encoder;
let width;
let height;

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      width = data.width;
      height = data.height;
      encoder = GIFEncoder();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      const pixels = new Uint8Array(data.pixels);
      const palette = quantize(pixels, 256);
      const indexed = applyPalette(pixels, palette);
      // Full, opaque frames replace the previous frame without transparency trails.
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: data.delay,
        repeat: 0,
        dispose: 1,
      });
      self.postMessage({ type: 'frame' });
    } else if (data.type === 'finish') {
      encoder.finish();
      const bytes = encoder.bytesView();
      self.postMessage({ type: 'finished', bytes }, [bytes.buffer]);
      encoder = undefined;
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
