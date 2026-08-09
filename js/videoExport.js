/**
 * videoExport.js
 * Builds a time-lapse transformation video from the user's saved photos
 * using Canvas + MediaRecorder. Entirely client-side — nothing is uploaded.
 *
 * Supported on Chrome, Firefox, Edge, and iOS Safari 14.5+.
 * Output: WebM (VP9) on desktop/Android, falls back to whatever the browser supports.
 */
const VideoExport = (() => {

  // How many seconds each photo frame is shown
  let secPerPhoto = 0.5;

  // Detect best supported video MIME type
  function getSupportedMime() {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  function fileExtFromMime(mime) {
    return mime.includes('mp4') ? 'mp4' : 'webm';
  }

  // Draw an image URL onto a canvas, cover-fitting it (portrait → portrait)
  function drawCover(ctx, img, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = img.naturalWidth  * scale;
    const sh = img.naturalHeight * scale;
    const sx = (w - sw) / 2;
    const sy = (h - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);
  }

  // Overlay the day number badge on the bottom-left of the frame
  function drawDayBadge(ctx, dayNumber, w, h) {
    const label = `Day ${dayNumber}`;
    const fontSize = Math.round(h * 0.038);
    ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
    const textW = ctx.measureText(label).width;
    const pad = fontSize * 0.6;
    const bx = pad;
    const by = h - pad * 2.2;
    const bw = textW + pad * 2;
    const bh = fontSize + pad;
    const br = bh / 2;

    // Pill background
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, br);
    ctx.fill();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, bx + pad, by + bh - pad * 0.7);
  }

  // Load an <img> element from a URL, resolve when loaded
  function loadImg(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  }

  // Render a single frame for `durationMs` milliseconds at 30fps
  async function renderFrame(ctx, img, dayNumber, w, h, durationMs, onProgress) {
    const fps       = 30;
    const totalFrames = Math.round((durationMs / 1000) * fps);
    const frameDelay  = 1000 / fps;

    for (let f = 0; f < totalFrames; f++) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      drawCover(ctx, img, w, h);
      drawDayBadge(ctx, dayNumber, w, h);
      if (onProgress) onProgress();
      await new Promise(r => setTimeout(r, frameDelay));
    }
  }

  /**
   * Main export function.
   * @param {Array}    entries       — Store entries (must have .dayNumber, .photoId)
   * @param {Function} getPhotoUrl   — async (photoId) => objectURL | null
   * @param {Object}   callbacks     — { onProgress(pct), onDone(blobUrl, ext), onError(msg) }
   */
  async function build(entries, getPhotoUrl, { onProgress, onDone, onError }) {
    if (!entries || entries.length < 2) {
      onError('Need at least 2 photos to create a video.');
      return;
    }

    const mime = getSupportedMime();
    if (!mime) {
      onError('Your browser doesn\'t support video recording. Try Chrome or Firefox.');
      return;
    }

    // Canvas dimensions — portrait 9:16
    const W = 720, H = 1280;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Set up recorder
    const stream   = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 3_000_000,
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const ext = fileExtFromMime(mime);

    recorder.onstop = () => {
      const blob    = new Blob(chunks, { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      onDone(blobUrl, ext);
    };

    recorder.start(100); // collect data every 100ms

    // Count total frames for progress
    const frameDurationMs = secPerPhoto * 1000;
    let renderedFrames = 0;
    const totalFrames  = entries.length * Math.round((frameDurationMs / 1000) * 30);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const url   = await getPhotoUrl(entry.photoId);
      if (!url) continue;

      let img;
      try { img = await loadImg(url); }
      catch { continue; }

      await renderFrame(ctx, img, entry.dayNumber, W, H, frameDurationMs, () => {
        renderedFrames++;
        if (onProgress) onProgress(Math.min(renderedFrames / totalFrames, 0.99));
      });
    }

    recorder.stop();
  }

  function setSpeed(s) { secPerPhoto = s; }
  function estimateDuration(count) { return Math.round(count * secPerPhoto); }

  return { build, setSpeed, estimateDuration };
})();
