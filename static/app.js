const IDLE_TITLE = "Xin chào!";
const IDLE_DETAIL =
  "Bấm Gửi đồ hoặc Lấy đồ — hệ thống tự chụp khi mặt ở giữa khung";
const IDLE_ACTION = "";
const STABLE_NEEDED = 6;
const SCAN_INTERVAL_MS = 120;
const FACE_MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";

const video = document.getElementById("cam");
const canvas = document.getElementById("snap");
const cameraBox = document.getElementById("cameraBox");
const camSnapshot = document.getElementById("camSnapshot");
const camStatus = document.getElementById("camStatus");
const btnGuiDo = document.getElementById("btnGuiDo");
const btnLayDo = document.getElementById("btnLayDo");
const lockerGrid = document.getElementById("lockerGrid");
const notifyCard = document.getElementById("notifyCard");
const notifyIcon = notifyCard.querySelector(".notify-icon");
const notifyIconI = notifyIcon.querySelector("i");
const notifyResult = notifyCard.querySelector(".notify-result");
const notifyLocker = notifyCard.querySelector(".notify-locker");
const notifyDetail = notifyCard.querySelector(".notify-detail-text");
const notifyAction = notifyCard.querySelector(".btn-notify");
const notifyActionText = notifyAction.querySelector("span");
const historyList = document.getElementById("historyList");
const toast = document.getElementById("toast");
const choiceOverlay = document.getElementById("choiceOverlay");
const choiceTitle = document.getElementById("choiceTitle");
const choiceMessage = document.getElementById("choiceMessage");
const choiceLockerGrid = document.getElementById("choiceLockerGrid");
const choiceActions = document.getElementById("choiceActions");
const scanHint = document.getElementById("scanHint");
const clock = document.getElementById("clock");

let lockerState = { can_gui_do: false, can_lay_do: false, lockers: [] };
let lockerFullNoticeActive = false;
let lastCaptureB64 = null;
let selectedLockerId = null;
let mediaStream = null;
let cameraActive = false;
let faceModelsReady = false;
let scanMode = null;
let scanTimer = null;
let stableFrames = 0;

function formatTime(isoOrStr) {
  if (!isoOrStr) return "—";
  const value = String(isoOrStr);
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value.slice(11, 19) || value;
  return d.toTimeString().slice(0, 8);
}

function updateClock() {
  clock.textContent = new Date().toTimeString().slice(0, 8);
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
  notifyAction.className = "btn-notify " + state;
  notifyResult.className = "notify-result val-" + tone;
  notifyLocker.className = "notify-locker val-" + lockerTone;
  notifyDetail.className =
    "notify-detail-text" + (detailTone ? " val-" + detailTone : "");
  notifyIconI.className = "fa-solid " + (icons[state] || icons.idle);

  notifyResult.textContent = opts.result ?? IDLE_TITLE;
  notifyLocker.textContent = lockerText;
  notifyLocker.style.display = lockerText ? "inline-flex" : "none";
  notifyDetail.textContent = opts.detail ?? IDLE_DETAIL;
  notifyActionText.textContent = opts.action ?? IDLE_ACTION;
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
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  video.srcObject = null;
  cameraActive = false;
  cameraBox.classList.add("frozen");
  if (camStatus) camStatus.textContent = "Đã chụp ảnh";
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
  if (faceModelsReady) {
    camStatus.textContent = "Nhìn vào giữa khung — bấm Gửi/Lấy đồ";
    return;
  }
  camStatus.textContent = "Camera sẵn sàng";
}

async function resumeCameraAfterAuth() {
  await startCamera();
  updateButtons();
}

function syncLockerAvailabilityNotice() {
  if (
    scanMode ||
    notifyCard.classList.contains("loading") ||
    choiceOverlay.classList.contains("show")
  ) {
    return;
  }

  if (!lockerState.can_gui_do) {
    lockerFullNoticeActive = true;
    setNotify("error", {
      result: "Hết tủ trống",
      detail: "Hiện không còn tủ trống. Vui lòng lấy đồ trước khi gửi tiếp.",
      action: lockerState.can_lay_do ? "Bạn vẫn có thể bấm Lấy đồ" : "Chờ có tủ trống",
    });
    return;
  }

  if (lockerFullNoticeActive) {
    lockerFullNoticeActive = false;
    setNotify("idle");
  }
}

function describeFaceAuthError(message) {
  const msg = String(message || "").trim();

  if (/khong tim thay|không tìm thấy|khong khop|không khớp|tin cay|tin cậy/i.test(msg)) {
    return {
      result: "Không khớp phiên gửi đồ",
      detail: msg,
      action: "Dùng đúng khuôn mặt đã gửi đồ trước đó",
    };
  }

  if (/het tu|hết tủ|khong con tu|không còn tủ/i.test(msg)) {
    return {
      result: "Hết tủ trống",
      detail: msg,
      action: "Chờ có tủ trống hoặc lấy đồ trước",
    };
  }

  if (/chua thuc hien gui|chưa thực hiện gửi/i.test(msg)) {
    return {
      result: "Chưa gửi đồ",
      detail: msg,
      action: "Bấm Gửi đồ trước khi lấy",
    };
  }

  if (
    /anti-spoof|chong gia mao|chống giả mạo|gia mao|giả mạo|anh in|ảnh in|man hinh|màn hình/i.test(
      msg
    )
  ) {
    return {
      result: "Lỗi chống giả mạo",
      detail: msg,
      action: "Dùng khuôn mặt thật, không chụp qua ảnh hoặc màn hình",
    };
  }

  if (/loi ai|lỗi ai|embedding|trich xuat|trích xuất/i.test(msg)) {
    return {
      result: "Lỗi xử lý AI",
      detail: msg,
      action: "Thử lại với ánh sáng tốt hơn",
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

function hideChoiceOverlay() {
  choiceOverlay.classList.remove("show");
  choiceLockerGrid.style.display = "none";
  choiceLockerGrid.innerHTML = "";
  choiceActions.innerHTML = "";
}

function showChoiceOverlay(title, message, buttons, lockerButtons) {
  choiceTitle.textContent = title;
  choiceMessage.textContent = message;
  choiceActions.innerHTML = "";
  choiceLockerGrid.innerHTML = "";

  if (lockerButtons?.length) {
    choiceLockerGrid.style.display = "grid";
    lockerButtons.forEach((lb) => choiceLockerGrid.appendChild(lb));
  } else {
    choiceLockerGrid.style.display = "none";
  }

  buttons.forEach((btn) => choiceActions.appendChild(btn));
  choiceOverlay.classList.add("show");
}

function makeChoiceBtn(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.onclick = () => {
    hideChoiceOverlay();
    onClick();
  };
  return button;
}

async function submitWithCapture(url, extraFields) {
  if (!lastCaptureB64) {
    setNotify("error", {
      result: "Thiếu ảnh xác thực",
      detail: "Vui lòng quét khuôn mặt lại",
      action: "Bấm Gửi đồ hoặc Lấy đồ",
    });
    await resumeCameraAfterAuth();
    return null;
  }

  setNotify("loading", {
    result: "Đang xử lý…",
    detail: "Hệ thống đang thực hiện lựa chọn của bạn",
    action: "Vui lòng đợi",
  });

  const fd = new FormData();
  fd.append("image", lastCaptureB64);
  if (extraFields) {
    Object.entries(extraFields).forEach(([k, v]) => fd.append(k, String(v)));
  }

  try {
    const res = await fetch(url, { method: "POST", body: fd });
    return await res.json();
  } catch (e) {
    setNotify("error", {
      result: "Lỗi hệ thống",
      detail: e.message,
      action: "Thử lại",
    });
    return null;
  }
}

async function handleAuthChoice(data, actionLabel) {
  if (data.code === "ALREADY_DEPOSITED") {
    const lockers = (data.locker_ids || []).join(", ");
    showChoiceOverlay(
      "Bạn đã gửi đồ trước đó",
      data.message || `Bạn đang dùng tủ: ${lockers}. Bạn muốn lấy đồ hay mở tủ mới?`,
      [
        makeChoiceBtn("Lấy đồ", "btn-success", async () => {
          const result = await submitWithCapture("/face/lay-do", {});
          if (result) await finishAuthResponse(result, "Lấy đồ");
        }),
        makeChoiceBtn("Mở tủ mới (gửi đồ thêm)", "btn-primary", async () => {
          const result = await submitWithCapture("/face/gui-do", { intent: "new" });
          if (result) await finishAuthResponse(result, "Gửi đồ");
        }),
        makeChoiceBtn("Hủy", "btn-muted", async () => {
          setNotify("idle", {
            detail: "Đã hủy. Bấm Gửi đồ hoặc Lấy đồ để thử lại",
          });
          await resumeCameraAfterAuth();
        }),
      ]
    );
    setNotify("idle", {
      result: "Cần lựa chọn",
      detail: data.message,
      action: "Chọn thao tác trong hộp thoại",
    });
    return true;
  }

  if (data.code === "PICK_LOCKER") {
    const ids = data.locker_ids || [];
    const lockerButtons = ids.map((id) =>
      makeChoiceBtn(`Tủ ${id}`, "", async () => {
        const result = await submitWithCapture("/face/lay-do", { locker_id: id });
        if (result) await finishAuthResponse(result, "Lấy đồ");
      })
    );

    showChoiceOverlay(
      "Chọn tủ cần mở",
      data.message || "Bạn đang sử dụng nhiều tủ. Chọn một tủ hoặc mở tất cả.",
      [
        makeChoiceBtn("Mở tất cả tủ của tôi", "btn-success", async () => {
          const result = await submitWithCapture("/face/lay-do", { open_all: "true" });
          if (result) await finishAuthResponse(result, "Lấy đồ");
        }),
        makeChoiceBtn("Hủy", "btn-muted", async () => {
          setNotify("idle", { detail: "Đã hủy lấy đồ" });
          await resumeCameraAfterAuth();
        }),
      ],
      lockerButtons
    );
    setNotify("idle", {
      result: "Cần chọn tủ",
      detail: data.message,
      action: "Chọn tủ trong hộp thoại",
    });
    return true;
  }

  return false;
}

async function finishAuthResponse(data, actionLabel) {
  if (!data.ok && (await handleAuthChoice(data, actionLabel))) {
    return data;
  }

  showNotifyFromApi(data, actionLabel);
  if (data.locker_id) selectedLockerId = data.locker_id;
  else if (data.locker_ids?.length) selectedLockerId = data.locker_ids[0];

  await refreshStatus();
  await loadHistory();
  await resumeCameraAfterAuth();
  return data;
}

function showNotifyFromApi(data, actionLabel) {
  if (data.ok) {
    const lockerTxt = data.locker_id ? "Tủ " + data.locker_id : "—";
    let detail = data.message || "Xác thực thành công";
    if (data.confidence != null) detail += ` · Tin cậy ${data.confidence}%`;
    setNotify("success", {
      result: "Xác thực thành công",
      locker: lockerTxt,
      detail,
      lockerClass: "success",
      action: data.locker_id
        ? `Tủ số ${data.locker_id} đã mở — có thể thao tác tiếp`
        : `${actionLabel} thành công — có thể thao tác tiếp`,
    });
    return;
  }

  const failure = describeFaceAuthError(data.message);
  setNotify("error", {
    result: failure.result,
    locker: "",
    detail: failure.detail,
    action: failure.action,
  });
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

const ACTION_VI = {
  GUI_DO: "Gửi đồ",
  LAY_DO: "Lấy đồ",
  MANUAL: "Mở tủ thủ công",
  SYSTEM: "Hệ thống",
};

function logToHistoryItem(log) {
  const ok = log.status === "SUCCESS";
  let icon = ok ? "ok" : "err";
  let iconClass = ok ? "fa-check" : "fa-xmark";
  let title = log.message || ACTION_VI[log.action_type] || log.action_type;
  let desc = ACTION_VI[log.action_type] || log.action_type;

  if (log.action_type === "GUI_DO" && ok) {
    title = "Gửi đồ thành công";
    desc = log.message || "Đã mở tủ và lưu phiên gửi đồ";
  } else if (log.action_type === "LAY_DO" && ok) {
    title = "Lấy đồ thành công";
    desc = log.message || "Đã xác thực và mở tủ";
  } else if (log.action_type === "MANUAL" && ok) {
    title = "Mở tủ thủ công";
    desc = log.message || "";
  } else if (!ok) {
    if (log.status === "SPOOF") {
      title = "Cảnh báo giả mạo";
      desc = log.message || "Phát hiện ảnh hoặc màn hình giả";
    } else if (log.status === "ERROR") {
      title = "Lỗi hệ thống";
      desc = log.message || "Có lỗi xảy ra";
    } else {
      title = "Xác thực thất bại";
      desc = log.message || "Không khớp khuôn mặt";
    }
  }

  if (log.action_type === "SYSTEM") {
    icon = "info";
    iconClass = "fa-info";
    title = log.message || "Thông báo hệ thống";
    desc = "Hệ thống";
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
  btnGuiDo.disabled = !ready;
  btnLayDo.disabled = !ready;
}

async function loadFaceModels() {
  if (typeof faceapi === "undefined") {
    showToast(false, "Thư viện nhận diện khuôn mặt chưa tải");
    return;
  }

  try {
    camStatus.textContent = "Đang tải AI phát hiện mặt…";
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    faceModelsReady = true;
    if (cameraActive) {
      camStatus.textContent = "Nhìn vào giữa khung — bấm Gửi/Lấy đồ";
    }
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
  setNotify("idle", {
    detail: "Đã hủy quét. Nhấn Gửi đồ hoặc Lấy đồ để thử lại",
  });
  camStatus.textContent = "Camera sẵn sàng";
}

async function tickAutoScan() {
  if (!scanMode || !cameraActive) return;

  try {
    const detection = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.45,
      })
    );

    if (!detection || !isFaceCentered(detection)) {
      stableFrames = 0;
      cameraBox.classList.remove("face-ready");
      const reason = !detection ? "Chưa thấy khuôn mặt" : "Đưa mặt vào giữa khung";
      scanHint.textContent = reason;
      camStatus.textContent = reason;
      return;
    }

    stableFrames += 1;
    const pct = Math.min(100, Math.round((stableFrames / STABLE_NEEDED) * 100));
    scanHint.textContent = `Giữ yên… ${pct}%`;
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
  if (url === "/face/gui-do" && !lockerState.can_gui_do) {
    setNotify("error", {
      result: "Hết tủ trống",
      detail: "Hiện không còn tủ trống. Vui lòng lấy đồ trước khi gửi tiếp.",
      action: "Chờ có tủ trống hoặc lấy đồ",
    });
    return;
  }

  if (!cameraActive) {
    setNotify("error", {
      result: "Camera chưa bật",
      detail: "Đang khởi động lại camera…",
      action: "Vui lòng đợi",
    });
    return;
  }

  if (!faceModelsReady) {
    setNotify("error", {
      result: "AI chưa sẵn sàng",
      detail: "Đang tải model phát hiện mặt, thử lại sau vài giây",
      action: "Đợi và thử lại",
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
    result: "Đang quét khuôn mặt",
    locker: "",
    detail: `Bấm lại «${actionLabel}» để hủy · Tự chụp khi mặt ở giữa khung`,
    action: "Đưa mặt vào giữa khung xanh",
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
      const first = data.lockers.find((l) => l.is_empty) || data.lockers[0];
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
    syncLockerAvailabilityNotice();
  } catch {
    lockerFullNoticeActive = false;
    setNotify("error", {
      result: "Lỗi kết nối",
      detail: "Không kết nối được server",
      action: "Kiểm tra lại server",
    });
  }
}

async function submitFaceApi(url, actionLabel) {
  btnGuiDo.disabled = true;
  btnLayDo.disabled = true;

  let imageB64;
  try {
    imageB64 = captureAndStopCamera();
    lastCaptureB64 = imageB64;
  } catch (e) {
    setNotify("error", {
      result: "Không chụp được ảnh",
      detail: e.message,
      action: "Thử lại sau khi camera bật",
    });
    await resumeCameraAfterAuth();
    return;
  }

  setNotify("loading", {
    result: "Đang xác thực…",
    detail: "AI đang phân tích ảnh vừa chụp",
    action: "Vui lòng đợi",
  });

  try {
    const fd = new FormData();
    fd.append("image", imageB64);
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!data.ok && (await handleAuthChoice(data, actionLabel))) {
      return data;
    }
    await finishAuthResponse(data, actionLabel);
    return data;
  } catch (e) {
    setNotify("error", {
      result: "Lỗi hệ thống",
      detail: e.message,
      action: "Bấm Gửi đồ hoặc Lấy đồ để thử lại",
    });
    await resumeCameraAfterAuth();
  }
}

async function startCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
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

btnGuiDo.onclick = () => startAutoScan("/face/gui-do", "Gửi đồ");
btnLayDo.onclick = () => startAutoScan("/face/lay-do", "Lấy đồ");

updateClock();
setInterval(updateClock, 1000);
setNotify("idle");
refreshStatus();
loadHistory();
loadFaceModels();
startCamera();
setInterval(refreshStatus, 12000);
