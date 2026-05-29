const video = document.getElementById("cam");
const canvas = document.getElementById("snap");
const cameraBox = document.getElementById("cameraBox");
const camSnapshot = document.getElementById("camSnapshot");
const camStatus = document.getElementById("camStatus");
const btnGuiDo = document.getElementById("btnGuiDo");
const btnLayDo = document.getElementById("btnLayDo");
const lockerGrid = document.getElementById("lockerGrid");
const notifyCard = document.getElementById("notifyBar");
const notifyIcon = document.getElementById("notifyIconMain");
const notifyIconI = document.getElementById("notifyIconIMain");
const notifyResult = document.getElementById("notifyResultMain");
const notifyLocker = document.getElementById("notifyLockerMain");
const notifyDetail = document.getElementById("notifyDetailMain");
const historyList = document.getElementById("historyList");
const toast = document.getElementById("toast");
const scanHint = document.getElementById("scanHint");

const IDLE_TITLE = "Xin ch\u00E0o!";
const IDLE_DETAIL =
  "Vui l\u00F2ng nh\u00ECn v\u00E0o gi\u1EEFa khung v\u00E0 b\u1EA5m G\u1EEDi \u0111\u1ED3 ho\u1EB7c L\u1EA5y \u0111\u1ED3";
const ACTION_GUI = "G\u1EEDi \u0111\u1ED3";
const ACTION_LAY = "L\u1EA5y \u0111\u1ED3";
const FACE_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";
const STABLE_NEEDED = 6;
const SCAN_INTERVAL_MS = 120;

let lockerState = { can_gui_do: false, can_lay_do: false, lockers: [] };
let selectedLockerId = null;
let mediaStream = null;
let cameraActive = false;
let faceModelsReady = false;
let scanMode = null;
let scanTimer = null;
let stableFrames = 0;

function formatTime(isoOrStr) {
  if (!isoOrStr) return "\u2014";
  const d = new Date(String(isoOrStr).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(isoOrStr).slice(11, 19) || String(isoOrStr);
  return d.toTimeString().slice(0, 8);
}

function updateClock() {
  document.getElementById("clock").textContent = new Date().toTimeString().slice(0, 8);
}

function showToast(ok, msg) {
  toast.textContent = msg;
  toast.className = "toast show " + (ok ? "ok" : "err");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

function toneForState(state) {
  if (state === "success") return "success";
  if (state === "error") return "error";
  if (state === "loading") return "loading";
  return "info";
}

function setNotify(state, opts = {}) {
  const tone = toneForState(state);
  const lockerTone = opts.lockerClass || tone;
  const detailTone = opts.detailClass ?? (state === "idle" ? "" : tone);
  const lockerText = opts.locker ?? "";
  const icons = {
    idle: "fa-circle-info",
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    loading: "fa-spinner fa-spin",
  };

  notifyCard.className = "notify-strip " + state;
  notifyIcon.className = "notify-icon " + state;
  notifyResult.className = "notify-result val-" + tone;
  notifyLocker.className = "notify-locker val-" + lockerTone;
  notifyDetail.className = "notify-detail-text" + (detailTone ? " val-" + detailTone : "");
  notifyIconI.className = "fa-solid " + (icons[state] || icons.idle);

  notifyResult.textContent = opts.result ?? IDLE_TITLE;
  notifyLocker.textContent = lockerText;
  notifyLocker.style.display = lockerText ? "inline-flex" : "none";
  notifyDetail.textContent = opts.detail ?? IDLE_DETAIL;
}

function describeFaceAuthError(message) {
  const msg = String(message || "").trim();

  if (/anti-spoof|gia mao|gi\u1EA3 m\u1EA1o|anh hoac man hinh|\u1EA3nh ho\u1EB7c m\u00E0n h\u00ECnh|install torch|pip install torch|torch/i.test(msg)) {
    return {
      result: "L\u1ED7i anti-spoof",
      detail: msg,
      action: "D\u00F9ng khu\u00F4n m\u1EB7t th\u1EADt, kh\u00F4ng ch\u1EE5p qua \u1EA3nh ho\u1EB7c m\u00E0n h\u00ECnh",
    };
  }

  if (/khong phat hien khuon mat|kh\u00F4ng ph\u00E1t hi\u1EC7n khu\u00F4n m\u1EB7t|no face/i.test(msg)) {
    return {
      result: "Kh\u00F4ng th\u1EA5y khu\u00F4n m\u1EB7t",
      detail: msg,
      action: "\u0110\u01B0a m\u1EB7t v\u00E0o gi\u1EEFa khung v\u00E0 nh\u00ECn th\u1EB3ng camera",
    };
  }

  if (/qua nho|qu\u00E1 nh\u1ECF|tien gan camera|ti\u1EBFn g\u1EA7n camera/i.test(msg)) {
    return {
      result: "Khu\u00F4n m\u1EB7t qu\u00E1 xa",
      detail: msg,
      action: "Ti\u1EBFn g\u1EA7n camera h\u01A1n r\u1ED3i th\u1EED l\u1EA1i",
    };
  }

  if (/goc nghieng|g\u00F3c nghi\u00EAng|nghieng dau|nghi\u00EAng \u0111\u1EA7u/i.test(msg)) {
    return {
      result: "M\u1EB7t \u0111ang b\u1ECB nghi\u00EAng",
      detail: msg,
      action: "Gi\u1EEF \u0111\u1EA7u th\u1EB3ng tr\u01B0\u1EDBc camera r\u1ED3i th\u1EED l\u1EA1i",
    };
  }

  if (/ty le khuon mat|t\u1EF7 l\u1EC7 khu\u00F4n m\u1EB7t|khong hop le|kh\u00F4ng h\u1EE3p l\u1EC7/i.test(msg)) {
    return {
      result: "G\u00F3c m\u1EB7t ch\u01B0a ph\u00F9 h\u1EE3p",
      detail: msg,
      action: "Nh\u00ECn th\u1EB3ng camera v\u00E0 gi\u1EEF tr\u1ECDn khu\u00F4n m\u1EB7t trong khung",
    };
  }

  if (/embedding|trich xuat|tr\u00EDch xu\u1EA5t|khong ro|kh\u00F4ng r\u00F5/i.test(msg)) {
    return {
      result: "\u1EA2nh khu\u00F4n m\u1EB7t ch\u01B0a r\u00F5",
      detail: msg,
      action: "Gi\u1EEF y\u00EAn, \u0111\u1EE7 s\u00E1ng v\u00E0 th\u1EED l\u1EA1i",
    };
  }

  return {
    result: "Kh\u00F3 x\u00E1c th\u1EF1c khu\u00F4n m\u1EB7t",
    detail: msg || "Vui l\u00F2ng th\u1EED l\u1EA1i.",
    action: "Gi\u1EEF m\u1EB7t r\u00F5, nh\u00ECn th\u1EB3ng camera r\u1ED3i th\u1EED l\u1EA1i",
  };
}

function showNotifyFromApi(data, actionLabel) {
  if (data.ok) {
    const lockerTxt = data.locker_id ? `T\u1EE7 ${data.locker_id}` : "";
    let detail = lockerTxt ? `\u0110\u00E3 m\u1EDF ${lockerTxt}` : "X\u00E1c th\u1EF1c th\u00E0nh c\u00F4ng";
    if (data.confidence != null) detail += ` \u00B7 ${data.confidence}%`;
    setNotify("success", {
      result: `${actionLabel} th\u00E0nh c\u00F4ng`,
      locker: lockerTxt,
      detail,
      lockerClass: "success",
      detailClass: "success",
      action: lockerTxt ? "\u0110\u00E3 m\u1EDF t\u1EE7" : "Ho\u00E0n t\u1EA5t",
    });
    return;
  }

  const failure = describeFaceAuthError(data.message);
  setNotify("error", {
    result: failure.result,
    detail: failure.detail,
    action: "Th\u1EED l\u1EA1i",
  });
}

function captureB64() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera ch\u01B0a s\u1EB5n s\u00E0ng");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function stopCamera() {
  stopAutoScan();
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  video.srcObject = null;
  cameraActive = false;
  cameraBox.classList.add("frozen");
  camStatus.textContent = "\u0110\u00E3 ch\u1EE5p \u1EA3nh";
  updateButtons();
}

function captureAndStopCamera() {
  const b64 = captureB64();
  camSnapshot.src = b64;
  stopCamera();
  return b64;
}

function updateCamUI() {
  if (!cameraActive) return;
  cameraBox.classList.remove("frozen");
  camSnapshot.removeAttribute("src");
  camStatus.textContent = faceModelsReady
    ? "Nh\u00ECn v\u00E0o gi\u1EEFa khung v\u00E0 b\u1EA5m G\u1EEDi/L\u1EA5y \u0111\u1ED3"
    : "Camera s\u1EB5n s\u00E0ng";
}

async function resumeCameraAfterAuth() {
  await startCamera();
  updateButtons();
}

function renderLockers(lockers) {
  lockerGrid.innerHTML = lockers
    .map(
      (locker) => `
        <div class="locker-cell ${locker.is_empty ? "empty" : "busy"} ${locker.id === selectedLockerId ? "selected" : ""}"
             data-id="${locker.id}">
          <i class="fa-solid fa-box"></i>
          <div class="name">T\u1EE7 ${locker.id}</div>
          <div class="state">${locker.label}</div>
        </div>`
    )
    .join("");

  lockerGrid.querySelectorAll(".locker-cell").forEach((cell) => {
    cell.onclick = () => {
      selectedLockerId = parseInt(cell.dataset.id, 10);
      renderLockers(lockerState.lockers);
    };
  });
}

function logToHistoryItem(log) {
  const ok = log.status === "SUCCESS";
  let icon = ok ? "ok" : "err";
  let iconClass = ok ? "fa-check" : "fa-xmark";
  let title = log.message || log.action_type;
  let desc = log.action_type;

  if (log.action_type === "GUI_DO" && ok) {
    title = `${ACTION_GUI} th\u00E0nh c\u00F4ng`;
    desc = log.message || "";
  } else if (log.action_type === "LAY_DO" && ok) {
    title = `${ACTION_LAY} th\u00E0nh c\u00F4ng`;
    desc = log.message || "";
  } else if (log.action_type === "MANUAL" && ok) {
    title = "M\u1EDF t\u1EE7 th\u1EE7 c\u00F4ng";
    desc = log.message || "";
  } else if (!ok) {
    title = log.status === "SPOOF" ? "C\u1EA3nh b\u00E1o gi\u1EA3 m\u1EA1o" : "X\u00E1c th\u1EF1c th\u1EA5t b\u1EA1i";
    desc = log.message || "Kh\u00F4ng kh\u1EDBp khu\u00F4n m\u1EB7t";
  }

  if (log.action_type === "SYSTEM") {
    icon = "info";
    iconClass = "fa-info";
  }

  return `
    <li class="history-item">
      <div class="history-icon ${icon}"><i class="fa-solid ${iconClass}"></i></div>
      <div class="history-body">
        <div class="title">${title}</div>
        <div class="desc">${desc}</div>
      </div>
      <span class="history-time">${formatTime(log.timestamp)}</span>
    </li>`;
}

async function loadHistory(limit = 5) {
  try {
    const res = await fetch("/face/logs?limit=" + limit);
    const data = await res.json();
    const logs = data.logs || [];
    if (!logs.length) {
      historyList.innerHTML =
        '<li class="history-item"><div class="history-body"><div class="desc">Ch\u01B0a c\u00F3 ho\u1EA1t \u0111\u1ED9ng</div></div></li>';
      return;
    }
    historyList.innerHTML = logs.map(logToHistoryItem).join("");
  } catch {
    historyList.innerHTML =
      '<li class="history-item"><div class="history-body"><div class="desc">Kh\u00F4ng t\u1EA3i \u0111\u01B0\u1EE3c l\u1ECBch s\u1EED</div></div></li>';
  }
}

function updateButtons() {
  if (scanMode) {
    btnGuiDo.disabled = scanMode.url !== "/face/gui-do";
    btnLayDo.disabled = scanMode.url !== "/face/lay-do";
    return;
  }
  const ready = cameraActive && faceModelsReady;
  btnGuiDo.disabled = !ready || !lockerState.can_gui_do;
  btnLayDo.disabled = !ready || !lockerState.can_lay_do;
}

async function loadFaceModels() {
  if (typeof faceapi === "undefined") {
    showToast(false, "Kh\u00F4ng t\u1EA3i \u0111\u01B0\u1EE3c th\u01B0 vi\u1EC7n nh\u1EADn di\u1EC7n");
    return;
  }

  try {
    camStatus.textContent = "\u0110ang t\u1EA3i AI ph\u00E1t hi\u1EC7n m\u1EB7t...";
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    faceModelsReady = true;
    if (cameraActive) camStatus.textContent = "Nh\u00ECn v\u00E0o gi\u1EEFa khung v\u00E0 b\u1EA5m G\u1EEDi/L\u1EA5y \u0111\u1ED3";
  } catch (e) {
    faceModelsReady = false;
    showToast(false, "Kh\u00F4ng t\u1EA3i model: " + e.message);
  }

  updateButtons();
}

function isFaceCentered(detection) {
  const box = detection.box;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const offX = Math.abs(cx - vw / 2) / vw;
  const offY = Math.abs(cy - vh / 2) / vh;
  const centered = offX < 0.14 && offY < 0.14;
  const bigEnough = box.width / vw > 0.2 && box.height / vh > 0.22;
  return centered && bigEnough;
}

function stopAutoScan() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  scanMode = null;
  stableFrames = 0;
  cameraBox.classList.remove("scanning", "face-ready");
  btnGuiDo.classList.remove("scanning");
  btnLayDo.classList.remove("scanning");
  updateButtons();
}

function cancelAutoScan() {
  stopAutoScan();
  setNotify("idle", { result: IDLE_TITLE, detail: IDLE_DETAIL });
  camStatus.textContent = "Camera s\u1EB5n s\u00E0ng";
}

async function tickAutoScan() {
  if (!scanMode || !cameraActive) return;

  try {
    const detection = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })
    );

    if (!detection || !isFaceCentered(detection)) {
      stableFrames = 0;
      cameraBox.classList.remove("face-ready");
      const reason = detection ? "\u0110\u01B0a m\u1EB7t v\u00E0o gi\u1EEFa khung" : "Ch\u01B0a th\u1EA5y khu\u00F4n m\u1EB7t";
      scanHint.textContent = reason;
      camStatus.textContent = reason;
      return;
    }

    stableFrames += 1;
    const pct = Math.min(100, Math.round((stableFrames / STABLE_NEEDED) * 100));
    scanHint.textContent = `Gi\u1EEF y\u00EAn... ${pct}%`;
    camStatus.textContent = `Gi\u1EEF y\u00EAn \u0111\u1EC3 t\u1EF1 ch\u1EE5p ${pct}%`;

    if (stableFrames >= STABLE_NEEDED - 1) {
      cameraBox.classList.add("face-ready");
    }

    if (stableFrames >= STABLE_NEEDED) {
      const mode = scanMode;
      stopAutoScan();
      await submitFaceApi(mode.url, mode.label);
    }
  } catch (e) {
    console.error(e);
  }
}

function startAutoScan(url, actionLabel) {
  if (!cameraActive) {
    setNotify("error", {
      result: "Camera ch\u01B0a s\u1EB5n",
      detail: "\u0110ang b\u1EADt l\u1EA1i camera",
      action: "\u0110\u1EE3i",
    });
    return;
  }

  if (!faceModelsReady) {
    setNotify("error", {
      result: "AI ch\u01B0a s\u1EB5n",
      detail: "\u0110ang t\u1EA3i nh\u1EADn di\u1EC7n khu\u00F4n m\u1EB7t",
      action: "\u0110\u1EE3i",
    });
    return;
  }

  if (scanMode?.url === url) {
    cancelAutoScan();
    return;
  }

  stopAutoScan();
  scanMode = { url, label: actionLabel };
  stableFrames = 0;
  cameraBox.classList.add("scanning");
  if (url === "/face/gui-do") btnGuiDo.classList.add("scanning");
  else btnLayDo.classList.add("scanning");

  setNotify("idle", {
    result: "\u0110ang qu\u00E9t",
    detail: "Gi\u1EEF m\u1EB7t \u1EDF gi\u1EEFa khung",
    action: "H\u1EE7y qu\u00E9t",
  });

  camStatus.textContent = "\u0110\u01B0a khu\u00F4n m\u1EB7t v\u00E0o gi\u1EEFa khung";
  updateButtons();
  scanTimer = setInterval(tickAutoScan, SCAN_INTERVAL_MS);
}

async function refreshStatus() {
  try {
    const res = await fetch("/face/status");
    const data = await res.json();
    lockerState = data;

    if (selectedLockerId === null && data.lockers?.length) {
      const first = data.lockers.find((locker) => locker.is_empty) || data.lockers[0];
      selectedLockerId = first.id;
    }

    renderLockers(data.lockers || []);
    document.getElementById("sumTotal").textContent = data.total_lockers ?? 0;
    document.getElementById("sumBusy").textContent = data.in_use_lockers ?? 0;
    document.getElementById("sumEmpty").textContent = data.empty_lockers ?? 0;

    const espEl = document.getElementById("espStatus");
    const espText = document.getElementById("espText");
    if (data.esp_connected) {
      espEl.classList.remove("off");
      espText.textContent = "\u0110\u00E3 k\u1EBFt n\u1ED1i";
    } else {
      espEl.classList.add("off");
      espText.textContent = "M\u1EA5t k\u1EBFt n\u1ED1i";
    }

    updateButtons();
  } catch {
    setNotify("error", {
      result: "M\u1EA5t k\u1EBFt n\u1ED1i",
      detail: "Kh\u00F4ng li\u00EAn l\u1EA1c \u0111\u01B0\u1EE3c server",
      action: "Ki\u1EC3m tra",
    });
  }
}

async function submitFaceApi(url, actionLabel) {
  btnGuiDo.disabled = true;
  btnLayDo.disabled = true;

  let imageB64;
  try {
    imageB64 = captureAndStopCamera();
  } catch (e) {
    setNotify("error", {
      result: "Kh\u00F4ng ch\u1EE5p \u0111\u01B0\u1EE3c",
      detail: e.message || "B\u1EADt l\u1EA1i camera r\u1ED3i th\u1EED",
      action: "Th\u1EED l\u1EA1i",
    });
    await resumeCameraAfterAuth();
    return;
  }

  setNotify("loading", {
    result: "\u0110ang x\u00E1c th\u1EF1c",
    detail: "\u0110ang ph\u00E2n t\u00EDch \u1EA3nh",
    action: "\u0110\u1EE3i",
  });

  try {
    const fd = new FormData();
    fd.append("image", imageB64);
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    showNotifyFromApi(data, actionLabel);
    if (data.locker_id) selectedLockerId = data.locker_id;
    await refreshStatus();
    await loadHistory();
    return data;
  } catch (e) {
    setNotify("error", {
      result: "L\u1ED7i h\u1EC7 th\u1ED1ng",
      detail: e.message || "Vui l\u00F2ng th\u1EED l\u1EA1i",
      action: "Th\u1EED l\u1EA1i",
    });
  } finally {
    await resumeCameraAfterAuth();
  }
}

async function startCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
    video.srcObject = mediaStream;
    cameraActive = false;
    video.onloadedmetadata = () => {
      cameraActive = true;
      updateCamUI();
      updateButtons();
    };
  } catch (e) {
    cameraActive = false;
    showToast(false, "Kh\u00F4ng m\u1EDF \u0111\u01B0\u1EE3c camera: " + e.message);
    camStatus.textContent = "L\u1ED7i camera";
  }
}

btnGuiDo.onclick = () => startAutoScan("/face/gui-do", ACTION_GUI);
btnLayDo.onclick = () => startAutoScan("/face/lay-do", ACTION_LAY);
updateClock();
setInterval(updateClock, 1000);
setNotify("idle", { result: IDLE_TITLE, detail: IDLE_DETAIL });
refreshStatus();
loadHistory();
loadFaceModels();
startCamera();
setInterval(refreshStatus, 12000);
