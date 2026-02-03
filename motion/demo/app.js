const videoInput = document.getElementById('video-input');
const motionJsonInput = document.getElementById('motion-json');
const musicJsonInput = document.getElementById('music-json');
const magicJsonInput = document.getElementById('magic-json');
const modeSelect = document.getElementById('mode-select');
const video = document.getElementById('video');
const timelineSvg = document.getElementById('timeline-svg');
const timelineCanvas = document.getElementById('timeline-canvas');
const addMarkerBtn = document.getElementById('add-marker');
const addTarget = document.getElementById('add-target');
const addTargetWrap = addTarget.closest('.select');
const autoAnalyze = document.getElementById('auto-analyze');
const analyzeNowBtn = document.getElementById('analyze-now');
const analysisStatus = document.getElementById('analysis-status');
const deleteMode = document.getElementById('delete-mode');
const zoomInput = document.getElementById('zoom');
const exportBtn = document.getElementById('export-json');
const suggestionText = document.getElementById('suggestion-text');
const applyOffsetBtn = document.getElementById('apply-offset');
const musicList = document.querySelector('#music-list .list');
const motionList = document.querySelector('#motion-list .list');
const magicList = document.querySelector('#magic-list .list');
const detailTrack = document.getElementById('detail-track');
const detailTime = document.getElementById('detail-time');
const deleteMarkerBtn = document.getElementById('delete-marker');
const nudgeButtons = document.querySelectorAll('[data-nudge]');

const state = {
  duration: 60,
  mode: 'dance',
  motion: [],
  music: [],
  magic: [],
  motionHolds: [],
  selected: null,
  dragging: null,
  pxPerSec: 90,
  suggestionOffset: null,
};

let markerId = 1;

function createMarker(track, time, meta = {}) {
  return { id: markerId++, track, time, meta };
}

function setMediaSrc(input, mediaEl) {
  const file = input.files && input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  mediaEl.src = url;
}

function setStatus(message, tone = 'muted') {
  analysisStatus.textContent = message;
  analysisStatus.style.color =
    tone === 'error' ? '#ff4d4d' : tone === 'success' ? '#27d7c4' : '';
}

function updateDuration() {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    state.duration = video.duration;
  }
  renderTimeline();
}

function parseMotionJson(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const markers = [];
  const holds = [];

  const fps = typeof data.fps === 'number' ? data.fps : null;

  for (const ev of events) {
    if (ev.type === 'hit') {
      const t = typeof ev.t === 'number' ? ev.t : (fps && typeof ev.frame === 'number' ? ev.frame / fps : null);
      if (t !== null) markers.push(createMarker('motion', t, { source: 'hit' }));
    }
    if (ev.type === 'hold') {
      const tStart = typeof ev.t_start === 'number' ? ev.t_start : (fps && typeof ev.start_frame === 'number' ? ev.start_frame / fps : null);
      const tEnd = typeof ev.t_end === 'number' ? ev.t_end : (fps && typeof ev.end_frame === 'number' ? ev.end_frame / fps : null);
      if (tStart !== null && tEnd !== null) {
        holds.push({ start: tStart, end: tEnd });
      }
    }
  }

  state.motion = markers.sort((a, b) => a.time - b.time);
  state.motionHolds = holds;
  updateSuggestions();
  renderAll();
}

async function analyzeVideo(file) {
  if (!file) return;
  setStatus('Uploading video for analysis...');
  try {
    const form = new FormData();
    form.append('video', file);
    const res = await fetch('/analyze', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Analysis failed');
    }
    setStatus('Analyzing motion...');
    const payload = await res.json();
    parseMotionJson(payload.motion);
    setStatus('Motion analysis complete.', 'success');
  } catch (err) {
    setStatus(`Analysis error: ${err.message}`, 'error');
  }
}

async function analyzeMagic(file) {
  if (!file) return;
  setStatus('Uploading video for magic analysis...');
  try {
    const form = new FormData();
    form.append('video', file);
    const res = await fetch('/analyze-magic', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || 'Magic analysis failed');
    }
    const startPayload = await res.json();
    const jobId = startPayload.job_id;
    if (!jobId) throw new Error('Missing job id');

    let pollTimer = null;
    const poll = async () => {
      const statusRes = await fetch(`/status/${jobId}`);
      if (!statusRes.ok) {
        const err = await statusRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Status failed');
      }
      const status = await statusRes.json();
      const percent = Math.round((status.progress || 0) * 100);
      setStatus(`${status.message} (${percent}%)`);

      if (status.state === 'done') {
        if (pollTimer) clearInterval(pollTimer);
        const resultRes = await fetch(`/result/${jobId}`);
        if (!resultRes.ok) {
          const err = await resultRes.json().catch(() => ({}));
          throw new Error(err.detail || 'Result failed');
        }
        const result = await resultRes.json();
        parseMagicJson(result.magic);
        setStatus('Magic analysis complete.', 'success');
      } else if (status.state === 'error') {
        if (pollTimer) clearInterval(pollTimer);
        throw new Error(status.error || 'Magic analysis failed');
      }
    };

    await poll();
    pollTimer = setInterval(() => {
      poll().catch((err) => {
        if (pollTimer) clearInterval(pollTimer);
        setStatus(`Magic analysis error: ${err.message}`, 'error');
      });
    }, 2000);
  } catch (err) {
    setStatus(`Magic analysis error: ${err.message}`, 'error');
  }
}

function parseMusicJson(data) {
  let times = [];
  if (Array.isArray(data)) {
    times = data;
  } else if (Array.isArray(data.beats)) {
    times = data.beats;
  } else if (Array.isArray(data.events)) {
    times = data.events.map((ev) => ev.t ?? ev.time ?? ev.timestamp).filter((t) => typeof t === 'number');
  }

  state.music = times.map((t) => createMarker('music', t, { source: 'music' })).sort((a, b) => a.time - b.time);
  updateSuggestions();
  renderAll();
}

function parseMagicJson(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const fps = typeof data.fps === 'number' ? data.fps : null;
  const markers = [];
  for (const ev of events) {
    if (ev.type !== 'appear' && ev.type !== 'vanish') continue;
    const t = typeof ev.t === 'number' ? ev.t : (fps && typeof ev.frame === 'number' ? ev.frame / fps : null);
    if (t !== null) {
      markers.push(createMarker('magic', t, { type: ev.type }));
    }
  }
  state.magic = markers.sort((a, b) => a.time - b.time);
  renderAll();
}

function renderAll() {
  renderTimeline();
  renderLists();
  renderDetail();
}

function updateModeUI() {
  if (state.mode === 'magic') {
    addTargetWrap.style.display = 'none';
  } else {
    addTargetWrap.style.display = '';
  }
}

function renderTimeline() {
  const zoom = parseFloat(zoomInput.value || '1');
  state.pxPerSec = 90 * zoom;
  const width = Math.max(600, state.duration * state.pxPerSec);
  const height = 140;

  timelineSvg.setAttribute('width', `${width}`);
  timelineSvg.setAttribute('height', `${height}`);
  timelineSvg.innerHTML = '';

  const laneTop = 22;
  const laneHeight = 40;
  const laneGap = 24;
  const musicY = laneTop;
  const motionY = laneTop + laneHeight + laneGap;

  const totalSeconds = Math.ceil(state.duration);
  for (let s = 0; s <= totalSeconds; s++) {
    const x = s * state.pxPerSec;
    const line = svgEl('line', {
      x1: x,
      y1: 0,
      x2: x,
      y2: height,
      stroke: s % 5 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
      'stroke-width': s % 5 === 0 ? 1.5 : 1,
    });
    timelineSvg.appendChild(line);

    if (s % 5 === 0) {
      const label = svgEl('text', {
        x: x + 4,
        y: 14,
        fill: 'rgba(255,255,255,0.5)',
        'font-size': '10',
        'font-family': 'Space Mono, monospace',
      });
      label.textContent = `${s}s`;
      timelineSvg.appendChild(label);
    }
  }

  timelineSvg.appendChild(svgEl('rect', {
    x: 0,
    y: musicY,
    width: width,
    height: laneHeight,
    fill: 'rgba(255,255,255,0.02)',
    rx: 10,
  }));

  if (state.mode === 'dance') {
    timelineSvg.appendChild(svgEl('rect', {
      x: 0,
      y: motionY,
      width: width,
      height: laneHeight,
      fill: 'rgba(255,255,255,0.02)',
      rx: 10,
    }));
  }

  if (state.mode === 'dance') {
    state.motionHolds.forEach((hold) => {
      const x = hold.start * state.pxPerSec;
      const w = Math.max(4, (hold.end - hold.start) * state.pxPerSec);
      timelineSvg.appendChild(svgEl('rect', {
        x,
        y: motionY + 6,
        width: w,
        height: laneHeight - 12,
        fill: 'rgba(255,122,90,0.18)',
        rx: 8,
      }));
    });
  }

  if (state.mode === 'dance') {
    state.music.forEach((marker) => {
      const x = marker.time * state.pxPerSec;
      const g = svgEl('g', {
        class: 'marker music',
        'data-id': marker.id,
        'data-track': marker.track,
        transform: `translate(${x}, ${musicY + laneHeight / 2})`,
      });
      const diamond = svgEl('polygon', {
        points: '0,-8 8,0 0,8 -8,0',
        fill: '#27d7c4',
        stroke: 'rgba(0,0,0,0.4)',
        'stroke-width': 1,
      });
      g.appendChild(diamond);
      attachMarkerEvents(g, marker);
      timelineSvg.appendChild(g);
    });
  }

  if (state.mode === 'dance') {
    state.motion.forEach((marker) => {
      const x = marker.time * state.pxPerSec;
      const g = svgEl('g', {
        class: 'marker motion',
        'data-id': marker.id,
        'data-track': marker.track,
        transform: `translate(${x}, ${motionY + laneHeight / 2})`,
      });
      const circle = svgEl('circle', {
        r: 7,
        fill: '#ff7a5a',
        stroke: 'rgba(0,0,0,0.4)',
        'stroke-width': 1,
      });
      g.appendChild(circle);
      attachMarkerEvents(g, marker);
      timelineSvg.appendChild(g);
    });
  } else {
    state.magic.forEach((marker) => {
      const x = marker.time * state.pxPerSec;
      const g = svgEl('g', {
        class: 'marker magic',
        'data-id': marker.id,
        'data-track': marker.track,
        transform: `translate(${x}, ${musicY + laneHeight / 2})`,
      });
      const color = marker.meta.type === 'appear' ? '#27d7c4' : '#ff7a5a';
      const diamond = svgEl('polygon', {
        points: '0,-8 8,0 0,8 -8,0',
        fill: color,
        stroke: 'rgba(0,0,0,0.4)',
        'stroke-width': 1,
      });
      g.appendChild(diamond);
      attachMarkerEvents(g, marker);
      timelineSvg.appendChild(g);
    });
  }

  const playheadX = currentTime() * state.pxPerSec;
  timelineSvg.appendChild(svgEl('line', {
    x1: playheadX,
    y1: 0,
    x2: playheadX,
    y2: height,
    stroke: '#ffffff',
    'stroke-width': 1,
    'stroke-dasharray': '4 4',
    opacity: 0.6,
  }));
}

function attachMarkerEvents(node, marker) {
  node.style.cursor = deleteMode.checked ? 'not-allowed' : 'grab';
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleteMode.checked) {
      removeMarker(marker);
      return;
    }
    selectMarker(marker);
    state.dragging = { marker, startX: e.clientX };
    node.setPointerCapture(e.pointerId);
  });

  node.addEventListener('pointermove', (e) => {
    if (!state.dragging || state.dragging.marker.id !== marker.id) return;
    const time = positionToTime(e.clientX);
    marker.time = clamp(time, 0, state.duration);
    renderAll();
  });

  node.addEventListener('pointerup', () => {
    state.dragging = null;
  });
}

function renderLists() {
  if (state.mode === 'dance') {
    document.getElementById('music-list').style.display = '';
    document.getElementById('motion-list').style.display = '';
    document.getElementById('magic-list').style.display = 'none';
    renderList(musicList, state.music, 'music');
    renderList(motionList, state.motion, 'motion');
  } else {
    document.getElementById('music-list').style.display = 'none';
    document.getElementById('motion-list').style.display = 'none';
    document.getElementById('magic-list').style.display = '';
    renderList(magicList, state.magic, 'magic');
  }
}

function renderList(container, markers, track) {
  container.innerHTML = '';
  markers.forEach((marker) => {
    const item = document.createElement('div');
    item.className = 'marker-item' + (state.selected && state.selected.id === marker.id ? ' active' : '');
    item.textContent = `${track} • ${marker.time.toFixed(2)}s`;
    item.addEventListener('click', () => selectMarker(marker));
    container.appendChild(item);
  });
}

function renderDetail() {
  if (!state.selected) {
    detailTrack.textContent = '-';
    detailTime.textContent = '-';
    deleteMarkerBtn.disabled = true;
    nudgeButtons.forEach((btn) => (btn.disabled = true));
    return;
  }
  detailTrack.textContent = state.selected.track;
  detailTime.textContent = `${state.selected.time.toFixed(3)}s`;
  deleteMarkerBtn.disabled = false;
  nudgeButtons.forEach((btn) => (btn.disabled = false));
}

function selectMarker(marker) {
  state.selected = marker;
  renderAll();
}

function removeMarker(marker) {
  state[marker.track] = state[marker.track].filter((m) => m.id !== marker.id);
  if (state.selected && state.selected.id === marker.id) state.selected = null;
  updateSuggestions();
  renderAll();
}

function addMarker(track, time) {
  const marker = createMarker(track, time);
  state[track].push(marker);
  state[track].sort((a, b) => a.time - b.time);
  selectMarker(marker);
  updateSuggestions();
}

function updateSuggestions() {
  if (!state.music.length || !state.motion.length) {
    suggestionText.textContent = 'Upload keypoints to see alignment insights.';
    applyOffsetBtn.disabled = true;
    state.suggestionOffset = null;
    return;
  }

  const deltas = state.motion.map((m) => nearestDelta(m.time, state.music));
  const median = medianValue(deltas);
  state.suggestionOffset = median;
  const abs = Math.abs(median).toFixed(3);
  const direction = median > 0 ? 'later' : 'earlier';
  suggestionText.textContent = `Motion hits are ${abs}s ${direction} than music on median. Suggest shifting motion by ${(-median).toFixed(3)}s.`;
  applyOffsetBtn.disabled = false;
}

function applyOffset() {
  if (state.suggestionOffset === null) return;
  const shift = -state.suggestionOffset;
  state.motion.forEach((m) => {
    m.time = clamp(m.time + shift, 0, state.duration);
  });
  updateSuggestions();
  renderAll();
}

function exportMarkers() {
  const payload = {
    music: state.music.map((m) => m.time),
    motion: state.motion.map((m) => m.time),
    holds: state.motionHolds,
    duration: state.duration,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'marker_export.json';
  link.click();
  URL.revokeObjectURL(url);
}

function currentTime() {
  return video.currentTime || 0;
}

function positionToTime(clientX) {
  const rect = timelineSvg.getBoundingClientRect();
  const scrollLeft = timelineCanvas.scrollLeft;
  const x = clientX - rect.left + scrollLeft;
  return x / state.pxPerSec;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function nearestDelta(time, markers) {
  let best = null;
  for (const m of markers) {
    const delta = m.time - time;
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best ?? 0;
}

function medianValue(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function svgEl(name, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  return el;
}

videoInput.addEventListener('change', () => {
  setMediaSrc(videoInput, video);
  const file = videoInput.files && videoInput.files[0];
  if (autoAnalyze.checked) {
    if (state.mode === 'magic') {
      analyzeMagic(file);
    } else {
      analyzeVideo(file);
    }
  }
});

video.addEventListener('loadedmetadata', updateDuration);

video.addEventListener('timeupdate', () => {
  renderTimeline();
});

motionJsonInput.addEventListener('change', async () => {
  const file = motionJsonInput.files && motionJsonInput.files[0];
  if (!file) return;
  const text = await file.text();
  parseMotionJson(JSON.parse(text));
});

magicJsonInput.addEventListener('change', async () => {
  const file = magicJsonInput.files && magicJsonInput.files[0];
  if (!file) return;
  const text = await file.text();
  parseMagicJson(JSON.parse(text));
});

musicJsonInput.addEventListener('change', async () => {
  const file = musicJsonInput.files && musicJsonInput.files[0];
  if (!file) return;
  const text = await file.text();
  parseMusicJson(JSON.parse(text));
});

addMarkerBtn.addEventListener('click', () => {
  const time = currentTime();
  const target = state.mode === 'magic' ? 'magic' : addTarget.value;
  addMarker(target, time);
});

analyzeNowBtn.addEventListener('click', () => {
  const file = videoInput.files && videoInput.files[0];
  if (!file) {
    setStatus('Please select a video first.', 'error');
    return;
  }
  if (state.mode === 'magic') {
    analyzeMagic(file);
  } else {
    analyzeVideo(file);
  }
});

exportBtn.addEventListener('click', exportMarkers);
applyOffsetBtn.addEventListener('click', applyOffset);

nudgeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!state.selected) return;
    const delta = parseFloat(btn.dataset.nudge);
    state.selected.time = clamp(state.selected.time + delta, 0, state.duration);
    updateSuggestions();
    renderAll();
  });
});

deleteMarkerBtn.addEventListener('click', () => {
  if (state.selected) removeMarker(state.selected);
});

zoomInput.addEventListener('input', renderTimeline);

window.addEventListener('resize', renderTimeline);

timelineSvg.addEventListener('click', (e) => {
  if (deleteMode.checked) return;
  const time = clamp(positionToTime(e.clientX), 0, state.duration);
  video.currentTime = time;
  if (e.target === timelineSvg) {
    const target = state.mode === 'magic' ? 'magic' : addTarget.value;
    addMarker(target, time);
  }
});

modeSelect.addEventListener('change', () => {
  state.mode = modeSelect.value;
  updateModeUI();
  renderAll();
});

updateModeUI();
renderAll();
