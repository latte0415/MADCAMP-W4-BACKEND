const userName = document.getElementById('user-name');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const btnSubmit = document.getElementById('btn-submit');
const btnRefresh = document.getElementById('btn-refresh');
const statusEl = document.getElementById('status');
const libraryEl = document.getElementById('library');

const inputTitle = document.getElementById('title');
const inputMode = document.getElementById('mode');
const inputAudio = document.getElementById('audio');
const inputVideo = document.getElementById('video');

function setStatus(msg) {
  statusEl.textContent = msg;
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
    btnLogin.classList.add('hidden');
    btnLogout.classList.remove('hidden');
  } else {
    userName.textContent = '게스트';
    btnLogin.classList.remove('hidden');
    btnLogout.classList.add('hidden');
  }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  await refreshUser();
}

async function uploadMedia(file) {
  const presignRes = await fetch('/api/media/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      type: file.type.startsWith('audio/') ? 'audio' : 'video',
    }),
    credentials: 'include',
  });
  const presign = await presignRes.json();
  if (!presignRes.ok) throw new Error(presign.detail || 'presign failed');

  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error('S3 upload failed');

  const commitRes = await fetch('/api/media/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      s3_key: presign.s3_key,
      type: file.type.startsWith('audio/') ? 'audio' : 'video',
      content_type: file.type,
      duration_sec: null,
    }),
    credentials: 'include',
  });
  const data = await commitRes.json();
  if (!commitRes.ok) throw new Error(data.detail || 'commit failed');
  return data;
}

async function createAnalysis(videoId, audioId) {
  const payload = {
    video_id: videoId,
    audio_id: audioId || null,
    mode: inputMode.value,
    params_json: null,
    title: inputTitle.value || null,
    notes: null,
  };
  const res = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'analysis create failed');
  return data;
}

async function pollStatus(requestId) {
  const res = await fetch(`/api/analysis/${requestId}/status`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'status failed');
  return data;
}

async function loadLibrary() {
  const res = await fetch('/api/library', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'library failed');
  renderLibrary(data);
}

function renderLibrary(items) {
  libraryEl.innerHTML = '';
  if (!items || items.length === 0) {
    libraryEl.innerHTML = '<div class="card">라이브러리가 비어있습니다.</div>';
    return;
  }
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'card';
    const created = new Date(item.created_at).toLocaleDateString();
    const updated = item.finished_at ? new Date(item.finished_at).toLocaleDateString() : '-';
    const duration = item.video_duration_sec ? formatDuration(item.video_duration_sec) : '--:--';
    el.innerHTML = `
      <div class="card__meta">
        <div class="card__title">${item.title || '작업명'}</div>
        <div class="card__sub">생성일: ${created}</div>
        <div class="card__sub">마지막 편집: ${updated}</div>
      </div>
      <div>
        <div class="card__title">${duration}</div>
        <div class="card__sub">${item.status}</div>
      </div>
    `;
    libraryEl.appendChild(el);
  }
}

function formatDuration(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

btnLogin.addEventListener('click', () => {
  location.href = '/auth/google/login';
});

btnLogout.addEventListener('click', logout);

btnSubmit.addEventListener('click', async () => {
  try {
    setStatus('업로드 중...');
    const video = inputVideo.files[0];
    if (!video) throw new Error('영상 파일이 필요합니다.');

    const audio = inputAudio.files[0];
    const videoRes = await uploadMedia(video);
    const audioRes = audio ? await uploadMedia(audio) : null;

    setStatus('분석 요청 생성 중...');
    const req = await createAnalysis(videoRes.id, audioRes ? audioRes.id : null);
    setStatus('요청 완료. 진행률 확인 중...');

    const timer = setInterval(async () => {
      try {
        const st = await pollStatus(req.id);
        const p = st.progress != null ? Math.round(st.progress * 100) : null;
        const msg = st.message || st.status;
        const detail = p != null ? `${msg} (${p}%)` : msg;
        setStatus(detail);
        if (st.log) {
          console.log('worker log:', st.log);
        }
        if (st.status === 'done' || st.status === 'failed') {
          clearInterval(timer);
          await loadLibrary();
        }
      } catch (err) {
        clearInterval(timer);
        setStatus(`에러: ${err.message}`);
      }
    }, 2000);
    await loadLibrary();
  } catch (err) {
    setStatus(`에러: ${err.message}`);
  }
});

btnRefresh.addEventListener('click', loadLibrary);

refreshUser().then(loadLibrary).catch(() => {});
