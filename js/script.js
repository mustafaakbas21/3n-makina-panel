/**
 * 3N Makine — Ana sayfa: Appwrite’tan dinamik veri
 * Appwrite Client / Storage / Databases ve ID sabitleri: js/appwrite-config.mjs → window.__3nAppwrite
 */
"use strict";

var SESSION_USER_KEY = "3n_session_user";

function getAw() {
  return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
    ? window.__3nAppwrite
    : null;
}

/** Girişte kaydedilen kullanıcı adı (login.js → localStorage) */
function getSessionDisplayName() {
  try {
    const v = localStorage.getItem(SESSION_USER_KEY);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  } catch (e) {
    /* — */
  }
  return "Kullanıcı";
}

function avatarUrlForName(name) {
  const n = encodeURIComponent(name || "User");
  return (
    "https://ui-avatars.com/api/?name=" +
    n +
    "&size=128&background=3b82f6&color=ffffff&bold=true"
  );
}

function applySessionUserToHeader() {
  const display = getSessionDisplayName();
  const welcome = document.querySelector(".header__welcome");
  if (welcome && welcome.textContent.indexOf("Hoş Geldin") !== -1) {
    const nameSpan = welcome.querySelector(".header__name");
    if (nameSpan) nameSpan.textContent = display;
  }
  document.querySelectorAll(".header__user-name").forEach(function (el) {
    el.textContent = display;
  });
  document.querySelectorAll(".header__avatar").forEach(function (img) {
    if (img && img.tagName === "IMG") {
      img.src = avatarUrlForName(display);
      img.alt = display;
    }
  });
}

/** Üst arama + bildirimler için tek seferlik önbellek */
var headerDataCache = null;

async function ensureHeaderDataCache() {
  if (headerDataCache) return headerDataCache;
  const aw = getAw();
  if (!aw || !aw.databases || !aw.isConfigured()) {
    headerDataCache = { companies: [], reports: [] };
    return headerDataCache;
  }
  try {
    const [cRes, rRes] = await Promise.all([
      aw.databases.listDocuments(aw.DATABASE_ID, aw.COLLECTION_COMPANIES, [
        aw.Query.orderAsc("name"),
        aw.Query.limit(500),
      ]),
      aw.databases.listDocuments(aw.DATABASE_ID, aw.COLLECTION_REPORTS, [
        aw.Query.orderDesc("$createdAt"),
        aw.Query.limit(400),
      ]),
    ]);
    headerDataCache = {
      companies: aw.normalizeDocuments(cRes.documents || []),
      reports: aw.normalizeDocuments(rRes.documents || []),
    };
  } catch (e) {
    headerDataCache = { companies: [], reports: [] };
  }
  return headerDataCache;
}

function rowValFlexible(row, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = row[keys[i]];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function parseExpiryForNotify(raw) {
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

async function loadHeaderNotifications() {
  const ul = document.querySelector("#notifyDropdown .header__dropdown-list");
  const badge = document.querySelector(".header__badge");
  if (!ul) return;

  ul.innerHTML =
    '<li class="header__dropdown-item--loading"><span class="header__dropdown-dot"></span><span>Yükleniyor…</span></li>';

  const aw = getAw();
  if (!aw || !aw.databases || !aw.isConfigured()) {
    ul.innerHTML =
      '<li><span class="header__dropdown-dot"></span><span>Appwrite yapılandırması eksik.</span></li>';
    if (badge) {
      badge.textContent = "0";
      badge.hidden = true;
    }
    return;
  }

  const items = [];

  try {
    const recentReports = await aw.databases.listDocuments(
      aw.DATABASE_ID,
      aw.COLLECTION_REPORTS,
      [aw.Query.orderDesc("$createdAt"), aw.Query.limit(6)]
    );
    const docsR = aw.normalizeDocuments(recentReports.documents || []);
    docsR.forEach(function (row) {
      const id = row.id != null ? String(row.id) : "";
      const title = rowValFlexible(row, ["title"]) || "Rapor";
      const ca = row.createdAt || row.$createdAt;
      const ts = ca ? new Date(ca).getTime() : 0;
      const t = String(title);
      items.push({
        ts: ts,
        html:
          '<li><span class="header__dropdown-dot"></span><a class="header__dropdown-link" href="./reports.html#report-' +
          encodeURIComponent(id) +
          '">Yeni rapor: ' +
          escapeHtml(t.length > 42 ? t.slice(0, 40) + "…" : t) +
          "</a></li>",
      });
    });

    const recentCos = await aw.databases.listDocuments(
      aw.DATABASE_ID,
      aw.COLLECTION_COMPANIES,
      [aw.Query.orderDesc("$updatedAt"), aw.Query.limit(12)]
    );
    const docsC = aw.normalizeDocuments(recentCos.documents || []);
    docsC.forEach(function (row) {
      const created = row.createdAt || row.$createdAt;
      const updated = row.updatedAt || row.$updatedAt;
      const cMs = created ? new Date(created).getTime() : 0;
      const uMs = updated ? new Date(updated).getTime() : 0;
      if (!uMs || uMs <= cMs + 60000) return;
      const id = row.id != null ? String(row.id) : "";
      const name = rowValFlexible(row, ["name"]) || "Şirket";
      const n = String(name);
      items.push({
        ts: uMs,
        html:
          '<li><span class="header__dropdown-dot"></span><a class="header__dropdown-link" href="./companies.html#company-' +
          encodeURIComponent(id) +
          '">Şirket güncellendi: ' +
          escapeHtml(n.length > 36 ? n.slice(0, 34) + "…" : n) +
          "</a></li>",
      });
    });

    const allReports = (await ensureHeaderDataCache()).reports || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    allReports.forEach(function (row) {
      const raw = rowValFlexible(row, [
        "expiryDate",
        "expiry_date",
        "validUntil",
        "valid_until",
      ]);
      const exp = parseExpiryForNotify(raw);
      if (!exp) return;
      exp.setHours(0, 0, 0, 0);
      const diffDays = Math.round((exp.getTime() - today.getTime()) / 86400000);
      if (diffDays < 0 || diffDays > 30) return;
      const id = row.id != null ? String(row.id) : "";
      const title = rowValFlexible(row, ["title"]) || "Rapor";
      const t = String(title);
      items.push({
        ts: exp.getTime(),
        html:
          '<li><span class="header__dropdown-dot"></span><a class="header__dropdown-link" href="./reports.html#report-' +
          encodeURIComponent(id) +
          '">Geçerlilik ' +
          (diffDays === 0
            ? "bugün bitiyor"
            : diffDays + " gün içinde bitiyor") +
          ": " +
          escapeHtml(t.length > 32 ? t.slice(0, 30) + "…" : t) +
          "</a></li>",
      });
    });
  } catch (e) {
    ul.innerHTML =
      '<li><span class="header__dropdown-dot"></span><span>Bildirimler yüklenemedi.</span></li>';
    if (badge) {
      badge.textContent = "!";
      badge.hidden = false;
    }
    return;
  }

  items.sort(function (a, b) {
    return b.ts - a.ts;
  });
  const max = 10;
  const slice = items.slice(0, max);
  if (slice.length === 0) {
    ul.innerHTML =
      '<li><span class="header__dropdown-dot"></span><span>Şu an gösterilecek bildirim yok.</span></li>';
    if (badge) {
      badge.textContent = "0";
      badge.hidden = true;
    }
    return;
  }

  ul.innerHTML = slice.map(function (x) {
    return x.html;
  }).join("");
  if (badge) {
    badge.textContent = String(slice.length);
    badge.hidden = false;
  }
}

function closeHeaderSearchPanel() {
  const p = document.getElementById("headerSearchPanel");
  if (p) {
    p.hidden = true;
    p.innerHTML = "";
  }
}

function wireHeaderGlobalSearch() {
  const input = document.getElementById("headerSearchInput");
  const panel = document.getElementById("headerSearchPanel");
  const slot = document.querySelector(".header-search-slot");
  if (!input || !panel || !slot) return;

  let t = null;
  input.addEventListener(
    "input",
    function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        void renderHeaderSearchResults(input.value);
      }, 220);
    }
  );
  input.addEventListener("focus", function () {
    if (input.value.trim()) void renderHeaderSearchResults(input.value);
  });
  document.addEventListener("click", function (e) {
    if (!slot.contains(e.target)) closeHeaderSearchPanel();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeHeaderSearchPanel();
  });
}

async function renderHeaderSearchResults(q) {
  const panel = document.getElementById("headerSearchPanel");
  if (!panel) return;
  const query = String(q || "")
    .trim()
    .toLowerCase();
  if (query.length < 1) {
    closeHeaderSearchPanel();
    return;
  }

  const data = await ensureHeaderDataCache();
  const companies = data.companies || [];
  const reports = data.reports || [];

  const matchCompany = companies.filter(function (c) {
    const n = rowValFlexible(c, ["name"]);
    return n && String(n).toLowerCase().indexOf(query) !== -1;
  });
  const matchReports = reports.filter(function (r) {
    const title = rowValFlexible(r, ["title"]);
    const t = title != null ? String(title).toLowerCase() : "";
    const cid = rowValFlexible(r, ["companyId", "company_id"]);
    let cname = "";
    if (cid != null) {
      const co = companies.find(function (x) {
        return String(x.id) === String(cid);
      });
      cname =
        co && rowValFlexible(co, ["name"])
          ? String(rowValFlexible(co, ["name"])).toLowerCase()
          : "";
    }
    return t.indexOf(query) !== -1 || (cname && cname.indexOf(query) !== -1);
  });

  const lines = [];
  matchCompany.slice(0, 6).forEach(function (c) {
    const id = c.id != null ? String(c.id) : "";
    const name = rowValFlexible(c, ["name"]) || "Şirket";
    lines.push({
      href: "./companies.html#company-" + encodeURIComponent(id),
      icon: "fa-building",
      text: String(name),
      sub: "Şirket",
    });
  });
  matchReports.slice(0, 8).forEach(function (r) {
    const id = r.id != null ? String(r.id) : "";
    const title = rowValFlexible(r, ["title"]) || "Rapor";
    lines.push({
      href: "./reports.html#report-" + encodeURIComponent(id),
      icon: "fa-file-lines",
      text: String(title),
      sub: "Rapor",
    });
  });

  if (lines.length === 0) {
    panel.hidden = false;
    panel.innerHTML =
      '<div class="header-search-panel__empty">Sonuç yok.</div>';
    return;
  }

  panel.hidden = false;
  panel.innerHTML =
    '<ul class="header-search-panel__list">' +
    lines
      .map(function (L) {
        return (
          '<li><a class="header-search-panel__link" href="' +
          escapeHtml(L.href) +
          '"><i class="fa-solid ' +
          escapeHtml(L.icon) +
          '" aria-hidden="true"></i><span class="header-search-panel__text"><span class="header-search-panel__title">' +
          escapeHtml(L.text) +
          '</span><span class="header-search-panel__meta">' +
          escapeHtml(L.sub) +
          "</span></span></a></li>"
        );
      })
      .join("") +
    "</ul>";
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
          localStorage.removeItem(SESSION_USER_KEY);
        } catch (err) {}
        window.location.href = "./login.html";
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
      localStorage.removeItem(SESSION_USER_KEY);
    } catch (err) {}
    window.location.href = "./login.html";
  });
}

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------

function scheduleHeaderAppwriteFeatures() {
  var n = 0;
  function tick() {
    const aw = getAw();
    if (aw && aw.isConfigured && aw.isConfigured()) {
      void ensureHeaderDataCache().then(function () {
        void loadHeaderNotifications();
      });
      wireHeaderGlobalSearch();
      return;
    }
    n += 1;
    if (n < 80) {
      setTimeout(tick, 50);
    } else {
      void loadHeaderNotifications();
      wireHeaderGlobalSearch();
    }
  }
  tick();
}

document.addEventListener("DOMContentLoaded", function () {
  applySessionUserToHeader();
  setActiveSidebarNav();
  wireSidebarLogout();

  if (document.getElementById("notifyMenuBtn")) {
    wireHeaderDropdowns();
    scheduleHeaderAppwriteFeatures();
  }

  if (document.getElementById("recent-reports-list")) {
    renderCalendar();
    wireCalendarNav();
    wireCalendarGridInteraction();
    loadDashboardData();
  }
});
