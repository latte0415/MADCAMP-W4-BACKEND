const userName = document.getElementById('user-name');
const btnRefresh = document.getElementById('btn-refresh');
const queuedEl = document.getElementById('list-queued');
const queuedMusicEl = document.getElementById('list-queued-music');
const runningEl = document.getElementById('list-running');

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

function renderList(el, items) {
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="card">항목이 없습니다.</div>';
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';
    const created = new Date(item.created_at).toLocaleString();
    card.innerHTML = `
      <div class="card__meta">
        <div class="card__title">${item.title || `요청 #${item.id}`}</div>
        <div class="card__sub">모드: ${item.mode}</div>
        <div class="card__sub">생성: ${created}</div>
      </div>
      <div>
        <div class="card__sub">${formatStatus(item.status)}</div>
      </div>
    `;
    el.appendChild(card);
  }
}

async function refreshAll() {
  try {
    const res = await fetch('/api/monitoring?limit=25');
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'monitoring failed');
    renderList(queuedEl, data.queued);
    renderList(queuedMusicEl, data.queued_music);
    renderList(runningEl, data.running);
  } catch (err) {
    queuedEl.innerHTML = `<div class="card">에러: ${err.message}</div>`;
    queuedMusicEl.innerHTML = '';
    runningEl.innerHTML = '';
  }
}

btnRefresh.addEventListener('click', refreshAll);

refreshUser()
  .then(refreshAll)
  .catch(() => {});

setInterval(refreshAll, 3000);
