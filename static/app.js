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

const IDLE_TITLE = "Xin chào!";
const IDLE_DETAIL =
  "Vui lòng nhìn vào giữa khung và bấm Gửi đồ hoặc Lấy đồ";
const ACTION_GUI = "Gửi đồ";
const ACTION_LAY = "Lấy đồ";
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
  if (!isoOrStr) return "—";
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

  if (/anti-spoof|gia mao|giả mạo|anh hoac man hinh|ảnh hoặc màn hình|install torch|pip install torch|torch/i.test(msg)) {
    return {
      result: "Lỗi anti-spoof",
      detail: msg,
      action: "Dùng khuôn mặt thật, không chụp qua ảnh hoặc màn hình",
    };
  }

  if (/khong phat hien khuon mat|không phát hiện khuôn mặt|no face/i.test(msg)) {
    return {
      result: "Không thấy khuôn mặt",
      detail: msg,
      action: "Đưa mặt vào giữa khung và nhìn thẳng camera",
    };
  }

  if (/qua nho|quá nhỏ|tien gan camera|tiến gần camera/i.test(msg)) {
    return {
      result: "Khuôn mặt quá xa",
      detail: msg,
      action: "Tiến gần camera hơn rồi thử lại",
    };
  }

  if (/goc nghieng|góc nghiêng|nghieng dau|nghiêng đầu/i.test(msg)) {
    return {
      result: "Mặt đang bị nghiêng",
      detail: msg,
      action: "Giữ đầu thẳng trước camera rồi thử lại",
    };
  }

  if (/ty le khuon mat|tỷ lệ khuôn mặt|khong hop le|không hợp lệ/i.test(msg)) {
    return {
      result: "Góc mặt chưa phù hợp",
      detail: msg,
      action: "Nhìn thẳng camera và giữ trọn khuôn mặt trong khung",
    };
  }

  if (/embedding|trich xuat|trích xuất|khong ro|không rõ/i.test(msg)) {
    return {
      result: "Ảnh khuôn mặt chưa rõ",
      detail: msg,
      action: "Giữ yên, đủ sáng và thử lại",
    };
  }

  return {
    result: "Khó xác thực khuôn mặt",
    detail: msg || "Vui lòng thử lại.",
    action: "Giữ mặt rõ, nhìn thẳng camera rồi thử lại",
  };
}

function showNotifyFromApi(data, actionLabel) {
  if (data.ok) {
    const lockerTxt = data.locker_id ? `Tủ ${data.locker_id}` : "";
    let detail = lockerTxt ? `Đã mở ${lockerTxt}` : "Xác thực thành công";
    if (data.confidence != null) detail += ` · ${data.confidence}%`;
    setNotify("success", {
      result: `${actionLabel} thành công`,
      locker: lockerTxt,
      detail,
      lockerClass: "success",
      detailClass: "success",
      action: lockerTxt ? "Đã mở tủ" : "Hoàn tất",
    });
    return;
  }

  const failure = describeFaceAuthError(data.message);
  setNotify("error", {
    result: failure.result,
    detail: failure.detail,
    action: "Thử lại",
  });
}

function captureB64() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera chưa sẵn sàng");
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
  camStatus.textContent = "Đã chụp ảnh";
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
    ? "Nhìn vào giữa khung và bấm Gửi/Lấy đồ"
    : "Camera sẵn sàng";
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
          <div class="name">Tủ ${locker.id}</div>
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
    title = `${ACTION_GUI} thành công`;
    desc = log.message || "";
  } else if (log.action_type === "LAY_DO" && ok) {
    title = `${ACTION_LAY} thành công`;
    desc = log.message || "";
  } else if (log.action_type === "MANUAL" && ok) {
    title = "Mở tủ thủ công";
    desc = log.message || "";
  } else if (!ok) {
    title = log.status === "SPOOF" ? "Cảnh báo giả mạo" : "Xác thực thất bại";
    desc = log.message || "Không khớp khuôn mặt";
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
        '<li class="history-item"><div class="history-body"><div class="desc">Chưa có hoạt động</div></div></li>';
      return;
    }
    historyList.innerHTML = logs.map(logToHistoryItem).join("");
  } catch {
    historyList.innerHTML =
      '<li class="history-item"><div class="history-body"><div class="desc">Không tải được lịch sử</div></div></li>';
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
    showToast(false, "Không tải được thư viện nhận diện");
    return;
  }

  try {
    camStatus.textContent = "Đang tải AI phát hiện mặt...";
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    faceModelsReady = true;
    if (cameraActive) camStatus.textContent = "Nhìn vào giữa khung và bấm Gửi/Lấy đồ";
  } catch (e) {
    faceModelsReady = false;
    showToast(false, "Không tải model: " + e.message);
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
  camStatus.textContent = "Camera sẵn sàng";
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
      const reason = detection ? "Đưa mặt vào giữa khung" : "Chưa thấy khuôn mặt";
      scanHint.textContent = reason;
      camStatus.textContent = reason;
      return;
    }

    stableFrames += 1;
    const pct = Math.min(100, Math.round((stableFrames / STABLE_NEEDED) * 100));
    scanHint.textContent = `Giữ yên... ${pct}%`;
    camStatus.textContent = `Giữ yên để tự chụp ${pct}%`;

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
      result: "Camera chưa sẵn",
      detail: "Đang bật lại camera",
      action: "Đợi",
    });
    return;
  }

  if (!faceModelsReady) {
    setNotify("error", {
      result: "AI chưa sẵn",
      detail: "Đang tải nhận diện khuôn mặt",
      action: "Đợi",
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
    result: "Đang quét",
    detail: "Giữ mặt ở giữa khung",
    action: "Hủy quét",
  });

  camStatus.textContent = "Đưa khuôn mặt vào giữa khung";
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
      espText.textContent = "Đã kết nối";
    } else {
      espEl.classList.add("off");
      espText.textContent = "Mất kết nối";
    }

    updateButtons();
  } catch {
    setNotify("error", {
      result: "Mất kết nối",
      detail: "Không liên lạc được server",
      action: "Kiểm tra",
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
      result: "Không chụp được",
      detail: e.message || "Bật lại camera rồi thử",
      action: "Thử lại",
    });
    await resumeCameraAfterAuth();
    return;
  }

  setNotify("loading", {
    result: "Đang xác thực",
    detail: "Đang phân tích ảnh",
    action: "Đợi",
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
      result: "Lỗi hệ thống",
      detail: e.message || "Vui lòng thử lại",
      action: "Thử lại",
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
    showToast(false, "Không mở được camera: " + e.message);
    camStatus.textContent = "Lỗi camera";
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
