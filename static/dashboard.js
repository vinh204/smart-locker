const lockerGrid = document.getElementById("lockerGrid");
const toast = document.getElementById("toast");
const clock = document.getElementById("clock");
const espStatus = document.getElementById("espStatus");
const espText = document.getElementById("espText");
const manualLockerName = document.getElementById("manualLockerName");
const manualLockerState = document.getElementById("manualLockerState");
const btnManualGuiDo = document.getElementById("btnManualGuiDo");
const btnManualLayDo = document.getElementById("btnManualLayDo");
const sumTotal = document.getElementById("sumTotal");
const sumBusy = document.getElementById("sumBusy");
const sumEmpty = document.getElementById("sumEmpty");

let lockerState = { lockers: [] };
let selectedLockerId = null;
let manualActionPending = false;

function updateClock() {
  clock.textContent = new Date().toTimeString().slice(0, 8);
}

function showToast(ok, msg) {
  toast.textContent = msg;
  toast.className = "toast show " + (ok ? "ok" : "err");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

function getSelectedLocker() {
  return lockerState.lockers.find((locker) => locker.id === selectedLockerId) || null;
}

function updateManualPanel() {
  const locker = getSelectedLocker();
  const uiBusy = manualActionPending;

  if (!locker) {
    manualLockerName.textContent = "Tủ —";
    manualLockerState.textContent = "Chưa chọn";
    manualLockerState.className = "manual-locker-state idle";
    btnManualGuiDo.disabled = true;
    btnManualLayDo.disabled = true;
    return;
  }

  manualLockerName.textContent = `Tủ ${locker.id}`;
  manualLockerState.textContent = uiBusy ? "Đang xử lý" : locker.label;
  manualLockerState.className =
    "manual-locker-state " + (uiBusy ? "idle" : locker.is_empty ? "empty" : "busy");

  btnManualGuiDo.disabled = uiBusy || !locker.is_empty;
  btnManualLayDo.disabled = uiBusy || locker.is_empty;
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
      updateManualPanel();
    };
  });

  updateManualPanel();
}

async function refreshStatus(showErrorToast = false) {
  try {
    const res = await fetch("/face/status");
    const data = await res.json();
    lockerState = data;
    const lockers = data.lockers || [];

    if (!lockers.length) {
      selectedLockerId = null;
    } else if (!lockers.some((locker) => locker.id === selectedLockerId)) {
      const first = lockers.find((locker) => locker.is_empty) || lockers[0];
      selectedLockerId = first.id;
    }

    renderLockers(lockers);

    const total = data.total_lockers ?? 0;
    const busy = data.in_use_lockers ?? 0;
    const empty = data.empty_lockers ?? 0;

    sumTotal.textContent = total;
    sumBusy.textContent = busy;
    sumEmpty.textContent = empty;

    if (data.esp_connected) {
      espStatus.classList.remove("off");
      espText.textContent = "Đã kết nối";
    } else {
      espStatus.classList.add("off");
      espText.textContent = "Mất kết nối";
    }
  } catch (e) {
    if (showErrorToast) {
      showToast(false, e.message || "Không tải được trạng thái tủ");
    }
  }
}

async function callManualLockerAction(url, successTitle) {
  const locker = getSelectedLocker();
  if (!locker) return;

  manualActionPending = true;
  updateManualPanel();

  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    selectedLockerId = data.locker_id ?? selectedLockerId;

    await refreshStatus();

    if (data.ok) {
      showToast(true, data.message || successTitle);
      return;
    }

    showToast(false, data.message || "Thao tác thủ công thất bại");
  } catch (e) {
    showToast(false, e.message || "Không gửi được lệnh thủ công");
  } finally {
    manualActionPending = false;
    updateManualPanel();
  }
}

async function refreshDashboard(showErrorToast = false) {
  await refreshStatus(showErrorToast);
}

btnManualGuiDo.onclick = () =>
  callManualLockerAction(
    `/face/manual/gui-do/${selectedLockerId}`,
    "Gửi đồ thủ công thành công"
  );
btnManualLayDo.onclick = () =>
  callManualLockerAction(
    `/face/manual/lay-do/${selectedLockerId}`,
    "Lấy đồ thủ công thành công"
  );

updateClock();
setInterval(updateClock, 1000);
refreshDashboard();
setInterval(refreshDashboard, 12000);
