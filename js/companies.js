/**
 * 3N Makine — Şirket yönetimi (companies.html)
 * Appwrite: js/appwrite-config.mjs → window.__3nAppwrite
 */
(function () {
  "use strict";

  function getAw() {
    return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
      ? window.__3nAppwrite
      : null;
  }

  /** Satırda camelCase veya snake_case alan adlarını dene */
  function rowVal(row, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = row[keys[i]];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  /** Sunucudan gelen tüm satırlar (arama istemci tarafında) */
  let companiesCache = [];

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function displayCell(val) {
    if (val == null || String(val).trim() === "") return "—";
    return escapeHtml(String(val));
  }

  function getSearchQuery() {
    const el = document.getElementById("searchInput");
    return el ? el.value.trim().toLowerCase() : "";
  }

  function filterByName(rows, q) {
    if (!q) return rows.slice();
    return rows.filter(function (r) {
      const raw = rowVal(r, ["name"]);
      const n = raw != null ? String(raw).toLowerCase() : "";
      return n.indexOf(q) !== -1;
    });
  }

  function renderTable(rows) {
    const tbody = document.getElementById("companiesTableBody");
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML =
        '<tr class="data-table__loading"><td colspan="6">Kayıt bulunamadı.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (row) {
        const id = row.id != null ? escapeHtml(String(row.id)) : "";
        return (
          "<tr data-company-id=\"" +
          id +
          "\">" +
          "<td>" +
          displayCell(rowVal(row, ["name"])) +
          "</td>" +
          "<td>" +
          displayCell(rowVal(row, ["taxOffice", "tax_office"])) +
          "</td>" +
          "<td>" +
          displayCell(rowVal(row, ["taxNumber", "tax_number"])) +
          "</td>" +
          "<td>" +
          displayCell(rowVal(row, ["cityDistrict", "city_district"])) +
          "</td>" +
          "<td>" +
          displayCell(rowVal(row, ["phone"])) +
          "</td>" +
          "<td class=\"data-table__actions\">" +
          "<button type=\"button\" class=\"table-action-btn\" data-table-action=\"edit\" aria-label=\"Düzenle\">" +
          "<i class=\"fa-solid fa-pen-to-square\" aria-hidden=\"true\"></i>" +
          "</button> " +
          "<button type=\"button\" class=\"table-action-btn table-action-btn--danger\" data-table-action=\"delete\" aria-label=\"Sil\">" +
          "<i class=\"fa-solid fa-trash\" aria-hidden=\"true\"></i>" +
          "</button>" +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function applyFilterAndRender() {
    const q = getSearchQuery();
    renderTable(filterByName(companiesCache, q));
    scrollToCompanyFromHash();
  }

  function scrollToCompanyFromHash() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    const m = raw.match(/^company-(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const tbody = document.getElementById("companiesTableBody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-company-id]");
    var tr = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-company-id") === id) {
        tr = rows[i];
        break;
      }
    }
    if (!tr) return;
    tr.classList.add("data-table__row--flash");
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(function () {
      tr.classList.remove("data-table__row--flash");
    }, 2800);
  }

  async function loadCompanies() {
    const tbody = document.getElementById("companiesTableBody");
    if (!tbody) return;

    tbody.innerHTML =
      '<tr class="data-table__loading"><td colspan="6">Yükleniyor…</td></tr>';

    const aw = getAw();
    if (!aw || !aw.databases) {
      tbody.innerHTML =
        '<tr class="data-table__loading data-table__error"><td colspan="6">Appwrite SDK veya appwrite-config.mjs yüklenemedi.</td></tr>';
      return;
    }
    if (!aw.isConfigured()) {
      tbody.innerHTML =
        '<tr class="data-table__loading data-table__error"><td colspan="6">Appwrite: js/appwrite-config.mjs içinde DATABASE_ID ve koleksiyon ID’lerini doldurun.</td></tr>';
      return;
    }

    try {
      const res = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        [aw.Query.orderAsc("name"), aw.Query.limit(500)]
      );
      companiesCache = aw.normalizeDocuments(res.documents || []);
    } catch (err) {
      var msg = err && err.message ? err.message : "Veri alınamadı.";
      tbody.innerHTML =
        '<tr class="data-table__loading data-table__error"><td colspan="6">' +
        escapeHtml(msg) +
        "</td></tr>";
      companiesCache = [];
      window.alert("Şirketler yüklenemedi: " + msg);
      return;
    }
    applyFilterAndRender();
  }

  function openModal() {
    const root = document.getElementById("companyModal");
    if (!root) return;
    root.hidden = false;
    root.style.display = "flex";
    document.body.style.overflow = "hidden";
    const first = document.getElementById("companyName");
    if (first) first.focus();
  }

  function closeModal() {
    const root = document.getElementById("companyModal");
    if (!root) return;
    root.hidden = true;
    root.style.display = "none";
    document.body.style.overflow = "";
  }

  function clearForm() {
    const form = document.getElementById("companyForm");
    if (form) form.reset();
  }

  async function saveCompany() {
    const nameEl = document.getElementById("companyName");
    const name = nameEl ? nameEl.value.trim() : "";
    if (!name) {
      window.alert("Şirket unvanı zorunludur.");
      if (nameEl) nameEl.focus();
      return;
    }

    const aw = getAw();
    if (!aw || !aw.databases || !aw.isConfigured()) {
      window.alert("Appwrite yapılandırması eksik. js/appwrite-config.mjs dosyasını kontrol edin.");
      return;
    }

    function val(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      const v = el.value.trim();
      return v === "" ? null : v;
    }

    const payload = {
      name: name,
      taxOffice: val("taxOffice"),
      taxNumber: val("taxNumber"),
      cityDistrict: val("cityDistrict"),
      address: val("companyAddress"),
      contactName: val("contactName"),
      phone: val("companyPhone"),
      email: val("companyEmail"),
    };

    const saveBtn = document.getElementById("saveCompanyBtn");
    if (saveBtn) saveBtn.disabled = true;

    try {
      await aw.databases.createDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        aw.ID.unique(),
        payload
      );
    } catch (insErr) {
      if (saveBtn) saveBtn.disabled = false;
      window.alert(
        "Kayıt eklenemedi: " +
          (insErr && insErr.message ? insErr.message : String(insErr)) +
          "\n\nAppwrite’da Companies koleksiyonunda ilgili attribute’lar tanımlı mı?"
      );
      return;
    }

    if (saveBtn) saveBtn.disabled = false;

    closeModal();
    clearForm();
    await loadCompanies();
  }

  function wireTableActions() {
    const tbody = document.getElementById("companiesTableBody");
    if (!tbody) return;
    tbody.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-table-action]");
      if (!btn) return;
      e.preventDefault();
      window.alert("Bu özellik yakında eklenecek.");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("keyup", applyFilterAndRender);
    }

    const addBtn = document.getElementById("addCompanyBtn");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        clearForm();
        openModal();
      });
    }

    const cancelBtn = document.getElementById("cancelCompanyBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        closeModal();
        clearForm();
      });
    }

    const form = document.getElementById("companyForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        saveCompany();
      });
    }

    const saveBtn = document.getElementById("saveCompanyBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", function (e) {
        e.preventDefault();
        saveCompany();
      });
    }

    const modal = document.getElementById("companyModal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) {
          closeModal();
          clearForm();
        }
      });
    }

    const closeX = document.getElementById("companyModalClose");
    if (closeX) {
      closeX.addEventListener("click", function () {
        closeModal();
        clearForm();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const root = document.getElementById("companyModal");
      if (root && !root.hidden && root.style.display !== "none") {
        closeModal();
        clearForm();
      }
    });

    wireTableActions();
    loadCompanies();
  });
})();
