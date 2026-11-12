import { createRenderer } from './renderer.js';

const abortError = () => new DOMException('Export cancelled.', 'AbortError');

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function waitUntil(deadline, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(abortError());
    };
    const timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

async function encodeGif(
  canvas,
  context,
  renderFrame,
  duration,
  fps,
  onProgress,
  signal
) {
  const worker = new Worker(new URL('./gif-worker.js', import.meta.url), {
    type: 'module',
  });
  let pending;
  const fail = (error) => {
    pending?.reject(error);
    pending = undefined;
  };
  const cancel = () => {
    worker.terminate();
    fail(abortError());
  };
  worker.onmessage = ({ data }) => {
    const request = pending;
    pending = undefined;
    if (data.error) request?.reject(new Error(data.error));
    else request?.resolve(data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail(new Error(event.message || 'GIF encoding worker failed.'));
  };
  worker.onmessageerror = () =>
    fail(new Error('Could not receive the encoded GIF.'));
  const send = (message, transfer = []) => {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        pending = undefined;
        reject(error);
      }
    });
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await send({ type: 'init', width: canvas.width, height: canvas.height });
    const count = Math.ceil(duration * fps);
    for (let i = 0; i < count; i++) {
      checkAbort(signal);
      renderFrame(i / fps);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      // GIF delays are centiseconds; cumulative rounding preserves total duration.
      const start = Math.round((i / fps) * 100);
      const end = Math.round(Math.min(duration, (i + 1) / fps) * 100);
      await send(
        { type: 'frame', pixels: data.buffer, delay: (end - start) * 10 },
        [data.buffer]
      );
      onProgress(((i + 1) / count) * 0.98);
    }
    const { bytes } = await send({ type: 'finish' });
    checkAbort(signal);
    const blob = new Blob([bytes], { type: 'image/gif' });
    if (!blob.size) throw new Error('GIF encoding produced an empty file.');
    onProgress(1);
    return blob;
  } finally {
    signal?.removeEventListener('abort', cancel);
    worker.terminate();
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
  }
}

async function encodeWebm(
  canvas,
  renderFrame,
  duration,
  fps,
  onProgress,
  signal
) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
    throw new Error(
      'This browser does not support WebM recording. Try GIF instead.'
    );
  }
  const mimeType = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType)
    throw new Error(
      'This browser has no supported WebM encoder. Try GIF instead.'
    );

  let stream;
  let recorder;
  let recordingError;
  let settle;
  const chunks = [];
  const stopped = new Promise((resolve) => {
    settle = resolve;
  });
  const cancel = () => {
    if (recorder?.state !== 'inactive') recorder?.stop();
  };
  try {
    checkAbort(signal);
    renderFrame(0);
    // Explicit capture avoids recording unrelated paints or variable animation times.
    stream = canvas.captureStream(0);
    let track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Could not capture the export canvas.');
    if (typeof track.requestFrame !== 'function') {
      stream.getTracks().forEach((item) => item.stop());
      stream = canvas.captureStream(fps);
      track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Could not capture the export canvas.');
    }
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data);
    };
    recorder.onerror = (event) => {
      recordingError = event.error || new Error('WebM recording failed.');
      settle();
    };
    recorder.onstop = () => settle();
    signal?.addEventListener('abort', cancel, { once: true });
    recorder.start();
    const start = performance.now();
    const count = Math.ceil(duration * fps);
    for (let i = 0; i < count; i++) {
      await waitUntil(start + (i * 1000) / fps, signal);
      checkAbort(signal);
      if (recordingError) throw recordingError;
      if (recorder.state !== 'recording')
        throw new Error('WebM recording stopped unexpectedly.');
      if (i > 0) renderFrame(i / fps);
      track.requestFrame?.();
      onProgress(((i + 1) / count) * 0.98);
    }
    await waitUntil(start + duration * 1000, signal);
    checkAbort(signal);
    if (recordingError) throw recordingError;
    if (recorder.state !== 'recording')
      throw new Error('WebM recording stopped unexpectedly.');
    recorder.stop();
    await stopped;
    checkAbort(signal);
    if (recordingError) throw recordingError;
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error('WebM recording produced an empty file.');
    onProgress(1);
    return blob;
  } finally {
    signal?.removeEventListener('abort', cancel);
    try {
      if (recorder) {
        recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
}

export async function exportAnimation({
  image,
  regions,
  format,
  width,
  duration,
  fps,
  onProgress = () => {},
  signal,
}) {
  checkAbort(signal);
  if (format !== 'gif' && format !== 'webm')
    throw new Error('Unsupported animation format.');
  if (
    ![width, duration, fps].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    throw new Error(
      'Export width, duration, and frame rate must be positive numbers.'
    );
  }
  const imageWidth = image?.naturalWidth || image?.width;
  const imageHeight = image?.naturalHeight || image?.height;
  if (!imageWidth || !imageHeight)
    throw new Error('The source image has no dimensions.');
  const output = document.createElement('canvas');
  const surface = document.createElement('canvas');
  const edge = Math.min(format === 'gif' ? 720 : 1080, Math.round(width));
  const scale = edge / Math.max(imageWidth, imageHeight);
  output.width = surface.width = Math.max(1, Math.round(imageWidth * scale));
  output.height = surface.height = Math.max(1, Math.round(imageHeight * scale));
  const context = output.getContext('2d', {
    alpha: false,
    willReadFrequently: format === 'gif',
  });
  if (!context) throw new Error('Could not create the export canvas.');
  let renderer;
  try {
    renderer = createRenderer(surface, image);
    renderer.setRegions(regions);
    const renderFrame = (time) => {
      renderer.render(time, { loop: duration });
      // GIF has no partial alpha; use the same warm-white matte for both formats.
      context.fillStyle = '#fffaf2';
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(surface, 0, 0);
    };
    onProgress(0);
    return await (format === 'gif'
      ? encodeGif(
          output,
          context,
          renderFrame,
          duration,
          fps,
          onProgress,
          signal
        )
      : encodeWebm(output, renderFrame, duration, fps, onProgress, signal));
  } finally {
    renderer?.destroy();
    surface
      .getContext('webgl')
      ?.getExtension('WEBGL_lose_context')
      ?.loseContext();
    output.width = output.height = surface.width = surface.height = 0;
  }
}
