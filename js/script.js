/**
 * 3N Makine — Ana sayfa: Appwrite’tan dinamik veri
 * Appwrite Client / Storage / Databases ve ID sabitleri: js/appwrite-config.mjs → window.__3nAppwrite
 */
"use strict";

function getAw() {
  return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
    ? window.__3nAppwrite
    : null;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** ISO tarih string’ini tr-TR kısa tarih olarak gösterir */
function formatReportDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Metni güvenli şekilde HTML içine yazmak için kaçırır */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

/** İstatistik kartındaki <h3> metnini günceller */
function setStatText(elementId, text) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = text;
}

/** Yükleme / hata öncesi istatistik alanlarını sıfırlar */
function setStatsLoading() {
  setStatText("stat-reports", "…");
  setStatText("stat-companies", "…");
  setStatText("stat-qr", "…");
}

function setStatsMessage(message) {
  setStatText("stat-reports", message);
  setStatText("stat-companies", message);
  setStatText("stat-qr", message);
}

/** Son raporlar tablosuna tek satırlık mesaj (yükleniyor / hata / boş) */
function renderRecentReportsPlaceholder(message, isError) {
  const tbody = document.getElementById("recent-reports-list");
  if (!tbody) return;
  const cls = isError ? "data-table__loading data-table__error" : "data-table__loading";
  tbody.innerHTML =
    `<tr class="${cls}"><td colspan="3">${escapeHtml(message)}</td></tr>`;
}

// ---------------------------------------------------------------------------
// Takvim (dashboard sağ sütun)
// ---------------------------------------------------------------------------

const MONTH_NAMES_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const CALENDAR_MARKERS_STORAGE_KEY = "3n_calendar_report_markers";

function formatCalendarISODate(year, monthIndex, day) {
  return (
    year +
    "-" +
    String(monthIndex + 1).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function parseCalendarISODate(s) {
  if (!s || typeof s !== "string") return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  const y = parseInt(p[0], 10);
  const mo = parseInt(p[1], 10) - 1;
  const d = parseInt(p[2], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  return { y: y, m: mo, d: d };
}

function getReportCalendarMarkers() {
  try {
    const raw = localStorage.getItem(CALENDAR_MARKERS_STORAGE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j.items) ? j.items : [];
  } catch (e) {
    return [];
  }
}

function saveReportCalendarMarkersEntry(entry) {
  if (!entry || !entry.firstDate || !entry.reminderDate) return;
  const items = getReportCalendarMarkers();
  items.unshift({
    firstDate: entry.firstDate,
    reminderDate: entry.reminderDate,
    title: entry.title != null ? String(entry.title) : "",
    savedAt: new Date().toISOString(),
  });
  while (items.length > 50) {
    items.pop();
  }
  localStorage.setItem(
    CALENDAR_MARKERS_STORAGE_KEY,
    JSON.stringify({ items: items })
  );
}

/** create-report.js / editor.js başarılı kayıttan sonra çağrılır */
window.__3nSaveReportCalendarMarkers = function (entry) {
  saveReportCalendarMarkersEntry(entry);
};

const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedY: null,
  selectedM: null,
  selectedD: null,
};

/** Ana sayfa: son çekilen raporlar (takvimde bitiş günleri + yaklaşan kart) */
let dashboardReportsSnapshot = [];
let dashboardCompanyNames = {};

function reportExpiryToCalendarISO(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const head = raw.split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return formatCalendarISODate(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildExpiryDateSetFromReports(rows) {
  const set = new Set();
  (rows || []).forEach(function (row) {
    const v =
      row.expiryDate != null
        ? row.expiryDate
        : row.expiry_date != null
          ? row.expiry_date
          : null;
    const iso = reportExpiryToCalendarISO(v);
    if (iso) set.add(iso);
  });
  return set;
}

function parseExpiryForDiff(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const p = raw.slice(0, 10).split("-");
    return new Date(
      parseInt(p[0], 10),
      parseInt(p[1], 10) - 1,
      parseInt(p[2], 10)
    );
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildUrgentInspectionItems(reports, companyById) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  (reports || []).forEach(function (r) {
    const raw =
      r.expiryDate != null
        ? r.expiryDate
        : r.expiry_date != null
          ? r.expiry_date
          : null;
    if (raw == null || raw === "") return;
    const exp = parseExpiryForDiff(raw);
    if (!exp) return;
    exp.setHours(0, 0, 0, 0);
    const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
    if (diffDays > 30) return;
    const cid =
      r.companyId != null
        ? String(r.companyId)
        : r.company_id != null
          ? String(r.company_id)
          : "";
    const cname =
      cid && companyById[cid] ? companyById[cid] : "—";
    const title = r.title != null ? String(r.title) : "—";
    const labelIso =
      typeof raw === "string"
        ? raw.split("T")[0]
        : formatCalendarISODate(
            exp.getFullYear(),
            exp.getMonth(),
            exp.getDate()
          );
    out.push({
      title: title,
      companyName: cname,
      expiryLabel: formatReportDate(labelIso),
      diffDays: diffDays,
      expired: diffDays < 0,
    });
  });
  out.sort(function (a, b) {
    return a.diffDays - b.diffDays;
  });
  return out;
}

/**
 * Görünen ayın takvim ızgarasını çizer (Pzt başlangıçlı hafta).
 * Komşu ay günleri tıklanabilir; tıklanınca ilgili aya geçer ve gün seçilir.
 * Rapor kayıtlarından gelen ilk rapor / hatırlatıcı tarihleri renklendirilir.
 */
function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("calMonthLabel");
  if (!grid || !label) return;

  const y = calendarState.year;
  const m = calendarState.month;
  label.textContent = MONTH_NAMES_TR[m] + " " + y;

  const first = new Date(y, m, 1);
  const startWeekdayMon0 = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevMonthDays = new Date(y, m, 0).getDate();

  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  const nextY = m === 11 ? y + 1 : y;

  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth();
  const td = today.getDate();

  const markers = getReportCalendarMarkers();
  const firstSet = new Set();
  const reminderSet = new Set();
  markers.forEach(function (it) {
    if (it.firstDate) firstSet.add(it.firstDate);
    if (it.reminderDate) reminderSet.add(it.reminderDate);
  });

  const expirySet = buildExpiryDateSetFromReports(dashboardReportsSnapshot);

  grid.replaceChildren();
  const frag = document.createDocumentFragment();

  function appendCell(cy, cm, cd, muted) {
    const iso = formatCalendarISODate(cy, cm, cd);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className =
      "calendar-cell" +
      (muted ? " calendar-cell--muted" : " calendar-cell--in-month");
    cell.dataset.date = iso;

    const daySpan = document.createElement("span");
    daySpan.className = "calendar-cell__day";
    daySpan.textContent = String(cd);
    cell.appendChild(daySpan);

    if (expirySet.has(iso)) {
      const dot = document.createElement("span");
      dot.className = "calendar-cell__dot calendar-cell__dot--expiry";
      dot.setAttribute("aria-hidden", "true");
      cell.appendChild(dot);
    }

    let aria = iso;
    if (muted) aria += ", komşu ay günü";
    if (firstSet.has(iso)) aria += ", ilk rapor";
    if (reminderSet.has(iso)) aria += ", son hatırlatıcı";
    if (expirySet.has(iso)) aria += ", rapor geçerlilik bitişi";
    cell.setAttribute("aria-label", aria);

    if (ty === cy && tm === cm && td === cd) {
      cell.classList.add("calendar-cell--today");
    }
    if (
      calendarState.selectedY === cy &&
      calendarState.selectedM === cm &&
      calendarState.selectedD === cd
    ) {
      cell.classList.add("calendar-cell--selected");
    }
    if (firstSet.has(iso)) cell.classList.add("calendar-cell--has-first");
    if (reminderSet.has(iso)) cell.classList.add("calendar-cell--has-reminder");
    if (expirySet.has(iso)) cell.classList.add("calendar-cell--has-expiry");

    frag.appendChild(cell);
  }

  for (let i = 0; i < startWeekdayMon0; i++) {
    const cd = prevMonthDays - startWeekdayMon0 + i + 1;
    appendCell(prevY, prevM, cd, true);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    appendCell(y, m, d, false);
  }

  const used = startWeekdayMon0 + daysInMonth;
  const rowCount = Math.ceil(used / 7);
  const totalCells = Math.max(rowCount * 7, 42);
  let nextDay = 1;
  for (let k = used; k < totalCells; k++) {
    appendCell(nextY, nextM, nextDay++, true);
  }

  grid.appendChild(frag);
}

function wireCalendarGridInteraction() {
  const grid = document.getElementById("calendarGrid");
  if (!grid || grid.__3nCalendarClickWired) return;
  grid.__3nCalendarClickWired = true;
  grid.addEventListener("click", function (e) {
    const btn = e.target.closest(".calendar-cell");
    if (!btn || !btn.dataset.date) return;
    const parsed = parseCalendarISODate(btn.dataset.date);
    if (!parsed) return;
    calendarState.year = parsed.y;
    calendarState.month = parsed.m;
    calendarState.selectedY = parsed.y;
    calendarState.selectedM = parsed.m;
    calendarState.selectedD = parsed.d;
    renderCalendar();
  });
}

function calendarPrevMonth() {
  calendarState.month--;
  if (calendarState.month < 0) {
    calendarState.month = 11;
    calendarState.year--;
  }
  renderCalendar();
}

function calendarNextMonth() {
  calendarState.month++;
  if (calendarState.month > 11) {
    calendarState.month = 0;
    calendarState.year++;
  }
  renderCalendar();
}

// ---------------------------------------------------------------------------
// Yaklaşan denetimler (son raporlarla doldurulur)
// ---------------------------------------------------------------------------

function renderUrgentUpcomingList() {
  const ul = document.getElementById("upcomingList");
  const emptyEl = document.getElementById("upcomingEmpty");
  if (!ul || !emptyEl) return;

  if (!dashboardReportsSnapshot.length) {
    ul.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Henüz rapor kaydı yok.";
    return;
  }

  const items = buildUrgentInspectionItems(
    dashboardReportsSnapshot,
    dashboardCompanyNames
  );

  if (!items.length) {
    ul.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent =
      "Önümüzdeki 30 günde bitecek veya süresi dolmuş rapor yok.";
    return;
  }

  emptyEl.hidden = true;
  const max = Math.min(items.length, 8);
  ul.innerHTML = "";
  for (let i = 0; i < max; i++) {
    const it = items[i];
    const li = document.createElement("li");
    li.className = "upcoming-widget__item";
    if (it.expired) {
      li.classList.add("upcoming-widget__item--danger");
    } else {
      li.classList.add("upcoming-widget__item--warn");
    }
    const statusText = it.expired
      ? "Süresi doldu"
      : it.diffDays === 0
        ? "Bugün son gün"
        : "Kalan: " + it.diffDays + " gün";
    li.innerHTML =
      '<span class="upcoming-widget__item-title">' +
      escapeHtml(it.title) +
      "</span>" +
      '<span class="upcoming-widget__item-meta">' +
      escapeHtml(it.companyName) +
      " · Bitiş: " +
      escapeHtml(it.expiryLabel) +
      " · " +
      escapeHtml(statusText) +
      "</span>";
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Üst bar dropdown’ları
// ---------------------------------------------------------------------------

function closeHeaderDropdowns() {
  const notifyDd = document.getElementById("notifyDropdown");
  const profileDd = document.getElementById("profileDropdown");
  const notifyBtn = document.getElementById("notifyMenuBtn");
  const profileBtn = document.getElementById("profileMenuBtn");
  if (notifyDd) notifyDd.hidden = true;
  if (profileDd) profileDd.hidden = true;
  if (notifyBtn) notifyBtn.setAttribute("aria-expanded", "false");
  if (profileBtn) profileBtn.setAttribute("aria-expanded", "false");
}

function toggleNotifyDropdown() {
  const dd = document.getElementById("notifyDropdown");
  const btn = document.getElementById("notifyMenuBtn");
  const profileDd = document.getElementById("profileDropdown");
  const profileBtn = document.getElementById("profileMenuBtn");
  if (!dd || !btn) return;
  const willOpen = dd.hidden;
  if (profileDd) profileDd.hidden = true;
  if (profileBtn) profileBtn.setAttribute("aria-expanded", "false");
  dd.hidden = !willOpen;
  btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function toggleProfileDropdown() {
  const dd = document.getElementById("profileDropdown");
  const btn = document.getElementById("profileMenuBtn");
  const notifyDd = document.getElementById("notifyDropdown");
  const notifyBtn = document.getElementById("notifyMenuBtn");
  if (!dd || !btn) return;
  const willOpen = dd.hidden;
  if (notifyDd) notifyDd.hidden = true;
  if (notifyBtn) notifyBtn.setAttribute("aria-expanded", "false");
  dd.hidden = !willOpen;
  btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function wireHeaderDropdowns() {
  const notifyBtn = document.getElementById("notifyMenuBtn");
  const profileBtn = document.getElementById("profileMenuBtn");
  const settingsBtn = document.getElementById("profileSettingsBtn");
  const logoutBtn = document.getElementById("profileLogoutBtn");

  if (notifyBtn) {
    notifyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleNotifyDropdown();
    });
  }
  if (profileBtn) {
    profileBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleProfileDropdown();
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest(".header__dd-wrap")) return;
    closeHeaderDropdowns();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeHeaderDropdowns();
  });

  if (settingsBtn) {
    settingsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeHeaderDropdowns();
      window.alert("Ayarlar sayfası yakında eklenecek.");
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeHeaderDropdowns();
      if (window.confirm("Çıkış yapmak istiyor musunuz?")) {
        try {
          localStorage.removeItem("isLoggedIn");
        } catch (err) {}
        window.location.href = "login.html";
      }
    });
  }
}

function wireCalendarNav() {
  const prev = document.getElementById("calPrevBtn");
  const next = document.getElementById("calNextBtn");
  if (prev) prev.addEventListener("click", calendarPrevMonth);
  if (next) next.addEventListener("click", calendarNextMonth);
}

// ---------------------------------------------------------------------------
// Veri yükleme
// ---------------------------------------------------------------------------

/**
 * Ana sayfa istatistikleri ve son 5 raporu Appwrite’tan çeker.
 */
async function loadDashboardData() {
  if (!document.getElementById("recent-reports-list")) {
    return;
  }

  setStatsLoading();
  renderRecentReportsPlaceholder("Yükleniyor…", false);

  const aw = getAw();
  if (!aw || !aw.databases) {
    setStatsMessage("—");
    dashboardReportsSnapshot = [];
    dashboardCompanyNames = {};
    renderCalendar();
    renderUrgentUpcomingList();
    renderRecentReportsPlaceholder(
      "Appwrite SDK veya appwrite-config.mjs yüklenemedi.",
      true
    );
    return;
  }

  if (!aw.isConfigured()) {
    setStatsMessage("—");
    dashboardReportsSnapshot = [];
    dashboardCompanyNames = {};
    renderCalendar();
    renderUrgentUpcomingList();
    renderRecentReportsPlaceholder(
      "Appwrite: js/appwrite-config.mjs içinde DATABASE_ID, koleksiyon ve bucket ID’lerini doldurun.",
      true
    );
    return;
  }

  try {
    var companyCount = 0;
    var companyCountOk = false;
    try {
      const cRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        [aw.Query.limit(1)]
      );
      companyCount = cRes.total != null ? cRes.total : 0;
      companyCountOk = true;
    } catch (e) {
      setStatText("stat-companies", "!");
    }
    if (companyCountOk) {
      setStatText("stat-companies", String(companyCount));
    }

    var reportCount = 0;
    var reportCountOk = false;
    try {
      const rRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        [aw.Query.limit(1)]
      );
      reportCount = rRes.total != null ? rRes.total : 0;
      reportCountOk = true;
    } catch (e) {
      setStatText("stat-reports", "!");
    }
    if (reportCountOk) {
      setStatText("stat-reports", String(reportCount));
    }

    if (reportCountOk) {
      setStatText("stat-qr", String(reportCount * 10));
    } else if (companyCountOk) {
      setStatText("stat-qr", "0");
    }

    var compListRes;
    var reportsListRes;
    try {
      compListRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        [aw.Query.orderAsc("name"), aw.Query.limit(500)]
      );
      reportsListRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        [aw.Query.orderDesc("$createdAt"), aw.Query.limit(400)]
      );
    } catch (e) {
      dashboardReportsSnapshot = [];
      dashboardCompanyNames = {};
      renderCalendar();
      renderUrgentUpcomingList();
      renderRecentReportsPlaceholder(
        "Raporlar yüklenemedi. Koleksiyon alan adlarını ve izinleri kontrol edin.",
        true
      );
      return;
    }

    dashboardCompanyNames = {};
    (compListRes.documents || []).forEach(function (doc) {
      var row = aw.normalizeDocument(doc);
      if (row.id != null) {
        dashboardCompanyNames[String(row.id)] =
          row.name != null ? String(row.name) : "—";
      }
    });

    const tbody = document.getElementById("recent-reports-list");
    if (!tbody) return;

    dashboardReportsSnapshot = aw.normalizeDocuments(
      reportsListRes.documents || []
    );
    renderCalendar();
    renderUrgentUpcomingList();

    const recentRows = dashboardReportsSnapshot.slice(0, 5);
    if (recentRows.length === 0) {
      renderRecentReportsPlaceholder("Henüz rapor kaydı yok.", false);
      return;
    }

    tbody.innerHTML = recentRows
      .map(function (row) {
        const title = row.title != null ? String(row.title) : "—";
        const created = row.createdAt;
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(title) +
          "</td>" +
          "<td>" +
          escapeHtml(formatReportDate(created)) +
          "</td>" +
          '<td><span class="badge badge--ok">Tamamlandı</span></td>' +
          "</tr>"
        );
      })
      .join("");
  } catch (err) {
    setStatsMessage("!");
    dashboardReportsSnapshot = [];
    dashboardCompanyNames = {};
    renderCalendar();
    renderUrgentUpcomingList();
    renderRecentReportsPlaceholder("Beklenmeyen bir hata oluştu.", true);
  }
}

// ---------------------------------------------------------------------------
// Sayfa yolu → aktif menü (sidebar <a>)
// ---------------------------------------------------------------------------

function getCurrentPageFile() {
  let path = window.location.pathname || "";
  path = path.replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  let file = parts.length ? parts[parts.length - 1] : "";
  if (!file || file.indexOf(".") === -1) {
    return "index.html";
  }
  return file.toLowerCase();
}

function setActiveSidebarNav() {
  const nav = document.querySelector(".sidebar__nav");
  if (!nav) return;

  const current = getCurrentPageFile();
  const links = nav.querySelectorAll("a.sidebar__link");

  links.forEach(function (a) {
    a.classList.remove("sidebar__link--active");
    a.removeAttribute("aria-current");
  });

  links.forEach(function (a) {
    const href = (a.getAttribute("href") || "").trim();
    const target = href.split("/").pop().toLowerCase();
    let match = false;
    if (target === "index.html") {
      match = current === "index.html" || current === "";
    } else if (target) {
      match = target === current;
    }
    if (match) {
      a.classList.add("sidebar__link--active");
      a.setAttribute("aria-current", "page");
    }
  });
}

function wireSidebarLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    try {
      localStorage.removeItem("isLoggedIn");
    } catch (err) {}
    window.location.href = "login.html";
  });
}

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
  setActiveSidebarNav();
  wireSidebarLogout();

  if (document.getElementById("notifyMenuBtn")) {
    wireHeaderDropdowns();
  }

  if (document.getElementById("recent-reports-list")) {
    renderCalendar();
    wireCalendarNav();
    wireCalendarGridInteraction();
    loadDashboardData();
  }
});
