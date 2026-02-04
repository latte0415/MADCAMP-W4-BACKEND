const $ = (sel) => document.querySelector(sel);

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 240;
const ZOOM_FACTOR = 1.15;

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function formatStatus(status) {
  const map = {
    queued: "대기중",
    queued_music: "음악 분석 대기중",
    running: "분석 중",
    done: "완료",
    failed: "실패",
  };
  return map[status] || status || "-";
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseStreamsSectionsJson(data) {
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.streams) || !Array.isArray(data.sections) || !Array.isArray(data.keypoints)) return null;
  return {
    source: String(data.source ?? ""),
    sr: Number(data.sr ?? 22050),
    duration_sec: Number(data.duration_sec ?? 0),
    streams: data.streams,
    sections: data.sections,
    keypoints: data.keypoints,
    events: Array.isArray(data.events) ? data.events : undefined,
    keypoints_by_band: typeof data.keypoints_by_band === "object" ? data.keypoints_by_band : undefined,
    texture_blocks_by_band: typeof data.texture_blocks_by_band === "object" ? data.texture_blocks_by_band : undefined,
  };
}

function clearNode(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function addTick(el, t, className, lanePct) {
  const tick = document.createElement("div");
  tick.className = `tick ${className}`.trim();
  tick.style.left = `${t}px`;
  tick.style.top = `${lanePct}%`;
  el.appendChild(tick);
}

function addFullHeightMarker(el, t, className) {
  const m = document.createElement("div");
  m.className = `hit-marker ${className}`.trim();
  m.style.left = `${t}px`;
  el.appendChild(m);
}

function addHoldLine(el, start, end) {
  const line = document.createElement("div");
  line.className = "hold-line";
  line.style.left = `${start}px`;
  line.style.width = `${Math.max(2, end - start)}px`;
  el.appendChild(line);
}

function buildTimeline({ music, motion, magic, duration, pxPerSec }) {
  const timeline = $("#timeline");
  const eventsLayer = $("#timeline-events");
  const empty = $("#timeline-empty");

  clearNode(eventsLayer);

  if (!music && !motion && !magic) {
    empty.style.display = "block";
    timeline.style.width = "100%";
    timeline.dataset.duration = "0";
    return;
  }
  empty.style.display = "none";

  const total = duration || 1;
  const widthPx = Math.max(600, total * pxPerSec);
  timeline.style.width = `${widthPx}px`;

  if (music?.keypoints_by_band) {
    const kp = music.keypoints_by_band;
    const low = Array.isArray(kp.low) ? kp.low : [];
    const mid = Array.isArray(kp.mid) ? kp.mid : [];
    const high = Array.isArray(kp.high) ? kp.high : [];

    low.forEach((p) => addTick(eventsLayer, Number(p.t ?? p.time ?? 0) * pxPerSec, "tick-low", 14));
    mid.forEach((p) => addTick(eventsLayer, Number(p.t ?? p.time ?? 0) * pxPerSec, "tick-mid", 50));
    high.forEach((p) => addTick(eventsLayer, Number(p.t ?? p.time ?? 0) * pxPerSec, "tick-high", 84));
  }

  if (motion?.events) {
    motion.events.forEach((evt) => {
      if (evt.type === "hit") {
        addFullHeightMarker(eventsLayer, Number(evt.t ?? 0) * pxPerSec, "hit");
      } else if (evt.type === "hold") {
        addHoldLine(eventsLayer, Number(evt.t_start ?? 0) * pxPerSec, Number(evt.t_end ?? 0) * pxPerSec);
      }
    });
  }

  if (magic?.events) {
    magic.events.forEach((evt) => {
      if (evt.type === "appear" || evt.type === "vanish") {
        addFullHeightMarker(eventsLayer, Number(evt.t ?? 0) * pxPerSec, evt.type === "appear" ? "appear" : "vanish");
      }
    });
  }

  timeline.dataset.duration = String(total);
  timeline.dataset.pxPerSec = String(pxPerSec);
}

function syncCursor(video) {
  const cursor = $("#timeline-cursor");
  const timeline = $("#timeline");
  const timeDisplay = $("#timeline-time");

  function update() {
    const duration = Number(timeline.dataset.duration || video.duration || 0);
    const current = video.currentTime || 0;
    const pxPerSec = Number(timeline.dataset.pxPerSec || 0);
    if (duration > 0 && pxPerSec > 0) {
      cursor.style.left = `${current * pxPerSec}px`;
      timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    }
  }

  video.addEventListener("timeupdate", update);
  video.addEventListener("loadedmetadata", update);
  update();
}

function enableScrub(video) {
  const timeline = $("#timeline");
  const scroll = $("#timeline-scroll");
  scroll.addEventListener("click", (e) => {
    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pxPerSec = Number(timeline.dataset.pxPerSec || 0);
    if (pxPerSec > 0) {
      video.currentTime = Math.max(0, x / pxPerSec);
    }
  });
}

function setupVideoControls(video) {
  const toggle = $("#video-toggle");
  const playOverlay = $("#video-play");
  const timeDisplay = $("#video-time");
  const seek = $("#video-seek");

  function sync() {
    const dur = video.duration || 0;
    const cur = video.currentTime || 0;
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    seek.value = dur ? String((cur / dur) * 1000) : "0";
  }

  toggle.addEventListener("click", () => {
    if (video.paused) {
      video.play();
      toggle.textContent = "일시정지";
    } else {
      video.pause();
      toggle.textContent = "재생";
    }
  });
  playOverlay.addEventListener("click", () => {
    if (video.paused) video.play();
    else video.pause();
  });

  seek.addEventListener("input", () => {
    const dur = video.duration || 0;
    video.currentTime = (Number(seek.value) / 1000) * dur;
  });

  video.addEventListener("timeupdate", sync);
  video.addEventListener("loadedmetadata", sync);
  video.addEventListener("play", () => {
    toggle.textContent = "일시정지";
    playOverlay.classList.add("hidden");
  });
  video.addEventListener("pause", () => {
    toggle.textContent = "재생";
    playOverlay.classList.remove("hidden");
  });
}

async function loadProject() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const id = pathParts[pathParts.length - 1];

  const meRes = await fetch("/auth/me");
  if (meRes.ok) {
    const me = await meRes.json();
    $("#user-name").textContent = me.name || me.email || "User";
  }

  $("#logout-btn").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/";
  });

  const res = await fetch(`/api/project/${id}`);
  if (!res.ok) {
    $("#project-title").textContent = "프로젝트를 찾을 수 없습니다";
    return;
  }
  const data = await res.json();

  $("#project-title").textContent = data.title || `프로젝트 #${data.id}`;
  $("#project-status").textContent = formatStatus(data.status);
  $("#project-mode").textContent = data.mode || "-";
  $("#project-created").textContent = formatDate(data.created_at);
  $("#project-finished").textContent = formatDate(data.finished_at);

  const video = $("#video-player");
  if (data.video?.url) {
    video.src = data.video.url;
    $("#video-empty").style.display = "none";
    setupVideoControls(video);
  } else {
    video.style.display = "none";
  }

  const playBtn = $("#timeline-play");
  playBtn.addEventListener("click", () => {
    if (video.paused) {
      video.play();
      playBtn.textContent = "일시정지";
    } else {
      video.pause();
      playBtn.textContent = "재생";
    }
  });
  video.addEventListener("pause", () => (playBtn.textContent = "재생"));
  video.addEventListener("play", () => (playBtn.textContent = "일시정지"));

  let musicData = null;
  if (data.results?.music_json) {
    try {
      const musicRes = await fetch(data.results.music_json);
      if (musicRes.ok) {
        const musicJson = await musicRes.json();
        musicData = parseStreamsSectionsJson(musicJson);
      }
    } catch (e) {
      musicData = null;
    }
  }

  let motionJson = null;
  if (data.results?.motion_json) {
    try {
      const motionRes = await fetch(data.results.motion_json);
      if (motionRes.ok) motionJson = await motionRes.json();
    } catch (e) {
      motionJson = null;
    }
  }

  let magicJson = null;
  if (data.results?.magic_json) {
    try {
      const magicRes = await fetch(data.results.magic_json);
      if (magicRes.ok) magicJson = await magicRes.json();
    } catch (e) {
      magicJson = null;
    }
  }

  function computeDuration() {
    let duration = 0;
    if (video?.duration) duration = video.duration;
    if (musicData?.duration_sec) duration = Math.max(duration, musicData.duration_sec);
    if (motionJson?.events) {
      motionJson.events.forEach((evt) => {
        if (evt.type === "hold") duration = Math.max(duration, evt.t_end ?? 0);
        else duration = Math.max(duration, evt.t ?? 0);
      });
    }
    if (magicJson?.events) {
      magicJson.events.forEach((evt) => {
        duration = Math.max(duration, evt.t ?? 0);
      });
    }
    return duration || 1;
  }

  let pxPerSec = 80;
  const timelineScroll = $("#timeline-scroll");
  const renderAll = () => {
    const duration = computeDuration();
    buildTimeline({ music: musicData, motion: motionJson, magic: magicJson, duration, pxPerSec });
    syncCursor(video);
  };

  renderAll();
  enableScrub(video);

  timelineScroll.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    pxPerSec = Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, pxPerSec * (dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)));
    renderAll();
  }, { passive: false });

  video.addEventListener("loadedmetadata", renderAll);
}

loadProject();
