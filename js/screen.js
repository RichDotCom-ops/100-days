/**
 * router.js
 * Minimal hash-free screen router for this single-page app.
 * Screens are <section id="screen-NAME"> elements toggled via a class.
 */
const Router = (() => {
  const screenIds = {
    home: 'screen-home',
    camera: 'screen-camera',
    save: 'screen-save',
    timeline: 'screen-timeline',
    comparison: 'screen-comparison',
    settings: 'screen-settings',
    reminder: 'screen-reminder',
    'goal-edit': 'screen-goal-edit',
    'video-export': 'screen-video-export',
    about: 'screen-about'
  };

  let current = 'home';
  const listeners = [];

  function onChange(fn) {
    listeners.push(fn);
  }

  function goto(name) {
    // Special virtual routes used by data-goto attributes in the markup
    if (name === 'home-settings-close') name = 'home';

    if (!screenIds[name]) return;

    // Camera cleanup when navigating away from it
    if (current === 'camera' && name !== 'camera') {
      Camera.stop();
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(screenIds[name]);
    el.classList.add('active');
    el.scrollTop = 0;

    document.querySelectorAll('.navitem').forEach(n => n.classList.remove('active'));
    document.querySelectorAll(`.navitem[data-nav="${name}"]`).forEach(n => n.classList.add('active'));

    current = name;
    const fabSettings = document.querySelector('.fab-settings');
    if (fabSettings) {
      const gearVisibleOn = ['home', 'timeline'];
      fabSettings.style.display = gearVisibleOn.includes(name) ? 'flex' : 'none';
    }
    listeners.forEach(fn => fn(name));
  }

  function getCurrent() {
    return current;
  }

  function wireDeclarativeNav() {
    document.body.addEventListener('click', (e) => {
      const gotoTarget = e.target.closest('[data-goto]');
      if (gotoTarget) {
        goto(gotoTarget.getAttribute('data-goto'));
        return;
      }
      const toastTarget = e.target.closest('[data-toast]');
      if (toastTarget) {
        UI.toast(toastTarget.getAttribute('data-toast'));
      }
    });
  }

  return { goto, getCurrent, onChange, wireDeclarativeNav };
})();


/**
 * ui.js
 * Pure(ish) rendering functions: read from Store/DB, write into the DOM.
 * No business logic here beyond formatting — that lives in store.js.
 */
const UI = (() => {
  let toastTimer = null;
  let calClickHandler = null;

  const QUOTES = [
    { text: 'The body achieves what the mind believes.' },
    { text: 'Progress, not perfection.' },
    { text: 'Small steps every day lead to big changes.' },
    { text: 'Your only competition is who you were yesterday.' },
    { text: 'Discipline is choosing between what you want now and what you want most.' },
    { text: 'Show up. That\'s it. Just show up.' },
    { text: 'Every photo is proof you didn\'t quit.' },
    { text: 'Transformation begins with consistency.' },
    { text: 'The pain you feel today is the strength you\'ll feel tomorrow.' },
    { text: 'Results happen over time, not overnight.' },
    { text: 'You don\'t have to be extreme, just consistent.' },
    { text: 'Believe in your process.' },
    { text: 'One more rep. One more day. One more photo.' },
    { text: 'The hardest part is starting. You already did that.' },
  ];
  // If a photo's blob is missing from IndexedDB (storage cleared, private
  // browsing, etc.) while the entry metadata still exists in localStorage,
  // DB.getPhotoUrl() resolves to null. Interpolating that straight into
  // src="${url}" produces src="null", which the browser renders as a
  // broken-image "?" icon. Fall back to a transparent pixel instead so it
  // just reads as an empty photo, never a broken one.
  const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  // A blob URL can be perfectly valid and still fail to *decode* as an
  // image — a corrupted blob, or a format the browser's <img> can't render
  // (HEIC straight off an iPhone photo picker is the common real-world
  // case). That produces the exact same broken "?" icon, just later and
  // with no null check to catch it. This tiny placeholder graphic is what
  // any <img> falls back to when that happens.
  const PHOTO_FALLBACK_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1c1c1c"/><path d="M8 28l6-7 4.5 3.5L25 15l7 8" stroke="#6b6b6b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="14" r="2.3" fill="#6b6b6b"/></svg>'
  );

  function todayEmptyStateHtml(label) {
    return `<div class="empty-state">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/></svg>
          <p>${label}</p>
        </div>`;
  }

  // 'error' doesn't bubble, so this has to be delegated in the capture
  // phase. Any <img> tagged with data-photo-fallback gets a graceful
  // fallback instead of the browser's native broken-image icon:
  //  - "today"  → swap the whole today-photo card back to its empty state
  //  - "hide"   → just remove the <img>, leaving the thumbnail's background
  //  - "pixel"  → swap src to a neutral placeholder graphic (used where the
  //               element is referenced elsewhere by id/selector and must
  //               keep existing, e.g. the comparison overlay)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.photoFallback) return;
    img.onerror = null;
    const kind = img.dataset.photoFallback;
    if (kind === 'today') {
      const parent = document.getElementById('todayPhotoWrap');
      if (parent) parent.innerHTML = todayEmptyStateHtml('Photo unavailable');
    } else if (kind === 'hide') {
      img.remove();
    } else if (kind === 'pixel') {
      img.src = PHOTO_FALLBACK_SRC;
    }
  }, true);
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning,';
    if (h < 18) return 'Good afternoon,';
    return 'Good evening,';
  }

  async function renderHome() {
    const entries = Store.getEntries();
    const settings = Store.getSettings();
    const progress = Store.computeProgress();
    const streak = Store.computeStreak();

    document.getElementById('greetingText').textContent = greeting();
    document.getElementById('greetingName').textContent = settings.userName || 'You';
    // Match the Progress screen exactly: this is completed days, not the
    // upcoming day — the ring/percentage right next to it is completed-based,
    // so the number must agree with it or the two together read as a bug.
    document.getElementById('homeDayNum').textContent = entries.length;
    document.getElementById('homeGoal').textContent = settings.goalDays;
    document.getElementById('homePct').textContent = progress.pct + '%';
    document.getElementById('homeStreak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;

    const q = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
    document.getElementById('homeQuoteText').textContent = q.text;

    const circumference = 188.5;
    const offset = circumference - (progress.pct / 100) * circumference;
    document.getElementById('ringProgress').style.strokeDashoffset = offset;


    document.getElementById('homeCalendar').innerHTML = buildCalendar(entries);
    const calEl = document.getElementById('homeCalendar');
    if (calClickHandler) calEl.removeEventListener('click', calClickHandler);
    calClickHandler = (e) => {
      const cell = e.target.closest('[data-cal-date]');
      if (cell) openDayDetail(cell.dataset.calDate, entries);
    };
    calEl.addEventListener('click', calClickHandler);

    // Show/hide first-photo CTA
    const firstPhotoCta = document.getElementById('firstPhotoCta');
    if (firstPhotoCta) firstPhotoCta.style.display = entries.length === 0 ? 'flex' : 'none';

    // Recent days
    const recentRow = document.getElementById('recentRow');
    if (entries.length === 0) {
      recentRow.innerHTML = '';
    } else {
      const recent = entries.slice(-4);
      const urls = await Promise.all(recent.map(e => DB.getPhotoUrl(e.photoId)));
      recentRow.innerHTML = recent.map((_, i) => {
        const isCurrent = i === recent.length - 1;
        return `<div class="recent-thumb ${isCurrent ? 'current' : ''}" data-goto="timeline">${urls[i] ? `<img src="${urls[i]}" data-photo-fallback="hide">` : ''}</div>`;
      }).join('');
    }
  }

  function renderCamera() {
    const entries = Store.getEntries();
    const todayEntry = Store.getTodayEntry();
    const dayLabel = todayEntry ? todayEntry.dayNumber : entries.length + 1;
    document.getElementById('camDayTitle').textContent = `Day ${dayLabel}`;
    document.getElementById('camDate').textContent = new Date().toLocaleDateString(undefined,{ month:'short', day:'numeric', year:'numeric' });
  }

  function renderSave(photoUrl) {
    const entries = Store.getEntries();
    const todayEntry = Store.getTodayEntry();
    const dayLabel = todayEntry ? todayEntry.dayNumber : entries.length + 1;
    document.getElementById('saveDayTitle').textContent = `Day ${dayLabel}`;
    document.getElementById('saveDate').textContent = new Date().toLocaleDateString(undefined,{ month:'short', day:'numeric', year:'numeric' });
    document.getElementById('saveDayBtnLabel').textContent = todayEntry ? `Update Day ${dayLabel}` : `Save as Day ${dayLabel}`;
    document.getElementById('savePhotoWrap').innerHTML = `<img src="${photoUrl}">`;
    const prefillNote = todayEntry ? (todayEntry.note || '') : '';
    document.getElementById('dayNote').value = prefillNote;
    document.getElementById('noteCount').textContent = `${prefillNote.length}/100`;

    const s = (todayEntry && todayEntry.stats) ? todayEntry.stats : {};
    document.getElementById('statWeight').value = s.weight || '';
    document.getElementById('statWaist').value = s.waist || '';
    document.getElementById('statChest').value = s.chest || '';
    document.getElementById('statHips').value = s.hips || '';
    const wu = s.weightUnit || 'lbs';
    document.getElementById('unitLbs').classList.toggle('active', wu === 'lbs');
    document.getElementById('unitKg').classList.toggle('active', wu === 'kg');
    const mu = s.measureUnit || 'in';
    document.getElementById('unitIn').classList.toggle('active', mu === 'in');
    document.getElementById('unitCm').classList.toggle('active', mu === 'cm');
    document.getElementById('statChestUnit').textContent = mu;
    document.getElementById('statHipsUnit').textContent = mu;
    const hasStats = !!(s.weight || s.waist || s.chest || s.hips);
    document.getElementById('statsFields').classList.toggle('open', hasStats);
    document.getElementById('statsToggleIcon').textContent = hasStats ? '−' : '+';
  }

  async function renderTimeline() {
    const entries = Store.getEntries();
    const progress = Store.computeProgress();
    document.getElementById('tlOverviewNum').textContent = `${entries.length} / ${progress.goal} days`;
    document.getElementById('tlOverviewPct').textContent = progress.pct + '%';
    document.getElementById('tlOverviewFill').style.width = progress.pct + '%';

    const list = document.getElementById('timelineList');
    if (entries.length === 0) {
      list.innerHTML = `<div class="empty-hint">No entries yet</div>`;
    } else {
      const ordered = [...entries].reverse(); // most recent first
      const urls = await Promise.all(ordered.map(e => DB.getPhotoUrl(e.photoId)));
      list.innerHTML = ordered.map((e, i) => {
        const isLatest = i === 0;
        return `
        <div class="timeline-item">
          <div class="line"></div>
          <div class="tl-dot ${isLatest ? 'current' : 'done'}"></div>
          <div class="tl-row ${isLatest ? 'current' : ''}" data-goto="comparison">
            <div class="tl-text">
              <div class="lbl">Day ${e.dayNumber}</div>
              <div class="date" title="${escapeHtml(e.note || '')}">${formatDate(e.date)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
            </div>
            <div class="tl-thumb">${urls[i] ? `<img src="${urls[i]}" data-photo-fallback="hide">` : ''}</div>
          </div>
        </div>`;
      }).join('');
    }

    const milestone = Store.nextMilestone();
    const card = document.getElementById('milestoneCard');
    if (milestone.daysLeft > 0) {
      card.hidden = false;
      document.getElementById('milestoneSub').textContent = `Day ${milestone.target}`;
      document.getElementById('milestoneDays').textContent = `${milestone.daysLeft}d`;
    } else {
      card.hidden = true;
    }
  }

  async function renderComparison() {
    const entries = Store.getEntries();
    const body = document.getElementById('comparisonBody');
    if (entries.length < 2) {
      body.innerHTML = `<div id="comparisonEmpty" class="comp-empty-state"><img src="Beofreandafter.png" alt="Example transformation" class="comp-example-img"><p class="comp-empty-label">Save at least 2 days to compare your progress</p></div>`;
      return;
    }
    const first = entries[0];
    const latest = entries[entries.length - 1];
    const [u1, u2] = await Promise.all([DB.getPhotoUrl(first.photoId), DB.getPhotoUrl(latest.photoId)]);
    const progress = Store.computeProgress();
    const streak = Store.computeStreak();

    body.innerHTML = `
      <div class="cmp-overlay-wrap">
        <img src="${u1 || BLANK_PIXEL}" data-photo-fallback="pixel">
        <img class="layer2" id="cmpLayer2" src="${u2 || BLANK_PIXEL}" style="opacity:0.5;" data-photo-fallback="pixel">
      </div>
      <div class="cmp-labels"><span><b>Day ${first.dayNumber}</b> · ${formatDate(first.date)}</span><span><b>Day ${latest.dayNumber}</b> · ${formatDate(latest.date)}</span></div>
      <div class="cmp-slider"><input type="range" class="zoom-slider" id="cmpSlider" min="0" max="100" value="50"></div>

      <div class="cmp-picker-row">
        <div class="cmp-picker">
          <label style="color:var(--muted); font-size:11px;">Compare from</label>
          <select id="cmpFromSelect"></select>
        </div>
        <div class="cmp-picker">
          <label style="color:var(--muted); font-size:11px;">Compare to</label>
          <select id="cmpToSelect"></select>
        </div>
      </div>

      <div class="section-head" style="margin-top:20px;">
        <h3>Progress</h3>
        <span style="font-size:12px;color:var(--accent); font-weight:700;">${progress.pct}%</span>
      </div>
      <div class="progressbar"><div class="fill" style="width:${progress.pct}%;"></div></div>

      <div class="stats-grid">
        <div class="stat-box"><div class="top">⏱ Days Tracked</div><div class="val">${entries.length}</div></div>
        <div class="stat-box"><div class="top">🔥 Current Streak</div><div class="val">${streak} day${streak===1?'':'s'}</div></div>
      </div>
    `;

    const slider = document.getElementById('cmpSlider');
    const layer2 = document.getElementById('cmpLayer2');
    slider.addEventListener('input', () => {
      layer2.style.opacity = slider.value / 100;
    });

    const fromSelect = document.getElementById('cmpFromSelect');
    const toSelect = document.getElementById('cmpToSelect');
    const optionsHtml = entries.map(e => `<option value="${e.id}">Day ${e.dayNumber}</option>`).join('');
    fromSelect.innerHTML = optionsHtml;
    toSelect.innerHTML = optionsHtml;
    fromSelect.value = first.id;
    toSelect.value = latest.id;

    async function updatePair() {
      const fromEntry = entries.find(e => e.id === fromSelect.value);
      const toEntry = entries.find(e => e.id === toSelect.value);
      if (!fromEntry || !toEntry) return;
      const [nu1, nu2] = await Promise.all([DB.getPhotoUrl(fromEntry.photoId), DB.getPhotoUrl(toEntry.photoId)]);
      body.querySelector('.cmp-overlay-wrap img').src = nu1 || BLANK_PIXEL;
      layer2.src = nu2 || BLANK_PIXEL;
      body.querySelector('.cmp-labels').innerHTML =
        `<span><b>Day ${fromEntry.dayNumber}</b> · ${formatDate(fromEntry.date)}</span><span><b>Day ${toEntry.dayNumber}</b> · ${formatDate(toEntry.date)}</span>`;
    }
    fromSelect.addEventListener('change', updatePair);
    toSelect.addEventListener('change', updatePair);
  }

  function renderSettings() {
    const settings = Store.getSettings();
    document.getElementById('goalValue').textContent = `${settings.goalDays} days`;
    document.getElementById('reminderSwitch').classList.toggle('on', settings.reminderEnabled);
    document.getElementById('reminderTimeValue').textContent = to12h(settings.reminderTime);
  }

  function renderReminderScreen() {
    const settings = Store.getSettings();
    document.getElementById('reminderTimeInput').value = settings.reminderTime;
  }

  function renderGoalScreen() {
    const settings = Store.getSettings();
    document.querySelectorAll('.goal-opt').forEach(el => {
      el.classList.toggle('selected', Number(el.dataset.goal) === settings.goalDays);
    });
  }

  function to12h(time24) {
    const [h, m] = time24.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function openDayDetail(dateStr, entries) {
    const entry = entries.find(e => new Date(e.date).toDateString() === dateStr);
    if (!entry) return;
    const modal = document.getElementById('dayModal');
    document.getElementById('dayModalTitle').textContent = `Day ${entry.dayNumber}`;
    document.getElementById('dayModalDate').textContent = formatDate(entry.date);
    const noteEl = document.getElementById('dayModalNote');
    noteEl.textContent = entry.note || '';
    noteEl.style.display = entry.note ? 'block' : 'none';
    const photoWrap = document.getElementById('dayModalPhoto');
    photoWrap.innerHTML = '';

    const statsEl = document.getElementById('dayModalStats');
    const s = entry.stats || {};
    const chips = [];
    if (s.weight) chips.push(`<div class="day-modal-stat"><div class="dms-label">Weight</div><div class="dms-val">${s.weight} ${s.weightUnit || 'lbs'}</div></div>`);
    if (s.waist)  chips.push(`<div class="day-modal-stat"><div class="dms-label">Waist</div><div class="dms-val">${s.waist} ${s.measureUnit || 'in'}</div></div>`);
    if (s.chest)  chips.push(`<div class="day-modal-stat"><div class="dms-label">Chest</div><div class="dms-val">${s.chest} ${s.measureUnit || 'in'}</div></div>`);
    if (s.hips)   chips.push(`<div class="day-modal-stat"><div class="dms-label">Hips</div><div class="dms-val">${s.hips} ${s.measureUnit || 'in'}</div></div>`);
    statsEl.innerHTML = chips.join('');
    statsEl.style.display = chips.length ? 'flex' : 'none';

    modal.classList.add('open');
    const url = await DB.getPhotoUrl(entry.photoId);
    photoWrap.innerHTML = url ? `<img src="${url}" alt="Day ${entry.dayNumber}" data-photo-fallback="hide">` : '';
  }

  function buildCalendar(entries) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayDate = now.getDate();
    const todayStr = now.toDateString();

    const entryDates = new Set(entries.map(e => new Date(e.date).toDateString()));
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const dowHtml = ['S','M','T','W','T','F','S']
      .map(d => `<div class="cal-dow">${d}</div>`).join('');

    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = new Date(year, month, d).toDateString();
      const isToday = dateStr === todayStr;
      const hasEntry = entryDates.has(dateStr);
      const isFuture = d > todayDate;

      let pip, numCls;
      if (hasEntry && isToday) {
        pip = 'cal-pip cal-pip-entry-today'; numCls = 'cal-dn cal-dn-today';
      } else if (hasEntry) {
        pip = 'cal-pip cal-pip-entry';       numCls = 'cal-dn cal-dn-entry';
      } else if (isToday) {
        pip = 'cal-pip cal-pip-today';       numCls = 'cal-dn cal-dn-today';
      } else if (isFuture) {
        pip = 'cal-pip cal-pip-future';                                    numCls = 'cal-dn cal-dn-dim';
      } else {
        const v = ['cal-pip-past-sm','cal-pip-past','cal-pip-past-lg'][(d * 3 + month * 7) % 3];
        pip = 'cal-pip ' + v;                                              numCls = 'cal-dn cal-dn-dim';
      }

      const calDateAttr = hasEntry ? ` data-cal-date="${dateStr}"` : '';
      cells += `<div class="cal-cell"${calDateAttr}><span class="${pip}"></span><span class="${numCls}">${d}</span></div>`;
    }

    return `<div class="cal-wrap">
      <div class="cal-head">${monthLabel}</div>
      <div class="cal-grid">${dowHtml}${cells}</div>
      <div class="cal-legend">
        <span class="cal-pip cal-pip-entry" style="width:6px;height:6px;"></span><span class="cal-leg-lbl">Photo day</span>
        <span class="cal-pip cal-pip-today" style="width:6px;height:6px;"></span><span class="cal-leg-lbl">Today</span>
      </div>
    </div>`;
  }

  return {
    toast, formatDate, renderHome, renderCamera, renderSave,
    renderTimeline, renderComparison, renderSettings,
    renderReminderScreen, renderGoalScreen, to12h
  };
})();