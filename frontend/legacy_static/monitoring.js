const userName = document.getElementById('user-name');
const btnRefresh = document.getElementById('btn-refresh');
const toggleAuto = document.getElementById('toggle-auto');
const filterInput = document.getElementById('filter-input');
const selectLimit = document.getElementById('select-limit');
const queuedEl = document.getElementById('list-queued');
const queuedMusicEl = document.getElementById('list-queued-music');
const runningEl = document.getElementById('list-running');
const failedEl = document.getElementById('list-failed');
const countQueued = document.getElementById('count-queued');
const countQueuedMusic = document.getElementById('count-queued-music');
const countRunning = document.getElementById('count-running');
const countActive = document.getElementById('count-active');
const countStale = document.getElementById('count-stale');
const countFailed = document.getElementById('count-failed');
const countDone = document.getElementById('count-done');
const labelQueued = document.getElementById('label-queued');
const labelQueuedMusic = document.getElementById('label-queued-music');
const labelRunning = document.getElementById('label-running');
const labelFailed = document.getElementById('label-failed');
const lastRefreshEl = document.getElementById('last-refresh');

const state = {
  autoRefresh: true,
  timer: null,
  limit: Number(selectLimit?.value || 25),
  filter: '',
  data: null,
};

function formatStatus(status) {
  const map = {
    queued: '대기중',
    queued_music: '음악 분석 대기중',
    running: '분석 중',
    done: '완료',
    failed: '실패',
  };
  return map[status] || status || '-';
}

function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function formatDuration(start, end) {
  if (!start) return '-';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((to - from) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function normalizeLog(log) {
  if (!log) return '';
  const text = String(log).trim();
  if (!text) return '';
  const lines = text.split('\n');
  return lines.slice(-3).join('\n');
}

function parseMotionStage(message) {
  if (!message) return null;
  const msg = String(message).toLowerCase();
  if (!msg.includes('motion') && !msg.includes('magic') && !msg.includes('video')) return null;
  if (msg.includes('downloading video')) return '비디오 다운로드';
  if (msg.includes('preprocessing')) return '전처리';
  if (msg.includes('analyzing')) return '모션 분석';
  if (msg.includes('uploading results')) return '결과 업로드';
  if (msg.includes('finalizing')) return '마무리';
  return null;
}

function parseAudioStage(message) {
  if (!message) return null;
  const msg = String(message).toLowerCase();
  if (!msg.includes('music') && !msg.includes('audio')) return null;
  if (msg.includes('queued')) return '대기';
  if (msg.includes('downloading audio')) return '오디오 다운로드';
  if (msg.includes('downloading video')) return '비디오 다운로드';
  if (msg.includes('extracting audio')) return '오디오 추출';
  if (msg.includes('preparing pipeline')) return '파이프라인 준비';
  if (msg.includes('separating stems')) return '스템 분리';
  if (msg.includes('splitting drum bands')) return '드럼 밴드 분리';
  if (msg.includes('detecting onsets')) return '온셋 검출';
  if (msg.includes('selecting keypoints')) return '키포인트 선택';
  if (msg.includes('merging textures')) return '텍스처 병합';
  if (msg.includes('analyzing bass')) return '베이스 분석';
  if (msg.includes('building json')) return '결과 JSON 생성';
  if (msg.includes('uploading results')) return '결과 업로드';
  return null;
}

function pipelineBadges(item) {
  const steps = [
    { key: 'video', label: 'Video', done: !!item.video_s3_key },
    { key: 'audio', label: 'Audio', done: !!item.audio_s3_key },
    { key: 'motion', label: 'Motion', done: !!item.motion_json_s3_key },
    { key: 'music', label: 'Music', done: !!item.music_json_s3_key },
    { key: 'magic', label: 'Magic', done: !!item.magic_json_s3_key },
    { key: 'edit', label: 'Edit', done: !!item.edited_motion_markers_s3_key },
    { key: 'match', label: 'Match', done: item.match_score != null },
  ];
  return steps
    .map((step) => {
      const className = step.done ? 'chip' : 'chip muted';
      return `<span class="${className}">${step.label}</span>`;
    })
    .join('');
}

function statusPill(status) {
  const normalized = status === 'queued_music' ? 'queued' : status;
  const klass = ['running', 'failed', 'queued'].includes(normalized) ? normalized : '';
  return `<span class="status-pill ${klass}">${formatStatus(status)}</span>`;
}

function renderList(el, items) {
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="card">항목이 없습니다.</div>';
    return;
  }

  const filter = state.filter.trim().toLowerCase();
  const filtered = filter
    ? items.filter((item) => {
        const title = (item.title || '').toLowerCase();
        return title.includes(filter) || String(item.id).includes(filter);
      })
    : items;

  if (filtered.length === 0) {
    el.innerHTML = '<div class="card">필터 결과가 없습니다.</div>';
    return;
  }

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = 'card monitor-card';

    const created = formatTime(item.created_at);
    const started = formatTime(item.started_at);
    const duration = formatDuration(item.started_at || item.created_at, item.finished_at);
    const baseProgress =
      item.job_progress != null
        ? item.job_progress
        : item.status === 'done' || item.status === 'failed'
          ? 1
          : 0;
    const progress = Math.min(100, Math.max(0, Math.round(baseProgress * 100)));
    const jobStatus = item.job_status || item.status;
    const jobMessage = item.job_message || '대기중';
    const jobUpdated = formatTime(item.job_updated_at || item.started_at || item.created_at);
    const log = normalizeLog(item.job_log || item.error_message);
    const pipeline = pipelineBadges(item);
    const motionStage = parseMotionStage(jobMessage);
    const audioStage = parseAudioStage(jobMessage);
    const stageLabel = audioStage ? `음악 단계: ${audioStage}` : motionStage ? `모션 단계: ${motionStage}` : null;

    const allowMotion = item.mode === 'dance';
    const allowMusic = !!item.audio_s3_key;
    const disabledMotion = allowMotion ? '' : 'disabled';
    const disabledMusic = allowMusic ? '' : 'disabled';
    const motionTitle = allowMotion ? '모션 재분석' : '모션 재분석(댄스 모드만)';
    const musicTitle = allowMusic ? '음악 재분석' : '음악 재분석(오디오 필요)';

    card.innerHTML = `
      <div class="monitor-top">
        <div class="monitor-meta">
          <div class="monitor-title">${item.title || `요청 #${item.id}`}</div>
          <div class="monitor-sub">
            <span>ID: ${item.id}</span>
            <span>모드: ${item.mode}</span>
            <span>생성: ${created}</span>
            <span>시작: ${started}</span>
            <span>경과: ${duration}</span>
          </div>
          <div class="chip-row">${pipeline}</div>
        </div>
        <div class="monitor-progress">
          ${statusPill(jobStatus)}
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%;"></div>
          </div>
          <div class="progress-label">진행률 ${progress}% · ${jobMessage}</div>
          ${stageLabel ? `<div class="progress-label muted">${stageLabel}</div>` : ''}
          <div class="progress-label">최근 업데이트: ${jobUpdated}</div>
          <div class="monitor-actions">
            <button class="btn warn" data-action="rerun-motion" data-id="${item.id}" ${disabledMotion} title="${motionTitle}">
              모션 재분석
            </button>
            <button class="btn warn" data-action="rerun-music" data-id="${item.id}" ${disabledMusic} title="${musicTitle}">
              음악 재분석
            </button>
          </div>
        </div>
      </div>
      ${log ? `<div class="log-box">${log}</div>` : ''}
    `;
    el.appendChild(card);
  }
}

async function fetchMe() {
  const res = await fetch('/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

async function refreshUser() {
  const me = await fetchMe();
  if (me) {
    userName.textContent = me.name || me.email || `user:${me.id}`;
  } else {
    userName.textContent = '게스트';
  }
}

async function refreshAll() {
  try {
    const [monitoringRes, healthRes] = await Promise.all([
      fetch(`/api/monitoring?limit=${state.limit}`),
      fetch('/api/monitoring/health'),
    ]);
    const data = await monitoringRes.json();
    const health = await healthRes.json();
    if (!monitoringRes.ok) throw new Error(data.detail || 'monitoring failed');
    if (!healthRes.ok) throw new Error(health.detail || 'monitoring health failed');

    state.data = data;
    countQueued.textContent = String(data.queued?.length || 0);
    countQueuedMusic.textContent = String(data.queued_music?.length || 0);
    countRunning.textContent = String(data.running?.length || 0);
    countActive.textContent = String(health.active_running || 0);
    countStale.textContent = String(health.stale_running || 0);
    countFailed.textContent = String(health.total_failed_24h || 0);
    countDone.textContent = String(health.total_done_24h || 0);
    labelQueued.textContent = `${data.queued?.length || 0}건`;
    labelQueuedMusic.textContent = `${data.queued_music?.length || 0}건`;
    labelRunning.textContent = `${data.running?.length || 0}건`;
    labelFailed.textContent = `${data.failed?.length || 0}건`;
    lastRefreshEl.textContent = new Date().toLocaleTimeString();

    renderList(queuedEl, data.queued);
    renderList(queuedMusicEl, data.queued_music);
    renderList(runningEl, data.running);
    renderList(failedEl, data.failed);
  } catch (err) {
    queuedEl.innerHTML = `<div class="card">에러: ${err.message}</div>`;
    queuedMusicEl.innerHTML = '';
    runningEl.innerHTML = '';
    failedEl.innerHTML = '';
  }
}

async function postAction(url, label) {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'action failed');
    }
    await refreshAll();
  } catch (err) {
    alert(`${label} 실패: ${err.message}`);
  }
}

function handleActionClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id || target.hasAttribute('disabled')) return;
  if (action === 'rerun-motion') {
    postAction(`/api/analysis/${id}/rerun-motion`, '모션 재분석');
  }
  if (action === 'rerun-music') {
    postAction(`/api/analysis/${id}/rerun-music`, '음악 재분석');
  }
}

function renderFromCache() {
  if (!state.data) return;
  renderList(queuedEl, state.data.queued);
  renderList(queuedMusicEl, state.data.queued_music);
  renderList(runningEl, state.data.running);
  renderList(failedEl, state.data.failed);
}

function setAutoRefresh(enabled) {
  state.autoRefresh = enabled;
  toggleAuto.textContent = `자동 갱신: ${enabled ? 'ON' : 'OFF'}`;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (enabled) {
    state.timer = setInterval(refreshAll, 3000);
  }
}

btnRefresh.addEventListener('click', refreshAll);
toggleAuto.addEventListener('click', () => setAutoRefresh(!state.autoRefresh));
queuedEl.addEventListener('click', handleActionClick);
queuedMusicEl.addEventListener('click', handleActionClick);
runningEl.addEventListener('click', handleActionClick);
failedEl.addEventListener('click', handleActionClick);
filterInput.addEventListener('input', (e) => {
  state.filter = e.target.value || '';
  renderFromCache();
});
selectLimit.addEventListener('change', (e) => {
  state.limit = Number(e.target.value || 25);
  refreshAll();
});

refreshUser()
  .then(refreshAll)
  .catch(() => {});

setAutoRefresh(true);
