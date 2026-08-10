/**
 * db.js
 * Thin IndexedDB wrapper for storing photo blobs on-device.
 * Photos never leave the browser — nothing here talks to a network.
 */
const DB = (() => {
  const DB_NAME = 'transformation-tracker';
  const DB_VERSION = 1;
  const STORE = 'photos';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function savePhoto(id, blob) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPhoto(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deletePhoto(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Simple in-memory cache of object URLs so we don't leak / recreate them.
  const urlCache = new Map();
  async function getPhotoUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const blob = await getPhoto(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }
  function clearUrlCache() {
    urlCache.forEach(url => URL.revokeObjectURL(url));
    urlCache.clear();
  }

  return { savePhoto, getPhoto, deletePhoto, clearAll, getPhotoUrl, clearUrlCache };
})();


/**
 * store.js
 * Owns all app metadata in localStorage: entries list, settings.
 * Photo binary data itself lives in IndexedDB (see db.js) — this module
 * only tracks references (photoId) plus day number, date, and notes.
 */
const Store = (() => {
  const ENTRIES_KEY = 'tt_entries';
  const SETTINGS_KEY = 'tt_settings';

  const DEFAULT_SETTINGS = {
    goalDays: 100,
    reminderEnabled: false,
    reminderTime: '08:00',
    lastReminderFiredDate: null,
    userName: '',
    onboarded: false
  };

  function getEntries() {
    try {
      const raw = localStorage.getItem(ENTRIES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to read entries', e);
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
  }

  function getTodayEntry() {
    const entries = getEntries();
    const last = entries[entries.length - 1];
    if (last && new Date(last.date).toDateString() === new Date().toDateString()) {
      return last;
    }
    return null;
  }

  /**
   * Adds a new day, OR — if a photo was already logged today — replaces
   * that entry in place instead of creating a second "day". This keeps
   * day-count/streak math tied to real calendar days rather than to how
   * many times someone tapped the shutter.
   * Returns { entry, replacedPhotoId } so the caller can clean up the
   * old photo blob from IndexedDB.
   */
  function upsertEntry({ photoId, note, stats }) {
    const entries = getEntries();
    const todayStr = new Date().toDateString();
    const last = entries[entries.length - 1];

    if (last && new Date(last.date).toDateString() === todayStr) {
      const replacedPhotoId = last.photoId;
      last.photoId = photoId;
      last.note = note || '';
      last.stats = stats || null;
      last.date = new Date().toISOString();
      saveEntries(entries);
      return { entry: last, replacedPhotoId, wasReplace: true };
    }

    const entry = {
      id: 'day_' + Date.now(),
      dayNumber: entries.length + 1,
      date: new Date().toISOString(),
      note: note || '',
      stats: stats || null,
      photoId
    };
    entries.push(entry);
    saveEntries(entries);
    return { entry, replacedPhotoId: null, wasReplace: false };
  }

  function deleteAllEntries() {
    saveEntries([]);
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(partial) {
    const current = getSettings();
    const next = { ...current, ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  /** Consecutive-day streak counting back from today (or most recent entry). */
  function computeStreak() {
    const entries = getEntries();
    if (entries.length === 0) return 0;

    const dateStrings = new Set(
      entries.map(e => new Date(e.date).toDateString())
    );

    let streak = 0;
    const cursor = new Date();
    // If nothing logged today yet, still allow the streak to count from yesterday
    if (!dateStrings.has(cursor.toDateString())) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (dateStrings.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function computeProgress() {
    const entries = getEntries();
    const settings = getSettings();
    const goal = settings.goalDays || 100;
    const days = Math.min(entries.length, goal);
    const pct = goal > 0 ? Math.round((days / goal) * 100) : 0;
    return { days, goal, pct };
  }

  function nextMilestone() {
    const entries = getEntries();
    const milestones = [30, 50, 75, 100, 150, 200, 300, 365];
    const settings = getSettings();
    const goal = settings.goalDays || 100;
    const relevant = milestones.filter(m => m <= goal);
    const current = entries.length;
    const next = relevant.find(m => m > current) || goal;
    return { target: next, daysLeft: Math.max(next - current, 0) };
  }

  return {
    getEntries,
    upsertEntry,
    getTodayEntry,
    deleteAllEntries,
    getSettings,
    saveSettings,
    computeStreak,
    computeProgress,
    nextMilestone
  };
})();


/**
 * camera.js
 * Wraps getUserMedia so the app can take a real photo from the device camera,
 * plus a canvas-based capture routine that produces a JPEG Blob.
 */
const Camera = (() => {
  let stream = null;
  let facingMode = 'user'; // front camera by default, like a mirror for progress photos

  async function start(videoEl) {
    stop(videoEl); // ensure any previous stream is closed first
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false
      });
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
      return true;
    } catch (err) {
      console.warn('Camera unavailable:', err.message);
      return false;
    }
  }

  function stop(videoEl) {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  async function flip(videoEl) {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    return start(videoEl);
  }

  /** Capture the current video frame into a JPEG Blob. */
  function capture(videoEl, canvasEl) {
    const w = videoEl.videoWidth || 720;
    const h = videoEl.videoHeight || 1280;
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d');
    // Mirror the frame back to normal (video preview is mirrored via CSS for a natural feel)
    if (facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    return new Promise(resolve => {
      canvasEl.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
    });
  }

  function isActive() {
    return !!stream;
  }

  function getFacingMode() {
    return facingMode;
  }

  return { start, stop, flip, capture, isActive, getFacingMode };
})();


/**
 * notifications.js
 * Handles the daily reminder using the browser Notification API.
 * Honest limitation: like any plain web page (no service worker / push server),
 * this can only fire while the tab is open — it checks the clock every 30s.
 * That's disclosed to the user in the Reminder Time screen copy.
 */
const Reminders = (() => {
  let intervalId = null;

  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return Notification.requestPermission();
  }

  function fire(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('100 · Transformation Tracker', { body: message });
    } else {
      // Fallback so the reminder still means something even without permission
      UI.toast(message);
    }
  }

  function tick() {
    const settings = Store.getSettings();
    if (!settings.reminderEnabled) return;

    const now = new Date();
    const [h, m] = (settings.reminderTime || '08:00').split(':').map(Number);
    const todayStr = now.toDateString();

    const isReminderMinute = now.getHours() === h && now.getMinutes() === m;
    const alreadyFiredToday = settings.lastReminderFiredDate === todayStr;

    if (isReminderMinute && !alreadyFiredToday) {
      fire("Time for today's progress photo 📸");
      Store.saveSettings({ lastReminderFiredDate: todayStr });
    }
  }

  function start() {
    stop();
    tick();
    intervalId = setInterval(tick, 30000);
  }

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  return { requestPermission, start, stop };
})();


/**
 * main.js
 * Wires DOM events to the modules above and owns the few bits of
 * transient (non-persisted) state, like the currently-pending capture.
 */
(function () {
  let pendingPhoto = null; // { blob, url } — the photo waiting to be saved as a day entry

  const videoEl = document.getElementById('cameraVideo');
  const canvasEl = document.getElementById('captureCanvas');
  const camErrorEl = document.getElementById('camError');
  const uploadInput = document.getElementById('uploadInput');
  const viewfinderEl = document.querySelector('.viewfinder');

  function syncMirrorClass() {
    viewfinderEl.classList.toggle('mirror', Camera.getFacingMode() === 'user');
  }

  // ---------- Clock ----------
  function updateClock() {
    const now = new Date();
    let h = now.getHours();
    const m = now.getMinutes();
    h = h % 12; if (h === 0) h = 12;
    document.querySelectorAll('.clock').forEach(el => {
      el.textContent = `${h}:${String(m).padStart(2, '0')}`;
    });
  }
  updateClock();
  setInterval(updateClock, 30000);

  // ---------- Camera screen lifecycle ----------

  async function enterCameraScreen() {
    UI.renderCamera();
    camErrorEl.hidden = true;
    videoEl.style.display = 'block';
    await Camera.start(videoEl);
    syncMirrorClass();
    // Use stream presence as ground truth — play() can reject on iOS even
    // with a valid stream, so the boolean return value of start() is unreliable.
    if (!Camera.isActive()) {
      camErrorEl.hidden = false;
      videoEl.style.display = 'none';
    }
  }

  document.getElementById('flipCamBtn').addEventListener('click', async () => {
    const ok = await Camera.flip(videoEl);
    syncMirrorClass();
    if (!ok) {
      camErrorEl.hidden = false;
      videoEl.style.display = 'none';
      UI.toast('Could not switch camera');
    }
  });

  document.getElementById('shutterBtn').addEventListener('click', async () => {
    if (!Camera.isActive()) {
      UI.toast('Camera not active — try uploading a photo instead');
      return;
    }
    const blob = await Camera.capture(videoEl, canvasEl);
    await goToSaveWithBlob(blob);
  });

  // ---------- Upload-photo flow (works from camera screen, or as camera fallback) ----------
  function openFilePicker() {
    uploadInput.value = ''; // allow re-selecting the same file twice in a row
    uploadInput.click();
  }
  document.getElementById('galleryUploadBtn').addEventListener('click', openFilePicker);

  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      UI.toast('Please choose an image file');
      return;
    }
    await goToSaveWithBlob(file);
  });

  async function goToSaveWithBlob(blob) {
    Camera.stop(videoEl);
    // A blob can pass the "image/*" MIME check and still be something the
    // browser's <img> can't decode — HEIC from an iPhone's photo picker is
    // the common case. Confirm it actually decodes now, while we can still
    // tell the person and let them pick a different file, instead of
    // silently saving a photo that will render as a broken "?" icon
    // everywhere it's shown later.
    const decodable = await canDecodeImage(blob);
    if (!decodable) {
      UI.toast("That photo format isn't supported — try a JPEG or PNG");
      return;
    }
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
    const url = URL.createObjectURL(blob);
    pendingPhoto = { blob, url };
    UI.renderSave(url);
    Router.goto('save');
  }

  function canDecodeImage(blob) {
    return new Promise(resolve => {
      const testUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(testUrl); resolve(true); };
      img.onerror = () => { URL.revokeObjectURL(testUrl); resolve(false); };
      img.src = testUrl;
    });
  }

  // ---------- Save Day screen ----------
  const noteEl = document.getElementById('dayNote');
  noteEl.addEventListener('input', () => {
    document.getElementById('noteCount').textContent = `${noteEl.value.length}/100`;
  });

  document.getElementById('statsToggleHead').addEventListener('click', () => {
    const fields = document.getElementById('statsFields');
    const icon = document.getElementById('statsToggleIcon');
    const open = fields.classList.toggle('open');
    icon.textContent = open ? '−' : '+';
  });

  ['unitLbs', 'unitKg'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      document.getElementById('unitLbs').classList.toggle('active', id === 'unitLbs');
      document.getElementById('unitKg').classList.toggle('active', id === 'unitKg');
    });
  });

  ['unitIn', 'unitCm'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      const isIn = id === 'unitIn';
      document.getElementById('unitIn').classList.toggle('active', isIn);
      document.getElementById('unitCm').classList.toggle('active', !isIn);
      const label = isIn ? 'in' : 'cm';
      document.getElementById('statChestUnit').textContent = label;
      document.getElementById('statHipsUnit').textContent = label;
    });
  });

  document.getElementById('saveDayBtn').addEventListener('click', async () => {
    if (!pendingPhoto) {
      UI.toast('No photo to save');
      return;
    }
    const btn = document.getElementById('saveDayBtn');
    btn.disabled = true;
    try {
      const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await DB.savePhoto(photoId, pendingPhoto.blob);
      const weightUnit = document.getElementById('unitLbs').classList.contains('active') ? 'lbs' : 'kg';
      const measureUnit = document.getElementById('unitIn').classList.contains('active') ? 'in' : 'cm';
      const stats = {
        weight: document.getElementById('statWeight').value.trim() || null,
        waist: document.getElementById('statWaist').value.trim() || null,
        chest: document.getElementById('statChest').value.trim() || null,
        hips: document.getElementById('statHips').value.trim() || null,
        weightUnit,
        measureUnit,
      };
      const { entry, replacedPhotoId, wasReplace } = Store.upsertEntry({ photoId, note: noteEl.value.trim(), stats });
      if (replacedPhotoId) {
        await DB.deletePhoto(replacedPhotoId); // avoid orphaned blobs from retakes
      }
      URL.revokeObjectURL(pendingPhoto.url);
      pendingPhoto = null;
      UI.toast(wasReplace ? `Day ${entry.dayNumber} updated!` : `Day ${entry.dayNumber} saved!`);
      await UI.renderHome();
      Router.goto('home');
    } catch (err) {
      console.error(err);
      UI.toast('Could not save — please try again');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Day detail modal ----------
  function closeDayModal() {
    const m = document.getElementById('dayModal');
    m.classList.add('closing');
    setTimeout(() => { m.classList.remove('open', 'closing'); }, 280);
  }
  document.getElementById('dayModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDayModal();
  });
  document.getElementById('dayModalClose').addEventListener('click', closeDayModal);

  // ---------- Settings ----------
  document.getElementById('reminderToggleRow').addEventListener('click', async (e) => {
    if (e.target.closest('[data-goto]')) return; // let other rows' nav handle themselves
    const settings = Store.getSettings();
    const next = !settings.reminderEnabled;
    if (next) {
      const perm = await Reminders.requestPermission();
      if (perm === 'denied') {
        UI.toast('Notifications are blocked in your browser settings');
      }
    }
    Store.saveSettings({ reminderEnabled: next });
    UI.renderSettings();
    Reminders.start();
  });

  document.getElementById('saveReminderBtn').addEventListener('click', () => {
    const val = document.getElementById('reminderTimeInput').value || '08:00';
    Store.saveSettings({ reminderTime: val, lastReminderFiredDate: null });
    UI.toast('Reminder time saved');
    UI.renderSettings();
    Router.goto('settings');
  });

  document.querySelectorAll('.goal-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.goal-opt').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
  document.getElementById('saveGoalBtn').addEventListener('click', async () => {
    const selected = document.querySelector('.goal-opt.selected');
    const goalDays = selected ? Number(selected.dataset.goal) : 100;
    Store.saveSettings({ goalDays });
    UI.toast('Challenge length updated');
    UI.renderSettings();
    await UI.renderHome();
    Router.goto('settings');
  });

  // exportVideoBtn now navigates via data-goto="video-export" (declarative)

  function closeProModal() {
    const m = document.getElementById('proModal');
    m.classList.add('closing');
    setTimeout(() => m.classList.remove('open', 'closing'), 280);
  }
  document.getElementById('proModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeProModal();
  });
  document.getElementById('proModalClose').addEventListener('click', closeProModal);

  // Plan toggle
  let selectedPlan = 'watermark';
  const planLabels = { watermark: 'Remove Watermark — $2.99 →', pro: 'Get Full Pro — $9.99 →' };
  document.querySelectorAll('.pro-plan').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.pro-plan').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      selectedPlan = el.dataset.plan;
      document.getElementById('proUpgradeBtn').textContent = planLabels[selectedPlan];
    });
  });

  document.getElementById('proUpgradeBtn').addEventListener('click', () => {
    UI.toast('Payment coming soon — stay tuned!');
  });

  document.getElementById('proRestoreBtn').addEventListener('click', () => {
    UI.toast('No purchase found to restore.');
  });

  document.getElementById('deleteAllBtn').addEventListener('click', async () => {
    const entries = Store.getEntries();
    if (entries.length === 0) {
      UI.toast('Nothing to delete');
      return;
    }
    const confirmed = confirm('Delete all photos and progress? This cannot be undone.');
    if (!confirmed) return;
    await DB.clearAll();
    DB.clearUrlCache();
    Store.deleteAllEntries();
    UI.toast('All photos deleted');
    await UI.renderHome();
    Router.goto('home');
  });

  document.getElementById('startOverBtn').addEventListener('click', async () => {
    const confirmed = confirm('Reset everything and restart onboarding? All photos and data will be deleted.');
    if (!confirmed) return;
    await DB.clearAll();
    DB.clearUrlCache();
    Store.deleteAllEntries();
    Store.saveSettings({ onboarded: false, userName: '' });
    Router.goto('home');
    showOnboarding();
  });

  // ---------- Router hooks ----------
  Router.onChange(async (name) => {
    if (name === 'home') await UI.renderHome();
    else if (name === 'camera') await enterCameraScreen();
    else if (name === 'timeline') await UI.renderTimeline();
    else if (name === 'comparison') await UI.renderComparison();
    else if (name === 'settings') UI.renderSettings();
    else if (name === 'reminder') UI.renderReminderScreen();
    else if (name === 'goal-edit') UI.renderGoalScreen();
    else if (name === 'video-export') renderVideoExportScreen();
    else if (name === 'about') {}  // static screen, nothing to render
  });

  // ---------- Video Export ----------
  function renderVideoExportScreen() {
    const entries = Store.getEntries();
    const empty   = document.getElementById('vxEmpty');
    const preview = document.getElementById('vxPreviewRow');
    const stats   = document.getElementById('vxStatsRow');
    const cta     = document.getElementById('vxCta');

    if (entries.length < 2) {
      empty.style.display   = 'block';
      preview.style.display = 'none';
      stats.style.display   = 'none';
      cta.style.display     = 'none';
      return;
    }

    empty.style.display   = 'none';
    preview.style.display = 'flex';
    stats.style.display   = 'flex';
    cta.style.display     = 'block';

    // Load first & last thumbnails
    const first = entries[0];
    const last  = entries[entries.length - 1];
    DB.getPhotoUrl(first.photoId).then(url => {
      const el = document.getElementById('vxThumbFirst');
      el.style.backgroundImage = url ? `url(${url})` : 'none';
    });
    DB.getPhotoUrl(last.photoId).then(url => {
      const el = document.getElementById('vxThumbLast');
      el.style.backgroundImage = url ? `url(${url})` : 'none';
    });

    // Stats
    document.getElementById('vxPhotoCount').textContent = entries.length;
    document.getElementById('vxDaySpan').textContent    = last.dayNumber;
    updateDurationDisplay(entries.length);

    // Speed picker
    document.querySelectorAll('.vx-speed-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.vx-speed-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const fps = parseFloat(opt.dataset.fps);
        VideoExport.setSpeed(fps);
        updateDurationDisplay(entries.length);
      });
    });
  }

  function updateDurationDisplay(count) {
    const secs = VideoExport.estimateDuration(count);
    document.getElementById('vxDuration').textContent =
      secs >= 60 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${secs}s`;
  }

  document.getElementById('vxExportBtn').addEventListener('click', async () => {
    const entries = Store.getEntries();
    const btn     = document.getElementById('vxExportBtn');
    const wrap    = document.getElementById('vxProgressWrap');
    const fill    = document.getElementById('vxProgressFill');
    const label   = document.getElementById('vxProgressLabel');
    const cta     = document.getElementById('vxCta');

    btn.disabled       = true;
    wrap.style.display = 'block';
    cta.style.display  = 'none';
    fill.style.width   = '0%';
    label.textContent  = 'Building your video…';

    await VideoExport.build(entries, DB.getPhotoUrl.bind(DB), {
      onProgress: pct => {
        fill.style.width  = `${Math.round(pct * 100)}%`;
        label.textContent = `Processing… ${Math.round(pct * 100)}%`;
      },
      onDone: (blobUrl, ext) => {
        fill.style.width  = '100%';
        btn.disabled      = false;
        cta.style.display = 'block';
        btn.textContent   = 'Export Again';

        const filename = `transformation-${new Date().toISOString().slice(0,10)}.${ext}`;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
          label.textContent = 'Video ready! Tap below to save it.';
          const saveBtn = document.createElement('a');
          saveBtn.href = blobUrl;
          saveBtn.target = '_blank';
          saveBtn.rel = 'noopener';
          saveBtn.textContent = '⬇ Hold & Save Video';
          saveBtn.style.cssText = 'display:block;margin-top:10px;color:var(--accent);font-weight:700;font-size:14px;text-align:center;';
          wrap.appendChild(saveBtn);
        } else {
          const a = document.createElement('a');
          a.href     = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          label.textContent = '✓ Video saved!';
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        }

      },
      onError: msg => {
        wrap.style.display = 'none';
        cta.style.display  = 'block';
        btn.disabled       = false;
        UI.toast(msg);
      },
    });
  });

  // ---------- Onboarding ----------
  function showOnboarding() {
    const overlay = document.getElementById('ob-overlay');
    overlay.style.display = 'flex';
    // Reset to slide 1
    document.querySelectorAll('.ob-slide').forEach(s => s.classList.add('ob-hidden'));
    const s1 = document.getElementById('ob-s1');
    s1.classList.remove('ob-hidden');
    // Re-trigger splash animation by cloning
    const fresh = s1.cloneNode(true);
    s1.replaceWith(fresh);
    wireOnboarding();
  }

  function hideOnboarding() {
    const overlay = document.getElementById('ob-overlay');
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity .4s ease';
    setTimeout(() => { overlay.style.display = 'none'; overlay.style.opacity = ''; overlay.style.transition = ''; }, 400);
  }

  function goObSlide(id) {
    document.querySelectorAll('.ob-slide').forEach(s => s.classList.add('ob-hidden'));
    document.getElementById(id).classList.remove('ob-hidden');
  }

  function wireOnboarding() {
    document.getElementById('obStartBtn').addEventListener('click', () => goObSlide('ob-s1b'), { once: true });
    document.getElementById('obProofNextBtn').addEventListener('click', () => goObSlide('ob-s2'), { once: true });

    const nameInput = document.getElementById('obNameInput');
    const nameBtn = document.getElementById('obNameNextBtn');
    nameInput.value = '';
    nameBtn.disabled = true;
    nameInput.addEventListener('input', () => { nameBtn.disabled = !nameInput.value.trim(); });
    nameBtn.addEventListener('click', () => {
      if (!nameInput.value.trim()) return;
      goObSlide('ob-s3');
    }, { once: true });

    document.querySelectorAll('#ob-goal-opts .goal-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#ob-goal-opts .goal-opt').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('obGoalNextBtn').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const selected = document.querySelector('#ob-goal-opts .goal-opt.selected');
      const goalDays = selected ? Number(selected.dataset.goal) : 100;
      goObSlide('ob-s4');
      document.getElementById('obPlanName').textContent = `, ${name}`;
      await runPlanLoader(name, goalDays);
    }, { once: true });
  }

  async function runPlanLoader(name, goalDays) {
    const TIPS = [
      'Small steps every day lead to big changes.',
      'Your only competition is who you were yesterday.',
      'Show up. That\'s it. Just show up.',
      `Locking in your ${goalDays}-day challenge.`,
      'Every photo is proof you didn\'t quit.',
      'Your transformation starts now.',
    ];
    const DURATION = 10000;
    const arc = document.getElementById('obRingArc');
    const pctEl = document.getElementById('obPct');
    const tipEl = document.getElementById('obTip');
    const circumference = 226.2;

    tipEl.textContent = TIPS[0];
    let tipIdx = 0;
    const tipInterval = setInterval(() => {
      tipIdx = Math.min(tipIdx + 1, TIPS.length - 1);
      tipEl.classList.add('ob-tip-out');
      setTimeout(() => { tipEl.textContent = TIPS[tipIdx]; tipEl.classList.remove('ob-tip-out'); }, 200);
    }, DURATION / TIPS.length);

    const start = Date.now();
    const tick = () => {
      const pct = Math.min((Date.now() - start) / DURATION, 1);
      arc.style.strokeDashoffset = circumference * (1 - pct);
      pctEl.textContent = Math.round(pct * 100) + '%';
      if (pct < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    await new Promise(r => setTimeout(r, DURATION));
    clearInterval(tipInterval);

    Store.saveSettings({ userName: name, goalDays, onboarded: true });
    await UI.renderHome();
    hideOnboarding();
    if (Store.getSettings().reminderEnabled) Reminders.start();
    setTimeout(() => Tutorial.start(), 500);
  }

  // ---------- Orientation lock ----------
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {});
  }

  // ---------- Boot ----------
  (async function init() {
    Router.wireDeclarativeNav();
    const settings = Store.getSettings();
    if (!settings.onboarded) {
      showOnboarding();
    } else {
      await UI.renderHome();
      if (settings.reminderEnabled) Reminders.start();
      setTimeout(() => Tutorial.start(), 800);
    }
  })();
})();