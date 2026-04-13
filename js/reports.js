/**
 * 3N Makine — Rapor Deposu (reports.html)
 * Appwrite: js/appwrite-config.mjs → window.__3nAppwrite
 */
(function () {
  "use strict";

  function getAw() {
    return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
      ? window.__3nAppwrite
      : null;
  }

  let reportsCache = [];
  let companiesById = {};
  let pendingUploadFile = null;

  function rowVal(row, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = row[keys[i]];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function displayCell(val) {
    if (val == null || String(val).trim() === "") return "—";
    return escapeHtml(String(val));
  }

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

  function validityDateFromRow(row) {
    const v = rowVal(row, [
      "expiryDate",
      "expiry_date",
      "validUntil",
      "valid_until",
      "expiresAt",
      "expires_at",
      "endDate",
      "end_date",
      "validityEnd",
      "validity_end",
    ]);
    return v;
  }

  function fileTypeLabel(url) {
    if (!url) return "—";
    const u = String(url).split("?")[0];
    const parts = u.split(".");
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : "";
    if (ext === "pdf") return "PDF";
    if (ext === "doc" || ext === "docx") return "Word";
    if (ext === "xls" || ext === "xlsx") return "Excel";
    return ext ? ext.toUpperCase() : "—";
  }

  /**
   * Appwrite Storage file view URL → bucketId + fileId (silme için).
   * Örn. .../v1/storage/buckets/BUCKET/files/FILE_ID/view?...
   */
  function parseAppwriteStorageFileFromViewUrl(url) {
    if (!url || typeof url !== "string") return null;
    const m = url.match(/\/storage\/buckets\/([^/]+)\/files\/([^/?#]+)/i);
    if (!m) return null;
    return { bucketId: m[1], fileId: m[2] };
  }

  function sanitizeStorageFileLabel(raw) {
    var s = String(raw || "Belge")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!s) s = "Belge";
    return s.slice(0, 72);
  }

  /** İndirme ile kaydedilecek dosya adı: 3N_Makina_Raporu_{şirket|başlık}.pdf */
  function friendlyDownloadFilenameForRow(row) {
    var company = companyNameForReport(row);
    var base =
      company && company !== "—"
        ? company
        : rowVal(row, ["title"]) || "Belge";
    return "3N_Makina_Raporu_" + sanitizeStorageFileLabel(base) + ".pdf";
  }

  function triggerPdfDownload(url, filename) {
    fetch(url, { mode: "cors", credentials: "include" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var a = document.createElement("a");
        var u = URL.createObjectURL(blob);
        a.href = u;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(u);
      })
      .catch(function () {
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

  function getSelectedCompanyId() {
    const sel = document.getElementById("reportCompanyFilter");
    return sel ? String(sel.value || "").trim() : "";
  }

  function getReportSearchQuery() {
    const el = document.getElementById("reportSearchInput");
    return el ? el.value.trim().toLowerCase() : "";
  }

  function filterReports(rows) {
    let out = rows.slice();
    const companyId = getSelectedCompanyId();
    if (companyId) {
      out = out.filter(function (r) {
        const cid = rowVal(r, ["companyId", "company_id"]);
        return cid != null && String(cid) === companyId;
      });
    }
    const q = getReportSearchQuery();
    if (q) {
      out = out.filter(function (r) {
        const title = rowVal(r, ["title"]);
        const t = title != null ? String(title).toLowerCase() : "";
        return t.indexOf(q) !== -1;
      });
    }
    return out;
  }

  function companyNameForReport(row) {
    const cid = rowVal(row, ["companyId", "company_id"]);
    if (cid == null) return "—";
    const key = String(cid);
    const n = companiesById[key];
    return n != null && String(n).trim() !== "" ? String(n) : "—";
  }

  function renderReportsTable(rows) {
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;

    const filtered = filterReports(rows);

    if (!filtered.length) {
      tbody.innerHTML =
        '<tr class="data-table__loading"><td colspan="6">Kayıt bulunamadı.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map(function (row) {
        const title = rowVal(row, ["title"]) || "—";
        const created = rowVal(row, ["createdAt", "created_at"]);
        const validityRaw = validityDateFromRow(row);
        const pdfUrl = rowVal(row, ["pdfUrl", "pdf_url"]);
        const id = row.id != null ? escapeHtml(String(row.id)) : "";
        const urlAttr = pdfUrl ? escapeHtml(String(pdfUrl)) : "";
        const company = companyNameForReport(row);
        const fileType = fileTypeLabel(pdfUrl);

        const downloadDisabled = !pdfUrl || String(pdfUrl).trim() === "";
        const downloadName = friendlyDownloadFilenameForRow(row);
        const downloadNameAttr = escapeHtml(downloadName);

        return (
          "<tr data-report-id=\"" +
          id +
          "\">" +
          "<td>" +
          displayCell(title) +
          "</td>" +
          "<td>" +
          escapeHtml(company) +
          "</td>" +
          "<td>" +
          escapeHtml(formatReportDate(created)) +
          "</td>" +
          "<td>" +
          escapeHtml(formatReportDate(validityRaw)) +
          "</td>" +
          "<td>" +
          escapeHtml(fileType) +
          "</td>" +
          "<td class=\"data-table__actions\">" +
          (downloadDisabled
            ? "<span class=\"download-btn download-btn--disabled\" aria-disabled=\"true\">" +
              "<i class=\"fa-solid fa-download\" aria-hidden=\"true\"></i> İndir" +
              "</span>"
            : "<a class=\"download-btn\" href=\"" +
              urlAttr +
              "\" download=\"" +
              downloadNameAttr +
              "\" rel=\"noopener noreferrer\">" +
              "<i class=\"fa-solid fa-download\" aria-hidden=\"true\"></i> İndir" +
              "</a>") +
          (id
            ? "<button type=\"button\" class=\"delete-report-btn\" data-document-id=\"" +
              id +
              "\" title=\"Raporu sil\">" +
              "<i class=\"fa-solid fa-trash\" aria-hidden=\"true\"></i> Sil" +
              "</button>"
            : "") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function applyFiltersAndRender() {
    renderReportsTable(reportsCache);
    scrollToReportFromHash();
  }

  function scrollToReportFromHash() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    const m = raw.match(/^report-(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-report-id]");
    var tr = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-report-id") === id) {
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

  function fillCompanyDropdown(companies) {
    const sel = document.getElementById("reportCompanyFilter");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Tüm şirketler</option>';
    companies.forEach(function (c) {
      const id = c.id != null ? String(c.id) : "";
      const name = rowVal(c, ["name"]) || "—";
      if (!id) return;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (current) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === current) {
          sel.value = current;
          break;
        }
      }
    }
  }

  function fillUploadModalCompanies(companies) {
    const sel = document.getElementById("uploadModalCompany");
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">Şirket seçin…</option>';
    companies.forEach(function (c) {
      const id = c.id != null ? String(c.id) : "";
      const name = rowVal(c, ["name"]) || "—";
      if (!id) return;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (keep) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === keep) {
          sel.value = keep;
          break;
        }
      }
    }
  }

  function openReportUploadModal() {
    const root = document.getElementById("reportUploadModal");
    if (!root) return;
    root.hidden = false;
    root.style.display = "flex";
    document.body.style.overflow = "hidden";
    const companyFocus = document.getElementById("uploadModalCompany");
    if (companyFocus) companyFocus.focus();
  }

  function closeReportUploadModal() {
    const root = document.getElementById("reportUploadModal");
    if (!root) return;
    root.hidden = true;
    root.style.display = "none";
    document.body.style.overflow = "";
    pendingUploadFile = null;
    const form = document.getElementById("reportUploadForm");
    if (form) form.reset();
    const label = document.getElementById("reportUploadFileLabel");
    if (label) label.textContent = "";
  }

  function defaultExpiryISO() {
    const n = new Date();
    n.setFullYear(n.getFullYear() + 1);
    return (
      n.getFullYear() +
      "-" +
      String(n.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(n.getDate()).padStart(2, "0")
    );
  }

  function showUploadModalForFile(file) {
    if (!file) return;
    pendingUploadFile = file;
    const label = document.getElementById("reportUploadFileLabel");
    if (label) {
      label.textContent = "Dosya: " + file.name;
    }
    const titleInput = document.getElementById("uploadModalTitle");
    if (titleInput && !titleInput.value) {
      const base = file.name.replace(/\.[^.]+$/, "");
      titleInput.value = base.length ? base : "Yüklenen rapor";
    }
    const exp = document.getElementById("uploadModalExpiry");
    if (exp && !exp.value) {
      exp.value = defaultExpiryISO();
    }
    openReportUploadModal();
  }

  function handleChosenFile(file) {
    if (!file) return;
    showUploadModalForFile(file);
  }

  async function submitReportUpload(e) {
    e.preventDefault();
    const aw = getAw();
    if (!pendingUploadFile || !aw || !aw.storage || !aw.databases) {
      window.alert("Dosya veya Appwrite bağlantısı yok.");
      return;
    }
    if (!aw.isConfigured()) {
      window.alert("Appwrite: js/appwrite-config.mjs içinde ID’leri doldurun.");
      return;
    }

    const companyId = document.getElementById("uploadModalCompany");
    const titleEl = document.getElementById("uploadModalTitle");
    const expiryEl = document.getElementById("uploadModalExpiry");
    const submitBtn = document.getElementById("submitReportUploadBtn");

    const cid = companyId && companyId.value ? companyId.value.trim() : "";
    const title = titleEl && titleEl.value ? titleEl.value.trim() : "";
    const expiry =
      expiryEl && expiryEl.value ? expiryEl.value.trim() : "";

    if (!cid) {
      window.alert("Lütfen şirket seçin.");
      return;
    }
    if (!title) {
      window.alert("Lütfen rapor adını girin.");
      return;
    }
    if (!expiry) {
      window.alert("Lütfen geçerlilik bitiş tarihini seçin.");
      return;
    }

    const file = pendingUploadFile;
    var companyLabel = "Belge";
    if (companyId && companyId.selectedIndex >= 0) {
      var opt = companyId.options[companyId.selectedIndex];
      if (opt && opt.textContent) {
        companyLabel = opt.textContent.trim() || "Belge";
      }
    }
    var storageFileId =
      "3N_Makina_Raporu_" +
      sanitizeStorageFileLabel(companyLabel) +
      "_" +
      Date.now() +
      ".pdf";

    if (submitBtn) submitBtn.disabled = true;

    var publicUrl = "";
    try {
      await aw.storage.createFile(aw.BUCKET_REPORTS, storageFileId, file);
      publicUrl = aw.getStorageFileViewUrl(aw.BUCKET_REPORTS, storageFileId);
    } catch (uploadError) {
      window.alert(
        "Dosya yüklenemedi:\n" +
          (uploadError && uploadError.message
            ? uploadError.message
            : String(uploadError))
      );
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const insertRow = {
      title: title,
      companyId: cid,
      pdfUrl: publicUrl,
      expiryDate: expiry,
    };

    try {
      await aw.databases.createDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        aw.ID.unique(),
        insertRow
      );
    } catch (insErr) {
      if (submitBtn) submitBtn.disabled = false;
      window.alert(
        "Dosya yüklendi ancak kayıt eklenemedi:\n" +
          (insErr && insErr.message ? insErr.message : String(insErr))
      );
      return;
    }

    if (submitBtn) submitBtn.disabled = false;

    closeReportUploadModal();
    await loadReportsPage();
  }

  async function loadReportsPage() {
    const tbody = document.getElementById("reportsTableBody");
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
        '<tr class="data-table__loading data-table__error"><td colspan="6">Appwrite: js/appwrite-config.mjs içinde ID’leri doldurun.</td></tr>';
      return;
    }

    var companies = [];
    try {
      const companyRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        [aw.Query.orderAsc("name"), aw.Query.limit(500)]
      );
      companies = aw.normalizeDocuments(companyRes.documents || []);
    } catch (e) {
      window.alert(
        "Şirket listesi yüklenemedi: " +
          (e && e.message ? e.message : String(e))
      );
    }

    companiesById = {};
    companies.forEach(function (c) {
      if (c.id != null) {
        const n = rowVal(c, ["name"]);
        companiesById[String(c.id)] = n != null ? String(n) : "";
      }
    });
    fillCompanyDropdown(companies);
    fillUploadModalCompanies(companies);

    try {
      const reportRes = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        [aw.Query.orderDesc("$createdAt"), aw.Query.limit(500)]
      );
      reportsCache = aw.normalizeDocuments(reportRes.documents || []);
    } catch (reportErr) {
      tbody.innerHTML =
        '<tr class="data-table__loading data-table__error"><td colspan="6">' +
        escapeHtml(
          reportErr && reportErr.message
            ? reportErr.message
            : "Veri alınamadı."
        ) +
        "</td></tr>";
      reportsCache = [];
      window.alert(
        "Raporlar yüklenemedi: " +
          (reportErr && reportErr.message
            ? reportErr.message
            : "Bağlantı veya izinleri kontrol edin.")
      );
      return;
    }
    applyFiltersAndRender();
  }

  function wireDropZone() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");
    if (!dropZone || !fileInput) return;

    let dragDepth = 0;

    function setDragging(on) {
      if (on) dropZone.classList.add("drop-zone--drag");
      else dropZone.classList.remove("drop-zone--drag");
    }

    dropZone.addEventListener("click", function (e) {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    dropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });

    dropZone.addEventListener("dragenter", function (e) {
      e.preventDefault();
      dragDepth++;
      setDragging(true);
    });

    dropZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(true);
    });

    dropZone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    });

    dropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      dragDepth = 0;
      setDragging(false);
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        handleChosenFile(files[0]);
      }
    });

    fileInput.addEventListener("change", function () {
      const f = fileInput.files && fileInput.files[0];
      handleChosenFile(f);
      fileInput.value = "";
    });
  }

  async function deleteReportDocument(documentId, triggerBtn) {
    const aw = getAw();
    if (!aw || !aw.databases || !aw.isConfigured()) {
      window.alert("Appwrite yapılandırması eksik.");
      return;
    }

    const row = reportsCache.find(function (r) {
      return String(r.id) === String(documentId);
    });
    const pdfUrl = row ? rowVal(row, ["pdfUrl", "pdf_url"]) : "";

    if (triggerBtn) triggerBtn.disabled = true;

    try {
      await aw.databases.deleteDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        documentId
      );

      reportsCache = reportsCache.filter(function (r) {
        return String(r.id) !== String(documentId);
      });
      applyFiltersAndRender();

      if (pdfUrl && aw.storage) {
        const parsed = parseAppwriteStorageFileFromViewUrl(String(pdfUrl));
        if (parsed) {
          try {
            await aw.storage.deleteFile(parsed.bucketId, parsed.fileId);
          } catch (storageErr) {
            console.warn("Depo dosyası silinemedi (kayıt silindi):", storageErr);
          }
        }
      }
    } catch (err) {
      window.alert(
        "Rapor silinemedi: " +
          (err && err.message ? err.message : String(err))
      );
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  function wireReportTableActions() {
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;
    tbody.addEventListener("click", function (e) {
      const delBtn = e.target.closest(".delete-report-btn");
      if (delBtn) {
        if (delBtn.disabled) return;
        const docId = delBtn.getAttribute("data-document-id");
        if (!docId) return;
        if (
          !window.confirm(
            "Bu raporu kalıcı olarak silmek istiyor musunuz? Veritabanı kaydı ve (varsa) depodaki dosya kaldırılır."
          )
        ) {
          return;
        }
        deleteReportDocument(docId, delBtn);
        return;
      }

      const btn = e.target.closest(".download-btn");
      if (!btn || btn.classList.contains("download-btn--disabled")) return;
      const url = btn.getAttribute("href");
      if (!url) return;
      e.preventDefault();
      const name =
        btn.getAttribute("download") || "3N_Makina_Raporu.pdf";
      triggerPdfDownload(url, name);
    });
  }

  function wireUploadModal() {
    const form = document.getElementById("reportUploadForm");
    const cancel = document.getElementById("cancelReportUploadBtn");
    const closeX = document.getElementById("reportUploadModalClose");
    const backdrop = document.getElementById("reportUploadModal");

    if (form) {
      form.addEventListener("submit", submitReportUpload);
    }
    if (cancel) {
      cancel.addEventListener("click", function () {
        closeReportUploadModal();
      });
    }
    if (closeX) {
      closeX.addEventListener("click", function () {
        closeReportUploadModal();
      });
    }
    if (backdrop) {
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) closeReportUploadModal();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const root = document.getElementById("reportUploadModal");
      if (root && !root.hidden && root.style.display !== "none") {
        closeReportUploadModal();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const companySel = document.getElementById("reportCompanyFilter");
    if (companySel) {
      companySel.addEventListener("change", applyFiltersAndRender);
    }
    const searchInput = document.getElementById("reportSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", applyFiltersAndRender);
    }

    wireDropZone();
    wireUploadModal();
    wireReportTableActions();
    loadReportsPage();
  });
})();
