/**
 * tutorial.js
 * One-time interactive walkthrough shown to new users after onboarding.
 * Each step highlights a real UI element with a pulsing beacon and a
 * tooltip card. Completion is stored in localStorage so it never repeats.
 */
const Tutorial = (() => {
  const KEY = 'tut_v2_done';
  let currentStep = 0;
  let overlayEl = null;

  const STEPS = [
    {
      title: 'Welcome! Here\'s a quick tour',
      body: 'We\'ll show you the 4 things you need to start your transformation.',
      targetSelector: null,
      cardPos: 'center',
    },
    {
      title: 'Take your daily photo',
      body: 'Tap the + button every day to snap your progress photo. Same pose, same lighting — every day counts.',
      targetSelector: '.fab[data-goto="camera"]',
      cardPos: 'above',
    },
    {
      title: 'Your challenge progress',
      body: 'This card tracks what day you\'re on and your current streak. Keep that streak alive!',
      targetSelector: '.home-hero-card',
      cardPos: 'below',
    },
    {
      title: 'See your transformation',
      body: 'Tap Progress to view every photo you\'ve taken and compare your before & after.',
      targetSelector: '.navitem[data-nav="timeline"]',
      cardPos: 'above',
    },
    {
      title: 'Settings & reminders',
      body: 'Tap here to change your challenge length and set a daily reminder so you never miss a day.',
      targetSelector: '.icon-btn[data-goto="settings"]',
      cardPos: 'below',
    },
  ];

  function isDone() {
    return localStorage.getItem(KEY) === '1';
  }

  function build() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'tut-overlay';
    overlayEl.innerHTML = `
      <div class="tut-beacon" id="tutBeacon"></div>
      <div class="tut-card" id="tutCard">
        <div class="tut-dots" id="tutDots"></div>
        <h3 class="tut-title" id="tutTitle"></h3>
        <p class="tut-body" id="tutBody"></p>
        <div class="tut-actions">
          <button class="tut-skip" id="tutSkip">Skip tour</button>
          <button class="tut-next" id="tutNext">Next →</button>
        </div>
      </div>
    `;

    document.querySelector('.screen-frame').appendChild(overlayEl);
    document.getElementById('tutSkip').addEventListener('click', finish);
    document.getElementById('tutNext').addEventListener('click', advance);
  }

  function renderStep(index) {
    currentStep = index;
    const step = STEPS[index];
    const isLast = index === STEPS.length - 1;

    document.getElementById('tutTitle').textContent = step.title;
    document.getElementById('tutBody').textContent = step.body;
    document.getElementById('tutNext').textContent = isLast ? 'Got it ✓' : 'Next →';

    // Progress dots
    document.getElementById('tutDots').innerHTML = STEPS.map((_, i) =>
      `<div class="tut-dot${i === index ? ' active' : ''}"></div>`
    ).join('');

    positionElements(step);
  }

  function positionElements(step) {
    const beacon = document.getElementById('tutBeacon');
    const card   = document.getElementById('tutCard');
    const frame  = document.querySelector('.screen-frame');
    const frameRect = frame.getBoundingClientRect();

    // Reset card positioning
    card.style.cssText = 'left:20px; right:20px;';

    if (!step.targetSelector) {
      // Centered welcome card, no beacon
      beacon.style.display = 'none';
      card.style.top = '50%';
      card.style.transform = 'translateY(-50%)';
      return;
    }

    const target = frame.querySelector(step.targetSelector);
    if (!target) {
      beacon.style.display = 'none';
      card.style.top = '50%';
      card.style.transform = 'translateY(-50%)';
      return;
    }

    const tRect = target.getBoundingClientRect();
    const cx = tRect.left - frameRect.left + tRect.width  / 2;
    const cy = tRect.top  - frameRect.top  + tRect.height / 2;

    // Beacon centred on the element
    beacon.style.cssText = `display:block; left:${cx}px; top:${cy}px;`;

    const GAP = 16;
    if (step.cardPos === 'above') {
      const bottom = frameRect.height - (cy - tRect.height / 2) + GAP;
      card.style.bottom = `${bottom}px`;
    } else {
      const top = cy + tRect.height / 2 + GAP;
      card.style.top = `${top}px`;
    }
  }

  function advance() {
    if (currentStep >= STEPS.length - 1) { finish(); return; }
    renderStep(currentStep + 1);
  }

  function finish() {
    localStorage.setItem(KEY, '1');
    if (overlayEl) {
      overlayEl.classList.add('tut-out');
      setTimeout(() => { overlayEl && overlayEl.remove(); overlayEl = null; }, 350);
    }
  }

  function start() {
    if (isDone()) return;
    build();
    renderStep(0);
  }

  return { start };
})();
