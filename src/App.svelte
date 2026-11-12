<script>
  import { onMount } from 'svelte';
  import { Dialog } from 'bits-ui';
  import {
    Upload,
    Download,
    ChevronDown,
    ChevronRight,
    Plus,
    MousePointer2,
    Brush,
    Eraser,
    Anchor,
    Eye,
    EyeOff,
    Trash2,
    Undo2,
    Redo2,
    Play,
    Pause,
    RotateCcw,
    Maximize,
    BadgeHelp,
    TriangleAlert,
    Film,
    X,
    Check,
    ShieldCheck,
    MoveHorizontal,
    MoveVertical,
    Waves,
    SlidersHorizontal,
    Sparkles,
    Hourglass,
  } from 'lucide-svelte';
  import Button from './lib/components/ui/button/button.svelte';
  import Switch from './lib/components/ui/switch/switch.svelte';
  import { createRenderer } from './lib/renderer.js';
  import { exportAnimation } from './lib/exporter.js';
  import { createDemo, demoPoints } from './lib/demo.js';
  import { REFERENCE_WIDTH, REGION_COLORS, rasterizeMask } from './lib/motion.js';
  import { createMask, maskBounds, maskTouches, paintMask, sampleMask, transformMask } from './lib/brush.js';
  import { messages } from './lib/i18n.js';

  let lang = $state('zh');
  const t = $derived(messages[lang]);
  let canvas, stage, fileInput, renderer;
  let stageWidth = $state(600);
  let overlay = $state.raw(null);
  let source = $state.raw(null);
  let sourceUrl = $state('');
  let imageName = $state('');
  let imageSize = $state([960, 720]);
  let isDemo = $state(true);
  let initialized = $state(false);
  let fatal = $state(false);
  let loading = $state(false);
  let selectedId = $state('demo');
  const defaults = {
    effect: 'jelly',
    amplitude: 18,
    speed: 1.2,
    elasticity: 65,
    feather: 18,
    range: 100,
    core: 30,
    angle: -90,
  };
  let regions = $state([
    {
      id: 'demo',
      name: '',
      mask: createDemoMask(),
      origin: { x: 0.5, y: 0.4 },
      enabled: true,
      ...defaults,
    },
  ]);
  const selectedIndex = $derived(regions.findIndex((r) => r.id === selectedId));
  let selected = $derived(regions[selectedIndex]);
  const hasMotion = $derived(regions.some((r) => { r.mask.version; return r.enabled && !!maskBounds(r.mask); }));
  let tool = $state('brush');
  let brushSize = $state(96);
  let brushStrength = $state(100);
  let cursor = $state.raw(null);
  let hoverStrength = $state(0);
  let showRegions = $state(true);
  let original = $state(false);
  let playing = $state(true);
  let looping = $state(true);
  let previewSpeed = $state(1);
  let clock = $state(0);
  let duration = $state(3);
  let format = $state('webm');
  let outputWidth = $state(720);
  let fps = $state(24);
  let zoom = $state(100);
  let helpOpen = $state(false);
  let exporting = $state(false);
  let progress = $state(0);
  let notice = $state('');
  let noticeError = $state(false);
  let dragOver = $state(false);
  let past = $state([]),
    future = $state([]);
  let gesture = $state.raw(null);
  let currentTime = 0,
    dirty = true,
    frame = 0,
    lastFrame = 0,
    lastClock = 0,
    toastTimer,
    abortController,
    imageTicket = 0;
  const styles = [
    { id: 'jelly', icon: Sparkles },
    { id: 'sway', icon: MoveHorizontal },
    { id: 'bounce', icon: MoveVertical },
    { id: 'ripple', icon: Waves },
  ];
  const tools = [
    { id: 'brush', icon: Brush },
    { id: 'erase', icon: Eraser },
    { id: 'select', icon: MousePointer2 },
  ];
  const hotspotParams = [
    { key: 'angle', label: 'angle', min: -180, max: 180, step: 1, unit: '°', low: 'angleLeft', high: 'angleRight' },
    { key: 'range', label: 'range', min: 20, max: 300, step: 5, unit: '%', low: 'near', high: 'far' },
    { key: 'core', label: 'core', min: 0, max: 90, step: 5, unit: '%', low: 'fade', high: 'even' },
  ];
  const params = [
    {
      key: 'amplitude',
      label: 'amplitude',
      min: 0,
      max: 60,
      step: 1,
      unit: 'px',
      low: 'gentle',
      high: 'strong',
    },
    {
      key: 'speed',
      label: 'frequency',
      min: 0.25,
      max: 3,
      step: 0.05,
      unit: 'Hz',
      low: 'slow',
      high: 'fast',
    },
    {
      key: 'elasticity',
      label: 'elasticity',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      low: 'soft',
      high: 'springy',
    },
    {
      key: 'feather',
      label: 'feather',
      min: 0,
      max: 30,
      step: 1,
      unit: 'px',
      low: 'sharp',
      high: 'smooth',
    },
  ];
  const referenceHeight = $derived(REFERENCE_WIDTH * imageSize[1] / imageSize[0]);
  const selectedBounds = $derived.by(() => {
    if (!selected) return null;
    selected.mask.version;
    return maskBounds(selected.mask);
  });
  const bounds = $derived(selectedBounds ? { x: selectedBounds[0], y: selectedBounds[1], w: selectedBounds[2], h: selectedBounds[3] } : null);
  const toolHint = $derived(tool === 'select' ? t.editHint : tool === 'erase' ? t.eraseHint : t.drawHint);
  const ToolIcon = $derived(tools.find((item) => item.id === tool)?.icon ?? Brush);
  function createDemoMask() {
    const mask = createMask(960, 720);
    const seed = new Uint8Array(512 * 512);
    rasterizeMask(demoPoints, [0, 0, 1, 1], 720, 512, 0, seed);
    for (let y = 0; y < mask.height; y++) {
      const sy = Math.min(511, Math.floor((y + 0.5) * 512 / mask.height));
      for (let x = 0; x < mask.width; x++)
        mask.data[y * mask.width + x] = seed[sy * 512 + Math.floor((x + 0.5) * 512 / mask.width)];
    }
    mask.version++;
    return mask;
  }
  const outputSize = (edge) => {
    const scale = Number(edge) / Math.max(...imageSize);
    return imageSize.map((n) => Math.max(1, Math.round(n * scale)));
  };
  const nameFor = (r, i = 0) =>
    r.name ||
    (r.id === 'demo'
      ? lang === 'zh'
        ? '布丁本體'
        : 'Pudding body'
      : `${t.region} ${i + 1}`);
  function notify(message, error = false) {
    notice = message;
    noticeError = error;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (notice = ''), 6000);
  }
  function snapshot() {
    return { regions: structuredClone($state.snapshot(regions)), selectedId };
  }
  function remember() {
    const before = snapshot();
    past = [...past.slice(-29), before];
    future = [];
    return before;
  }
  function restore(s) {
    regions = structuredClone($state.snapshot(s.regions));
    selectedId = s.selectedId;
  }
  function undo() {
    if (!past.length || exporting) return;
    if (gesture) { cancelGesture(); return; }
    future = [...future, snapshot()];
    const s = past.at(-1);
    past = past.slice(0, -1);
    restore(s);
  }
  function redo() {
    if (!future.length || exporting || gesture) return;
    past = [...past, snapshot()];
    const s = future.at(-1);
    future = future.slice(0, -1);
    restore(s);
  }
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  function addRegion(record = true) {
    if (regions.length >= 8) {
      notify(t.maxRegions, true);
      return null;
    }
    if (record) remember();
    const id = crypto.randomUUID();
    regions = [...regions, {
      id, name: `${t.region} ${regions.length + 1}`,
      mask: createMask(...imageSize),
      origin: { x: 0.5, y: 0.5 },
      enabled: true, ...defaults,
    }];
    selectedId = id;
    tool = 'brush';
    showRegions = true;
    original = false;
    return regions.at(-1);
  }
  function removeRegion(id) {
    remember();
    regions = regions.filter((r) => r.id !== id);
    if (selectedId === id) selectedId = regions.at(-1)?.id || '';
  }
  function updateParam(key, value) {
    if (!selected) return;
    const p = params.find((p) => p.key === key) || hotspotParams.find((p) => p.key === key);
    if (p) selected[key] = clamp(Number(value) || 0, p.min, p.max);
  }
  function setEffect(id) {
    if (!selected) return;
    remember();
    selected.effect = id;
  }
  function moveRegion(region, sourceMask, from, to, origin) {
    region.mask = transformMask(sourceMask, from, to);
    region.origin = {
      x: clamp(to[0] + (origin.x - from[0]) * to[2] / from[2]),
      y: clamp(to[1] + (origin.y - from[1]) * to[3] / from[3]),
    };
  }
  function changeGeometry(key, value) {
    if (!selected || !bounds) return;
    remember();
    const next = { ...bounds, [key]: Number(value) / 100 || 0 };
    next.w = clamp(next.w, 0.02, 1);
    next.h = clamp(next.h, 0.02, 1);
    next.x = clamp(next.x, 0, 1 - next.w);
    next.y = clamp(next.y, 0, 1 - next.h);
    moveRegion(selected, selected.mask, selectedBounds, [next.x, next.y, next.w, next.h], selected.origin);
  }
  function pointerPosition(e, rect) {
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)];
  }
  function pointerDown(e) {
    if (gesture || exporting || loading || original || !initialized || fatal || e.button !== 0) return;
    const rect = overlay.getBoundingClientRect();
    const p = pointerPosition(e, rect);
    const handle = tool === 'select' ? e.target.closest?.('[data-hotspot]')?.dataset.hotspot : null;
    let region = selected;
    if (tool === 'select' && !handle) {
      region = regions.findLast((r) => r.enabled && sampleMask(r.mask, ...p) > 0);
      if (!region) return;
      selectedId = region.id;
    } else if (tool === 'brush') {
      // Extend the selected region if the brush overlaps it (or it is still
      // empty), else any region it overlaps; otherwise start a new region.
      const touches = (r) => maskTouches(r.mask, p, brushSize, referenceHeight);
      if (!region || (maskBounds(region.mask) && !touches(region))) {
        region = regions.findLast((r) => r.enabled && touches(r)) || null;
        if (region) selectedId = region.id;
      }
    }
    if (!region && tool !== 'brush') { notify(t.noRegion, true); return; }
    if (!region && regions.length >= 8) { notify(t.maxRegions, true); return; }
    const savedFuture = future;
    const before = remember();
    if (!region) region = addRegion(false);
    const resume = playing;
    playing = false;
    overlay.setPointerCapture(e.pointerId);
    gesture = {
      kind: handle || (tool === 'select' ? 'move' : 'paint'),
      rect, start: p, last: p, id: region.id, pointerId: e.pointerId,
      resume, before, future: savedFuture,
      origin: { ...region.origin },
      sourceMask: before.regions.find((r) => r.id === region.id)?.mask,
      bounds: maskBounds(region.mask),
      amount: (tool === 'erase' ? -1 : 1) * brushStrength / 100,
      diameter: brushSize,
      // Mask at stroke start: one stroke adds (or removes) at most one pass of flow.
      base: region.mask.data.slice(),
    };
    if (gesture.kind === 'paint') {
      // The first dab of a region is the centre its wobble spreads from.
      if (!gesture.bounds && tool === 'brush') region.origin = { x: p[0], y: p[1] };
      region.enabled = true;
      paintMask(region.mask, p, p, gesture.diameter, gesture.amount, referenceHeight, gesture.base);
    }
    cursor = p;
  }
  function pointerMove(e) {
    const rect = gesture?.rect || overlay?.getBoundingClientRect();
    if (!rect) return;
    const p = pointerPosition(e, rect);
    cursor = p;
    hoverStrength = selected ? Math.round(sampleMask(selected.mask, ...p) / 255 * 100) : 0;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const region = regions.find((r) => r.id === gesture.id);
    if (!region) return;
    if (gesture.kind === 'paint') {
      paintMask(region.mask, gesture.last, p, gesture.diameter, gesture.amount, referenceHeight, gesture.base);
      gesture.last = p;
    } else if (gesture.kind === 'move' && gesture.bounds) {
      const b = gesture.bounds;
      const dx = clamp(p[0] - gesture.start[0], -b[0], 1 - b[0] - b[2]);
      const dy = clamp(p[1] - gesture.start[1], -b[1], 1 - b[1] - b[3]);
      moveRegion(region, gesture.sourceMask, b, [b[0] + dx, b[1] + dy, b[2], b[3]], gesture.origin);
    } else if (gesture.kind === 'anchor') {
      region.origin = {
        x: clamp(gesture.origin.x + p[0] - gesture.start[0]),
        y: clamp(gesture.origin.y + p[1] - gesture.start[1]),
      };
    }
  }
  function pointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    playing = gesture.resume;
    gesture = null;
    if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId);
  }
  function cancelGesture() {
    if (!gesture) return;
    const previous = gesture;
    gesture = null;
    restore(previous.before);
    past = past.slice(0, -1);
    future = previous.future;
    playing = previous.resume;
    if (overlay?.hasPointerCapture(previous.pointerId)) overlay.releasePointerCapture(previous.pointerId);
    cursor = null;
  }
  function initialize(image) {
    renderer?.destroy();
    source = image;
    imageSize = [
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    ];
    const scale = Math.min(1, 1440 / imageSize[0], 1440 / imageSize[1]);
    canvas.width = Math.max(1, Math.round(imageSize[0] * scale));
    canvas.height = Math.max(1, Math.round(imageSize[1] * scale));
    try {
      renderer = createRenderer(canvas, image);
      renderer.setRegions(regions);
      renderer.render(0, { overlay: showRegions, selected: selectedIndex });
      initialized = true;
      fatal = false;
    } catch (err) {
      console.error(err);
      fatal = true;
      notify(t.unavailable, true);
    }
    dirty = true;
    currentTime = 0;
    clock = 0;
  }
  async function loadFile(file) {
    if (!file || exporting) return;
    if (fileInput) fileInput.value = '';
    if (file.size > 20 * 1024 * 1024) {
      notify(t.tooLarge, true);
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      notify(t.invalidImage, true);
      return;
    }
    if ((!isDemo || past.length) && !confirm(t.confirmReplace)) return;
    const ticket = ++imageTicket;
    loading = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (ticket !== imageTicket) {
        URL.revokeObjectURL(url);
        return;
      }
      if (image.naturalWidth > 8192 || image.naturalHeight > 8192) {
        URL.revokeObjectURL(url);
        notify(t.largeDimensions, true);
        return;
      }
      if (sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
      regions = [];
      selectedId = '';
      past = [];
      future = [];
      sourceUrl = url;
      imageName = file.name;
      isDemo = false;
      tool = 'brush';
      original = false;
      initialize(image);
    } catch {
      URL.revokeObjectURL(url);
      notify(t.invalidImage, true);
    } finally {
      if (ticket === imageTicket) loading = false;
      if (fileInput) fileInput.value = '';
    }
  }
  function togglePlay() {
    if (currentTime >= duration) currentTime = 0;
    playing = !playing;
    lastFrame = 0;
    dirty = true;
  }
  function seek(value) {
    currentTime = Number(value);
    clock = currentTime;
    dirty = true;
  }
  function restart() {
    seek(0);
    lastFrame = 0;
  }
  function keyDown(e) {
    if (
      e.defaultPrevented ||
      (e.target instanceof HTMLElement &&
        (e.target.matches('input,textarea,select') ||
          e.target.isContentEditable)) ||
      helpOpen ||
      exporting
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (
      e.code === 'Space' &&
      !(
        e.target instanceof Element &&
        e.target.closest(
          'button,a[href],summary,[role="button"],[role="switch"],[role="slider"]'
        )
      )
    ) {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'Delete' && selected) {
      e.preventDefault();
      removeRegion(selectedId);
    } else if (e.key === 'Escape') {
      cancelGesture();
      tool = 'select';
    }
  }
  async function startExport() {
    if (exporting || !initialized || fatal) return;
    if (!hasMotion) {
      notify(t.noRegion, true);
      return;
    }
    exporting = true;
    progress = 0;
    abortController = new AbortController();
    const resume = playing;
    playing = false;
    try {
      const blob = await exportAnimation({
        image: source,
        regions: snapshot().regions,
        format,
        width: Number(outputWidth),
        duration: Number(duration),
        fps: Number(fps),
        onProgress: (p) => (progress = p),
        signal: abortController.signal,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${isDemo ? 'pudding' : imageName.replace(/\.[^.]+$/, '')}-wiggle.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify(t.exportSuccess);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        notify(t.exportFail, true);
      }
    } finally {
      exporting = false;
      playing = resume;
      lastFrame = 0;
    }
  }
  $effect(() => {
    if (initialized && !fatal) {
      renderer.setRegions(regions);
      dirty = true;
    }
  });
  $effect(() => { showRegions; selectedIndex; gesture; dirty = true; });
  $effect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    document.title =
      lang === 'zh'
        ? 'Pudding — 讓圖片 Q 彈起來'
        : 'Pudding — A little wobble. A lot of joy.';
  });
  $effect(() => {
    duration;
    dirty = true;
    if (currentTime > duration) seek(0);
  });
  $effect(() => {
    if (format === 'gif' && outputWidth > 720) outputWidth = 720;
  });
  onMount(() => {
    const resize = new ResizeObserver(([entry]) => { stageWidth = Math.max(1, entry.contentRect.width); });
    resize.observe(stage);
    try {
      lang = localStorage.getItem('pudding-language') === 'en' ? 'en' : 'zh';
    } catch {}
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    playing = !reduce.matches;
    const motionChange = (e) => {
      if (e.matches) playing = false;
    };
    reduce.addEventListener('change', motionChange);
    const demo = createDemo();
    sourceUrl = demo.toDataURL('image/png');
    initialize(demo);
    const tick = (now) => {
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
      lastFrame = now;
      if (playing && !exporting) {
        currentTime += delta * previewSpeed;
        if (currentTime >= duration) {
          if (looping) currentTime %= duration;
          else {
            currentTime = duration;
            playing = false;
          }
        }
        dirty = true;
      }
      if (initialized && !fatal && dirty) {
        renderer.render(currentTime, {
          loop: Number(duration),
          overlay: showRegions,
          selected: selectedIndex,
          still: !!gesture,
        });
        dirty = false;
      }
      if (now - lastClock > 80) {
        clock = currentTime;
        lastClock = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      renderer?.destroy();
      abortController?.abort();
      clearTimeout(toastTimer);
      reduce.removeEventListener('change', motionChange);
      if (sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    };
  });
  function toggleLanguage() {
    lang = lang === 'zh' ? 'en' : 'zh';
    try {
      localStorage.setItem('pudding-language', lang);
    } catch {}
  }
</script>

{#snippet parameterControl(p)}
  {#if selected}
    <div class="parameter">
      <div class="parameter-label">
        <label id={`param-label-${p.key}`} for={`param-${p.key}`}>{t[p.label]}</label>
        <div class="parameter-value">
          <input type="number" min={p.min} max={p.max} step={p.step}
            aria-labelledby={`param-label-${p.key}`} aria-label={`${t[p.label]} ${p.unit}`}
            value={Number(selected[p.key].toFixed(2))} disabled={exporting}
            onfocus={remember} oninput={(e) => updateParam(p.key, e.currentTarget.value)} />
          <span>{p.unit}</span>
        </div>
      </div>
      <input id={`param-${p.key}`} type="range" min={p.min} max={p.max} step={p.step}
        value={selected[p.key]} disabled={exporting}
        style={`--range-progress:${((selected[p.key] - p.min) / (p.max - p.min)) * 100}%`}
        onpointerdown={remember}
        onkeydown={(e) => { if (e.key.startsWith('Arrow')) remember(); }}
        oninput={(e) => updateParam(p.key, e.currentTarget.value)} />
      <div class="parameter-endpoints"><span>{t[p.low]}</span><span>{t[p.high]}</span></div>
    </div>
  {/if}
{/snippet}

<svelte:window onkeydown={keyDown} />
<input
  class="sr-only"
  type="file"
  hidden
  tabindex="-1"
  accept="image/png,image/jpeg,image/webp"
  bind:this={fileInput}
  onchange={(e) => loadFile(e.currentTarget.files?.[0])}
  aria-label={t.upload}
/>

<a class="skip-link" href="#workspace">{lang === 'zh' ? '跳至編輯器' : 'Skip to editor'}</a>
<header class="app-header">
  <a class="brand" href="./" aria-label="Pudding Studio">
    <span>pudding</span><span class="studio-label">studio</span>
  </a>
  <div class="header-project">{t.project}</div>
  <div class="header-actions">
    <span class="privacy"><ShieldCheck size={14} />{t.local}</span><button
      class="language-button"
      onclick={toggleLanguage}
      aria-label={lang === 'zh' ? 'Switch to English' : '切換繁體中文'}
      >{lang === 'zh' ? 'EN' : '繁中'}</button
    ><button
      class="icon-button help-button"
      onclick={() => (helpOpen = true)}
      aria-label={t.help}
      title={t.help}><BadgeHelp size={20} /></button
    ><Button
      class="header-export primary-button"
      onclick={startExport}
      disabled={exporting || fatal || !initialized}
      ><Download size={16} />{t.export}</Button
    >
  </div>
</header>

<main id="workspace">
  <div class="workspace-heading">
    <div>
      <span class="workspace-kicker">Pudding / {lang === 'zh' ? '創作工作台' : 'Animation workspace'}</span>
      <h1>{t.title}</h1>
      <p>{t.subtitle}</p>
    </div>
    <button class="text-button intro-help" onclick={() => (helpOpen = true)}
      >{t.help}<ChevronRight size={14} /></button
    >
  </div>

  <div class="editor-grid">

    <section class="preview-column" aria-label={t.preview}>
      <div class="preview-panel panel">
        <div class="preview-toolbar">
          <div class="preview-title">
            <h2>{t.preview}</h2>
            <span class="live-label">{t.live}</span>
          </div>
          <div class="canvas-actions">
            <button
              class="icon-button"
              onclick={undo}
              disabled={!past.length || exporting}
              aria-label={t.undo}
              title={`${t.undo} (Ctrl+Z)`}><Undo2 size={17} /></button
            ><button
              class="icon-button"
              onclick={redo}
              disabled={!future.length || exporting}
              aria-label={t.redo}
              title={`${t.redo} (Ctrl+Shift+Z)`}><Redo2 size={17} /></button
            ><span class="toolbar-divider"></span><button
              class:pressed={showRegions}
              class="icon-button"
              onclick={() => (showRegions = !showRegions)}
              aria-label={showRegions ? t.hideRegion : t.showRegion}
              title={showRegions ? t.hideRegion : t.showRegion}
              aria-pressed={showRegions}>{#if showRegions}<Eye size={20} />{:else}<EyeOff size={20} />{/if}</button
            ><button
              class:pressed={original}
              class="original-button"
              onclick={() => (original = !original)}
              aria-pressed={original}>{t.original}</button
            >
          </div>
        </div>
        <div class="brush-toolbar" aria-label={t.tools}>
          <div class="tool-buttons">
            {#each tools as item}
              <button class="tool-button" class:active={tool === item.id}
                aria-pressed={tool === item.id} aria-label={t[item.id]}
                disabled={exporting || loading}
                onclick={() => { tool = item.id; showRegions = true; original = false; }}>
                <item.icon size={18} /><span>{t[item.id]}</span>
              </button>
            {/each}
          </div>
          <div class="brush-settings">
            <div class="brush-setting">
              <label for="brush-size">{t.brushSize}<output>{brushSize} px</output></label>
              <input id="brush-size" type="range" min="8" max="240" step="4" bind:value={brushSize} disabled={exporting} />
            </div>
            <div class="brush-setting">
              <label for="brush-strength">{t.brushStrength}<output>{brushStrength}%</output></label>
              <input id="brush-strength" type="range" min="5" max="100" step="5" bind:value={brushStrength} disabled={exporting} />
            </div>
          </div>
          <div class="paint-legend">
            {#if selected}<span class="legend-chip" aria-hidden="true"
                style={`--region-color:${REGION_COLORS[selectedIndex]}`}></span>{/if}
            <span>{t.paintLegend}</span>
            <span class="paint-readout">{t.paintWeight} {cursor ? `${hoverStrength}%` : '—'}</span>
          </div>
        </div>
        <div
          class="canvas-workspace"
          class:is-drawing={tool !== 'select'}
          class:over={dragOver}
          ondragover={(e) => {
            e.preventDefault();
            dragOver = true;
          }}
          ondragleave={() => (dragOver = false)}
          ondrop={(e) => {
            e.preventDefault();
            dragOver = false;
            loadFile(e.dataTransfer?.files?.[0]);
          }}
          role="region"
          aria-label={t.preview}
        >
          <div
            class="image-stage"
            bind:this={stage}
            style={`aspect-ratio:${imageSize[0]}/${imageSize[1]};--image-ratio:${imageSize[0] / imageSize[1]};--image-zoom:${zoom / 100};`}
          >
            <canvas bind:this={canvas} aria-label={t.preview}></canvas>
            {#if original || fatal}<img
                class="original-image"
                src={sourceUrl}
                alt={isDemo ? t.sampleName : imageName}
              />{/if}
            {#if !original && !fatal}<svg
                bind:this={overlay}
                class:draw-mode={tool === 'brush' || tool === 'erase'}
                class="selection-overlay"
                viewBox={`0 0 ${REFERENCE_WIDTH} ${referenceHeight}`}
                preserveAspectRatio="none"
                onpointerdown={pointerDown}
                onpointermove={pointerMove}
                onpointerup={pointerUp}
                onpointercancel={cancelGesture}
                onpointerleave={() => { if (!gesture) cursor = null; }}
                role="img"
                aria-label={t.tools}
              >
                {#if showRegions && selected}
                  {#if bounds && tool === 'select'}
                    <rect class="paint-bounds" x={bounds.x * REFERENCE_WIDTH} y={bounds.y * referenceHeight}
                      width={bounds.w * REFERENCE_WIDTH} height={bounds.h * referenceHeight} />
                  {/if}
                  <g class="anchor" class:interactive={tool === 'select'}
                    style={`--region-color:${REGION_COLORS[selectedIndex]}`}
                    transform={`translate(${selected.origin.x * REFERENCE_WIDTH} ${selected.origin.y * referenceHeight}) scale(${REFERENCE_WIDTH / stageWidth})`}>
                    <title>{t.originDragHint}</title>
                    <rect class="hotspot-hit" x="-22" y="-22" width="44" height="44" data-hotspot="anchor" />
                    <circle class="anchor-dot" r="8" />
                  </g>
                {/if}
                {#if cursor && (tool === 'brush' || tool === 'erase')}
                  <g class="brush-cursor" class:subtract={tool === 'erase'}
                    transform={`translate(${cursor[0] * REFERENCE_WIDTH} ${cursor[1] * referenceHeight})`}>
                    <circle class="brush-ring-shadow" r={brushSize / 2} />
                    <circle class="brush-ring" r={brushSize / 2} />
                    <path class="brush-center" transform={`scale(${REFERENCE_WIDTH / stageWidth})`} d="M-6 0H6M0-6V6" />
                  </g>
                {/if}
              </svg>{/if}
          </div>
          {#if loading}<div class="loading-overlay">
              <Hourglass size={24} />{t.uploading}
            </div>{/if}
          <div class="canvas-image-tag">{imageSize[0]} × {imageSize[1]}</div>
        </div>
        <div class="canvas-bottom">
          <span><ToolIcon size={16} />{gesture?.kind === 'paint' ? t.drawing : toolHint}</span>
          <div class="zoom-control">
            <label><span>{t.zoom}</span><select bind:value={zoom} aria-label={t.zoom}
              ><option value={75}>75%</option><option value={100}>100%</option
              ><option value={125}>125%</option><option value={150}>150%</option
              ></select></label
            ><button
              class="icon-button small"
              onclick={() => (zoom = 100)}
              title={t.resetView}
              aria-label={t.resetView}><Maximize size={14} /></button
            >
          </div>
        </div>
      </div>
      <div class="playback-panel panel">
        <div class="playback-main">
          <button
            class="icon-button"
            onclick={restart}
            aria-label={t.restart}
            title={t.restart}><RotateCcw size={17} /></button
          ><button
            class="play-button"
            onclick={togglePlay}
            aria-label={playing ? t.pause : t.play}
            title={`${playing ? t.pause : t.play} (Space)`}
            disabled={fatal || exporting}
            >{#if playing}<Pause size={19} fill="currentColor" />{:else}<Play
                size={19}
                fill="currentColor"
              />{/if}</button
          ><span class="play-time"
            >{clock.toFixed(1)}<span
              >&nbsp;/ {Number(duration).toFixed(1)}s</span
            ></span
          ><label class="timeline-control"><span>{lang === 'zh' ? '預覽時間' : 'Preview time'}</span><input
            class="timeline"
            type="range"
            min="0"
            max={duration}
            step="0.01"
            value={clock}
            oninput={(e) => seek(e.currentTarget.value)}
            aria-label={lang === 'zh' ? '預覽時間' : 'Preview time'}
            disabled={exporting}
          /></label><label class="speed-control"><span>{t.speed}</span><select
            class="speed-select"
            bind:value={previewSpeed}
            aria-label={t.speed}
            ><option value={0.5}>0.5×</option><option value={1}>1×</option
            ><option value={1.5}>1.5×</option><option value={2}>2×</option
            ></select></label>
        </div>
        <div class="playback-secondary">
          <label class="loop-label"
            ><Switch bind:checked={looping} aria-label={t.loop} /><span>{t.loop}</span></label
          ><span class="keyboard-hint"><kbd>Space</kbd>{t.space}</span>
        </div>
      </div>
      <section class="export-panel panel">
        <h2><Download size={17} />{t.settings}</h2>
        <div class="export-form">
          <div class="export-field">
            <span>{t.format}</span>
            <div class="format-toggle">
              {#each ['webm', 'gif'] as f}<button
                  class:active={format === f}
                  onclick={() => (format = f)}
                  aria-pressed={format === f}
                  disabled={exporting}>{f === 'webm' ? 'WebM' : 'GIF'}</button
                >{/each}
            </div>
          </div>
          <div class="export-pair">
            <label
              ><span>{t.duration}</span><select
                bind:value={duration}
                disabled={exporting}
                >{#each [2, 3, 4, 5, 6] as d}<option value={d}
                    >{d} {t.seconds}</option
                  >{/each}</select
              ></label
            ><label
              ><span>{t.fps}</span><select bind:value={fps} disabled={exporting}
                >{#each [15, 24, 30] as f}<option value={f}>{f} fps</option
                  >{/each}</select
              ></label
            >
          </div>
          <label class="export-resolution"
            ><span>{t.resolution}</span><select
              bind:value={outputWidth}
              disabled={exporting}
              >{#each format === 'gif' ? [480, 720] : [480, 720, 1080] as edge}<option
                  value={edge}>{outputSize(edge).join(' × ')} px</option
                >{/each}</select
            ></label
          >
        </div>
        <p class="export-hint">
          <Film size={18} /><span
            >{format === 'gif' ? t.gifHint : t.webmHint}</span
          >
        </p>
        {#if exporting}<div class="export-progress" role="status">
            <div>
              <Hourglass size={18} />{t.exporting}<strong
                >{Math.round(progress * 100)}%</strong
              >
            </div>
            <progress value={progress} max="1"></progress><button
              class="text-button"
              onclick={() => abortController?.abort()}>{t.cancel}</button
            >
          </div>{:else}<Button
            class="primary-button export-button"
            onclick={startExport}
            disabled={fatal || !initialized || !hasMotion}
            ><Download size={16} />{t.export}<ChevronRight size={14} /></Button
          >{/if}
      </section>
    </section>
    <aside class="left-panel panel" aria-label={t.image}>
      <section class="image-section">
        <div class="section-heading">
          <h2>{t.image}</h2>
          <span class="section-index">01</span>
        </div>
        <button
          class:drag-over={dragOver}
          class="upload-zone"
          disabled={exporting || loading}
          onclick={() => fileInput.click()}
          ondragover={(e) => {
            e.preventDefault();
            dragOver = true;
          }}
          ondragleave={() => (dragOver = false)}
          ondrop={(e) => {
            e.preventDefault();
            dragOver = false;
            loadFile(e.dataTransfer?.files?.[0]);
          }}
          ><span class="upload-icon"><Upload size={20} /></span><strong
            >{loading ? t.uploading : t.upload}</strong
          ><small>{t.uploadHint}</small></button
        >
        <div class="image-file">
          <img src={sourceUrl} alt="" width="40" height="48" loading="lazy" decoding="async" />
          <div>
            <strong title={isDemo ? t.sampleName : imageName}
              >{isDemo ? t.sampleName : imageName}</strong
            ><small
              >{imageSize[0]} × {imageSize[1]} px{isDemo
                ? ` · ${t.example}`
                : ''}</small
            >
          </div>
          <button
            class="icon-button small"
            onclick={() => fileInput.click()}
            disabled={exporting}
            title={t.replace}
            aria-label={t.replace}><Upload size={14} /></button
          >
        </div>
      </section>
      <section class="regions-section">
        <div class="section-heading">
          <h2>{t.regions}</h2><span class="count-badge">{regions.length} / 8</span>
          <button
            class="icon-button small"
            onclick={() => addRegion()}
            title={t.add}
            aria-label={t.add}
            disabled={regions.length >= 8 || exporting}
            ><Plus size={17} /></button
          >
        </div>
        <p class="section-description">{t.regionHelp}</p>
        <div class="region-list">
          {#each regions as region, i (region.id)}<div
              class:selected={selectedId === region.id}
              class:region-disabled={!region.enabled}
              class="region-row"
            >
              <button
                class="region-select"
                onclick={() => {
                  selectedId = region.id;
                  tool = 'brush';
                  showRegions = true;
                }}
                disabled={exporting}
                ><span
                  class="region-swatch"
                  aria-hidden="true"
                  style={`--region-color:${REGION_COLORS[i]}`}
                ></span
                ><span>{nameFor(region, i)}</span></button
              ><button
                class="icon-button tiny"
                title={t.visibility}
                aria-label={`${t.visibility} ${nameFor(region, i)}`}
                aria-pressed={region.enabled}
                onclick={() => {
                  remember();
                  region.enabled = !region.enabled;
                }}
                disabled={exporting}
                >{#if region.enabled}<Eye size={18} />{:else}<EyeOff size={18} />{/if}</button
              ><button
                class="icon-button tiny delete-region"
                title={t.delete}
                aria-label={`${t.delete} ${nameFor(region, i)}`}
                onclick={() => removeRegion(region.id)}
                disabled={exporting}><Trash2 size={14} /></button
              >
            </div>{/each}
        </div>
        {#if !regions.length}<div class="regions-empty">
            <Brush size={25} /><strong>{t.emptyRegions}</strong>
            <p>{t.emptyHint}</p>
          </div>{/if}
        <Button
          variant="outline"
          class="add-region-button"
          onclick={() => addRegion()}
          disabled={regions.length >= 8 || exporting}
          ><Plus size={15} />{t.add}</Button
        >
        {#if selected}<details class="geometry">
            <summary>{t.geometry}<ChevronDown size={13} /></summary><label
              class="region-name"
              ><span>{t.rename}</span><input
                value={nameFor(selected, regions.indexOf(selected))}
                maxlength="30"
                disabled={exporting}
                onchange={(e) => {
                  remember();
                  selected.name = e.currentTarget.value.trim() || t.region;
                }}
              /></label
            >
            <div class="geometry-grid">
              {#each [{ key: 'x', name: 'x' }, { key: 'y', name: 'y' }, { key: 'w', name: 'width' }, { key: 'h', name: 'height' }] as item}<label
                  ><span>{t[item.name]} %</span><input
                    type="number"
                    aria-label={t[item.name]}
                    min={item.key === 'w' || item.key === 'h' ? 2 : 0}
                    max="100"
                    step="1"
                    disabled={exporting || !bounds}
                    value={Math.round((bounds?.[item.key] || 0) * 100)}
                    onchange={(e) =>
                      changeGeometry(item.key, e.currentTarget.value)}
                  /></label
                >{/each}
            </div>
          </details>{/if}
      </section>
      <div class="left-note">
        <ShieldCheck size={20} />
        <div><p>{t.exportNote}</p>{#if isDemo}<p>{t.sourceNotice}</p>{/if}</div>
      </div>
    </aside>

    <aside class="right-panel" aria-label={t.effect}>
      <section class="hotspot-panel panel">
        <div class="section-heading"><h2><Anchor size={20} />{t.hotspot}</h2><span class="section-index">03</span></div>
        <p class="section-description">{t.hotspotHint}</p>
        {#if selected}
          <div class="parameters">{#each hotspotParams as p}{@render parameterControl(p)}{/each}</div>
          <p class="hotspot-note">{t.angleHint}</p>
        {:else}<p class="no-selection">{t.selectRegion}</p>{/if}
      </section>
      <section class="effects-panel panel">
        <div class="section-heading">
          <h2><Waves size={20} />{t.effect}</h2>
          <span class="section-index">04</span>
        </div>
        <p class="section-description">{t.effectHint}</p>
        <div class="effect-grid">
          {#each styles as style}<button
              class:active={selected?.effect === style.id}
              class="effect-card"
              disabled={!selected || exporting}
              onclick={() => setEffect(style.id)}
              aria-pressed={selected?.effect === style.id}
              ><span class={`effect-illustration ${style.id}`}
                ><style.icon
                  size={27}
                  strokeWidth={1.6}
                />{#if selected?.effect === style.id}<span class="effect-check"
                    ><Check size={10} strokeWidth={3} /></span
                  >{/if}</span
              ><strong>{t[style.id]}</strong><small
                >{t[`${style.id}Desc`]}</small
              ></button
            >{/each}
        </div>
        <div class="parameter-heading">
          <h3>{t.parameters}</h3>
          <button
            class="text-button"
            disabled={!selected || exporting}
            onclick={() => {
              remember();
              Object.assign(selected, defaults);
            }}><RotateCcw size={11} />{t.reset}</button
          >
        </div>
        {#if selected}<div class="parameters">
            {#each params as p}{@render parameterControl(p)}{/each}
          </div>{:else}<div class="no-selection">
            <SlidersHorizontal size={25} />
            <p>{t.selectRegion}</p>
          </div>{/if}
        <div class="instant-note"><span></span>{t.changes}</div>
      </section>
    </aside>
  </div>
  <footer>
    <span class="footer-brand">pudding</span><span>{t.footer}</span><span
      class="footer-local"><ShieldCheck size={12} />{t.local}</span
    >
  </footer>
</main>

{#if notice}<div
    class:error={noticeError}
    class="toast"
    role={noticeError ? 'alert' : 'status'}
  >
    {#if noticeError}<TriangleAlert size={20} />{:else}<Check size={20} />{/if}<span
      >{notice}</span
    ><button
      class="icon-button small"
      onclick={() => (notice = '')}
      aria-label={t.close}><X size={15} /></button
    >
  </div>{/if}

<Dialog.Root bind:open={helpOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
      class="help-dialog"
      ><div class="help-top">
        <span class="help-mark"><Waves size={26} /></span><Dialog.Close
          class="icon-button"
          aria-label={t.close}><X size={20} /></Dialog.Close
        >
      </div>
      <Dialog.Title class="help-title">{t.helpTitle}</Dialog.Title
      ><Dialog.Description class="help-description"
        >{t.exportNote}</Dialog.Description
      >
      <ol>
        {#each [t.help1, t.help2, t.help3, t.help4] as item}<li>
            {item}
          </li>{/each}
      </ol>
      <div class="help-shortcuts">
        <h3>{t.keyboard}</h3>
        <p><kbd>Space</kbd>{t.space}</p>
        <p><kbd>Ctrl / ⌘ + Z</kbd>{t.undoKey}</p>
        <p><kbd>Delete</kbd>{t.deleteKey}</p>
      </div>
      <Dialog.Close class="primary-button help-close"
        >{lang === 'zh' ? '開始創作' : 'Let’s make it wobble'}<ChevronRight
          size={16}
        /></Dialog.Close
      ></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
