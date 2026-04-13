/**
 * 3N Makine — QR Stüdyosu (tarayıcı tabanlı önizleme + tahmin edilen Storage URL + jsPDF + Appwrite)
 * Appwrite: js/appwrite-config.mjs → window.__3nAppwrite
 */
(function () {
  "use strict";

  function getAw() {
    return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
      ? window.__3nAppwrite
      : null;
  }

  const PDF_JS_VER = "3.11.174";
  const MAX_CANVAS_WIDTH = 920;

  /** Yüklemede kullanılacak dosya adı (örn. rapor_1712850123456.pdf) — QR bu URL’yi işaret eder */
  let currentQrFileName = "";

  let fabricCanvas = null;
  /** @type {fabric.Image | null} */
  let qrFabricImage = null;
  let lastQrDataUrl = "";

  function assignNewQrFileName() {
    currentQrFileName = "rapor_" + Date.now() + ".pdf";
  }

  function getPredictedPublicUrl() {
    const aw = getAw();
    if (!aw || !currentQrFileName) return "";
    return aw.getStorageFileViewUrl(aw.BUCKET_REPORTS, currentQrFileName);
  }

  function getPdfJs() {
    return typeof pdfjsLib !== "undefined" ? pdfjsLib : null;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function setLoading(visible, message) {
    const el = document.getElementById("qrLoadingOverlay");
    const msg = document.getElementById("qrLoadingMessage");
    if (msg && message) msg.textContent = message;
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? "flex" : "none";
  }

  function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  function disposeFabric() {
    if (fabricCanvas) {
      try {
        fabricCanvas.dispose();
      } catch (e) {
        /* dispose sırasında oluşan hatalar yoksayılır */
      }
      fabricCanvas = null;
    }
    qrFabricImage = null;
    lastQrDataUrl = "";
    setRepoSavePanelVisible(false);
  }

  function buildPdfBlobFromFabric(fc) {
    const imgData = fc.toDataURL({ format: "png", multiplier: 2 });
    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
      throw new Error("jsPDF yüklenmedi.");
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH, undefined, "FAST");
    return pdf.output("blob");
  }

  function localDateISOForInput(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  /** create-report / editor ile aynı varsayılan tarihler */
  function fillDefaultQrReportDates() {
    const f = document.getElementById("qrFirstDate");
    const r = document.getElementById("qrReminderDate");
    const ex = document.getElementById("qrExpiryDate");
    if (!f || !r) return;
    if (!f.value) {
      f.value = localDateISOForInput(new Date());
    }
    if (!r.value) {
      const n = new Date();
      n.setFullYear(n.getFullYear() + 1);
      r.value = localDateISOForInput(n);
    }
    if (ex && !ex.value) {
      const n = new Date();
      n.setFullYear(n.getFullYear() + 1);
      ex.value = localDateISOForInput(n);
    }
  }

  function getQrCalendarDateValues() {
    const f = document.getElementById("qrFirstDate");
    const r = document.getElementById("qrReminderDate");
    let firstD = f && f.value ? f.value.trim() : "";
    let remD = r && r.value ? r.value.trim() : "";
    if (!firstD) firstD = localDateISOForInput(new Date());
    if (!remD) {
      const n = new Date();
      n.setFullYear(n.getFullYear() + 1);
      remD = localDateISOForInput(n);
    }
    return { firstDate: firstD, reminderDate: remD };
  }

  function dataUrlToBlob(dataUrl) {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }

  function setRepoSavePanelVisible(visible) {
    const panel = document.getElementById("qrRepoSavePanel");
    const ok = document.getElementById("qrSaveSuccess");
    if (panel) panel.hidden = !visible;
    if (!visible && ok) {
      ok.hidden = true;
      const t = document.getElementById("qrSaveSuccessText");
      if (t) t.textContent = "";
    }
  }

  /**
   * PNG dataUrl → Fabric arka plan (ölçekli)
   */
  function openImageDataUrlAsFabricBackground(dataUrl, pixelW, pixelH) {
    return new Promise(function (resolve, reject) {
      const scale = Math.min(1, MAX_CANVAS_WIDTH / pixelW);
      const vw = pixelW * scale;
      const vh = pixelH * scale;

      const el = document.getElementById("pdfCanvas");
      if (!el) {
        reject(new Error("Tuval bulunamadı."));
        return;
      }

      disposeFabric();
      fabricCanvas = new fabric.Canvas("pdfCanvas", {
        width: vw,
        height: vh,
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
      });

      fabric.Image.fromURL(
        dataUrl,
        function (img) {
          if (!fabricCanvas) {
            reject(new Error("Tuval kapandı."));
            return;
          }
          const nw = img.width || 1;
          const nh = img.height || 1;
          img.set({
            left: 0,
            top: 0,
            scaleX: vw / nw,
            scaleY: vh / nh,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
          });
          fabricCanvas.setBackgroundImage(img, function () {
            fabricCanvas.requestRenderAll();
            resolve();
          });
        },
        { crossOrigin: "anonymous" }
      );
    });
  }

  async function openPdfInFabric(arrayBuffer) {
    const pdfjs = getPdfJs();
    if (!pdfjs) throw new Error("pdf.js yüklenemedi.");

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" +
      PDF_JS_VER +
      "/pdf.worker.min.js";

    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(1, MAX_CANVAS_WIDTH / baseVp.width);
    const viewport = page.getViewport({ scale: scale });

    const tmp = document.createElement("canvas");
    const ctx = tmp.getContext("2d");
    tmp.width = viewport.width;
    tmp.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    const bgDataUrl = tmp.toDataURL("image/png");
    await openImageDataUrlAsFabricBackground(
      bgDataUrl,
      viewport.width,
      viewport.height
    );
  }

  async function snapshotDocxToCanvas(arrayBuffer) {
    if (typeof mammoth === "undefined") {
      throw new Error("Mammoth kütüphanesi yüklenemedi.");
    }
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    const root = document.getElementById("qrSnapshotRoot");
    root.innerHTML =
      '<div class="qr-studio-snapshot-inner">' + result.value + "</div>";
    const inner = root.querySelector(".qr-studio-snapshot-inner");
    inner.style.width = "900px";
    inner.style.padding = "28px";
    inner.style.boxSizing = "border-box";
    inner.style.background = "#ffffff";
    inner.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';
    inner.style.fontSize = "13px";
    inner.style.lineHeight = "1.55";
    inner.style.color = "#0f172a";

    if (typeof html2canvas === "undefined") {
      root.innerHTML = "";
      throw new Error("html2canvas yüklenemedi.");
    }

    const canvas = await html2canvas(inner, {
      scale: 1.2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });
    root.innerHTML = "";
    return canvas;
  }

  function jsonToTableHtml(rows) {
    if (!rows || !rows.length) {
      return "<p>Boş sayfa</p>";
    }
    let maxCols = 0;
    for (let i = 0; i < rows.length; i++) {
      const L = rows[i] ? rows[i].length : 0;
      if (L > maxCols) maxCols = L;
    }
    if (maxCols === 0) return "<p>Boş sayfa</p>";

    const maxRow = Math.min(rows.length, 200);
    let h = '<table class="qr-studio-excel-table"><thead><tr>';
    const header = rows[0] || [];
    for (let c = 0; c < maxCols; c++) {
      const cell = c < header.length ? header[c] : "";
      h += "<th>" + escapeHtml(String(cell != null ? cell : "")) + "</th>";
    }
    h += "</tr></thead><tbody>";
    for (let r = 1; r < maxRow; r++) {
      h += "<tr>";
      const row = rows[r] || [];
      for (let c = 0; c < maxCols; c++) {
        const cell = c < row.length ? row[c] : "";
        h += "<td>" + escapeHtml(String(cell != null ? cell : "")) + "</td>";
      }
      h += "</tr>";
    }
    h += "</tbody></table>";
    return h;
  }

  async function snapshotExcelToCanvas(arrayBuffer) {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS (XLSX) yüklenemedi.");
    }
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    if (!wb.SheetNames || !wb.SheetNames.length) {
      throw new Error("Çalışma sayfası bulunamadı.");
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const html = jsonToTableHtml(json);

    const root = document.getElementById("qrSnapshotRoot");
    root.innerHTML =
      '<div class="qr-studio-snapshot-inner qr-studio-snapshot-inner--excel">' +
      html +
      "</div>";
    const inner = root.querySelector(".qr-studio-snapshot-inner");
    inner.style.width = "960px";
    inner.style.padding = "20px";
    inner.style.boxSizing = "border-box";
    inner.style.background = "#ffffff";

    if (typeof html2canvas === "undefined") {
      root.innerHTML = "";
      throw new Error("html2canvas yüklenemedi.");
    }

    const canvas = await html2canvas(inner, {
      scale: 1.05,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 960,
    });
    root.innerHTML = "";
    return canvas;
  }

  async function handleFile(file) {
    if (!file) return;
    const ext = extOf(file.name);

    try {
      const buf = await file.arrayBuffer();

      if (ext === "pdf") {
        setLoading(true, "PDF önizlemesi hazırlanıyor…");
        await openPdfInFabric(buf);
        setLoading(false);
        return;
      }

      if (ext === "docx") {
        setLoading(true, "Word belgesi görüntüye dönüştürülüyor…");
        const snap = await snapshotDocxToCanvas(buf);
        const dataUrl = snap.toDataURL("image/png");
        await openImageDataUrlAsFabricBackground(dataUrl, snap.width, snap.height);
        setLoading(false);
        return;
      }

      if (ext === "xls" || ext === "xlsx") {
        setLoading(true, "Excel tablosu görüntüye dönüştürülüyor…");
        const snap = await snapshotExcelToCanvas(buf);
        const dataUrl = snap.toDataURL("image/png");
        await openImageDataUrlAsFabricBackground(dataUrl, snap.width, snap.height);
        setLoading(false);
        return;
      }

      if (ext === "doc") {
        window.alert(
          "Eski .doc formatı tarayıcıda önizlenemiyor. Lütfen dosyayı .docx olarak kaydedip tekrar yükleyin."
        );
        return;
      }

      window.alert(
        "Desteklenen türler: PDF, Word (.docx), Excel (.xls, .xlsx)."
      );
    } catch (err) {
      setLoading(false);
      const root = document.getElementById("qrSnapshotRoot");
      if (root) root.innerHTML = "";
      window.alert(err && err.message ? err.message : String(err));
    }
  }

  function generateQrDataUrlFromText(text) {
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    holder.style.top = "0";
    document.body.appendChild(holder);
    try {
      if (typeof QRCode === "undefined") {
        throw new Error("QRCode kütüphanesi yok.");
      }
      new QRCode(holder, {
        text: text,
        width: 200,
        height: 200,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) {
      if (holder.parentNode) document.body.removeChild(holder);
      throw e;
    }

    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          const c = holder.querySelector("canvas");
          const im = holder.querySelector("img");
          let dataUrl = "";
          if (c) dataUrl = c.toDataURL("image/png");
          else if (im && im.src) dataUrl = im.src;
          if (holder.parentNode) document.body.removeChild(holder);
          if (!dataUrl) {
            reject(new Error("Karekod görüntüsü oluşturulamadı."));
            return;
          }
          resolve(dataUrl);
        } catch (e) {
          if (holder.parentNode) document.body.removeChild(holder);
          reject(e);
        }
      }, 90);
    });
  }

  async function addQrToCanvas() {
    if (!fabricCanvas) {
      window.alert("Önce bir belge yükleyin.");
      return;
    }

    const url = getPredictedPublicUrl().trim();
    if (!url) {
      window.alert(
        "Kalıcı dosya adresi oluşturulamadı. Appwrite yapılandırmasını (appwrite-config.mjs) kontrol edin."
      );
      return;
    }

    let dataUrl;
    try {
      dataUrl = await generateQrDataUrlFromText(url);
    } catch (e) {
      window.alert("Karekod oluşturulamadı.");
      return;
    }

    lastQrDataUrl = dataUrl;

    if (qrFabricImage && fabricCanvas) {
      fabricCanvas.remove(qrFabricImage);
      qrFabricImage = null;
    }

    await new Promise(function (resolve, reject) {
      fabric.Image.fromURL(
        dataUrl,
        function (img) {
          if (!fabricCanvas) {
            reject(new Error("Tuval yok."));
            return;
          }
          const cw = fabricCanvas.getWidth();
          const ch = fabricCanvas.getHeight();
          img.scaleToWidth(Math.min(168, cw * 0.22));
          img.set({
            left: cw / 2,
            top: ch / 2,
            originX: "center",
            originY: "center",
            cornerSize: 10,
            transparentCorners: false,
            borderColor: "#2563eb",
            cornerColor: "#2563eb",
            name: "qrOverlay",
          });
          fabricCanvas.add(img);
          fabricCanvas.setActiveObject(img);
          fabricCanvas.requestRenderAll();
          qrFabricImage = img;
          resolve();
        },
        { crossOrigin: "anonymous" }
      );
    });

    setRepoSavePanelVisible(true);
    const ok = document.getElementById("qrSaveSuccess");
    if (ok) ok.hidden = true;
  }

  async function saveQrToRepository() {
    if (!lastQrDataUrl) {
      window.alert("Önce karekodu tuval üzerine ekleyin.");
      return;
    }

    const companySel = document.getElementById("qrStudioCompany");
    const companyId = companySel && companySel.value ? companySel.value.trim() : "";
    if (!companyId) {
      window.alert("Kayıt için lütfen şirket seçin.");
      if (companySel) companySel.focus();
      return;
    }

    const titleEl = document.getElementById("qrReportTitle");
    const reportTitle =
      titleEl && titleEl.value && titleEl.value.trim()
        ? titleEl.value.trim()
        : "QR Stüdyosu kaydı";

    const expiryEl = document.getElementById("qrExpiryDate");
    const expiryVal = expiryEl && expiryEl.value ? expiryEl.value.trim() : "";
    if (!expiryVal) {
      window.alert("Lütfen geçerlilik bitiş tarihini seçin.");
      if (expiryEl) expiryEl.focus();
      return;
    }

    const aw = getAw();
    if (!aw || !aw.storage || !aw.databases || !aw.isConfigured()) {
      window.alert("Appwrite yapılandırması eksik. js/appwrite-config.mjs dosyasını kontrol edin.");
      return;
    }

    const btn = document.getElementById("qrSaveToRepoBtn");
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<span class="qr-repo-save__spinner" aria-hidden="true"></span> Kaydediliyor…';
    }

    try {
      const blob = dataUrlToBlob(lastQrDataUrl);
      const fileId = aw.ID.unique();
      const bucketId = aw.STORAGE_BUCKET_ID || aw.BUCKET_REPORTS;
      const file = aw.blobToFile(blob, "qr_" + fileId + ".png");

      await aw.storage.createFile(bucketId, fileId, file);
      const publicUrl = aw.getStorageFileViewUrl(bucketId, fileId);

      const insertPayload = {
        title: reportTitle,
        companyId: companyId,
        pdfUrl: publicUrl,
        expiryDate: expiryVal,
      };

      await aw.databases.createDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        aw.ID.unique(),
        insertPayload
      );

      const calDates = getQrCalendarDateValues();
      if (typeof window.__3nSaveReportCalendarMarkers === "function") {
        window.__3nSaveReportCalendarMarkers({
          firstDate: calDates.firstDate,
          reminderDate: calDates.reminderDate,
          title: reportTitle,
        });
      }

      const okBox = document.getElementById("qrSaveSuccess");
      const okText = document.getElementById("qrSaveSuccessText");
      if (okText) {
        okText.textContent =
          "Karekod görseli kaydedildi ve rapor listesine eklendi.";
      }
      if (okBox) okBox.hidden = false;
    } catch (e) {
      window.alert(e && e.message ? e.message : String(e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  }

  async function completeWorkflow() {
    if (!fabricCanvas) {
      window.alert("Önce bir belge yükleyin.");
      return;
    }
    if (!qrFabricImage || !lastQrDataUrl) {
      window.alert('Önce «Karekodu Yerleştir / Yenile» ile karekodu tuval üzerine ekleyin.');
      return;
    }

    const companySel = document.getElementById("qrStudioCompany");
    const companyId = companySel && companySel.value ? companySel.value.trim() : "";
    if (!companyId) {
      window.alert("Kayıt için lütfen şirket seçin.");
      if (companySel) companySel.focus();
      return;
    }

    const titleEl = document.getElementById("qrReportTitle");
    let title =
      titleEl && titleEl.value && titleEl.value.trim()
        ? titleEl.value.trim()
        : "QR Stüdyosu çıktısı";

    const expiryEl = document.getElementById("qrExpiryDate");
    const expiryVal = expiryEl && expiryEl.value ? expiryEl.value.trim() : "";
    if (!expiryVal) {
      window.alert("Lütfen geçerlilik bitiş tarihini seçin.");
      if (expiryEl) expiryEl.focus();
      return;
    }

    const aw = getAw();
    if (!aw || !aw.storage || !aw.databases || !aw.isConfigured()) {
      window.alert("Appwrite yapılandırması eksik. js/appwrite-config.mjs dosyasını kontrol edin.");
      return;
    }

    if (!currentQrFileName) {
      assignNewQrFileName();
    }

    setLoading(true, "PDF oluşturuluyor ve yükleniyor…");

    try {
      const pdfBlob = buildPdfBlobFromFabric(fabricCanvas);
      const pdfFile = aw.blobToFile(pdfBlob, currentQrFileName);

      await aw.storage.createFile(
        aw.BUCKET_REPORTS,
        currentQrFileName,
        pdfFile
      );
      const publicUrl = aw.getStorageFileViewUrl(
        aw.BUCKET_REPORTS,
        currentQrFileName
      );

      const insertPayload = {
        title: title,
        companyId: companyId,
        pdfUrl: publicUrl,
        expiryDate: expiryVal,
      };

      await aw.databases.createDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        aw.ID.unique(),
        insertPayload
      );

      const calDates = getQrCalendarDateValues();
      if (typeof window.__3nSaveReportCalendarMarkers === "function") {
        window.__3nSaveReportCalendarMarkers({
          firstDate: calDates.firstDate,
          reminderDate: calDates.reminderDate,
          title: title,
        });
      }

      setLoading(false);
      window.alert(
        "İşlem tamamlandı. PDF kaydedildi ve rapor listesine eklendi.\n\nBir sonraki belge için karekodu yenilemek üzere «Karekodu Yerleştir / Yenile» düğmesine basın (yeni dosya adresi oluşturuldu)."
      );

      assignNewQrFileName();
    } catch (e) {
      setLoading(false);
      window.alert(e && e.message ? e.message : String(e));
    }
  }

  async function loadCompanies() {
    const sel = document.getElementById("qrStudioCompany");
    if (!sel) return;
    sel.innerHTML = '<option value="">Şirket seçin…</option>';

    const aw = getAw();
    if (!aw || !aw.databases || !aw.isConfigured()) {
      window.alert(
        "Appwrite yapılandırması eksik. js/appwrite-config.mjs içinde ID’leri doldurun."
      );
      return;
    }

    try {
      const res = await aw.databases.listDocuments(
        aw.DATABASE_ID,
        aw.COLLECTION_COMPANIES,
        [aw.Query.orderAsc("name"), aw.Query.limit(500)]
      );
      (aw.normalizeDocuments(res.documents || []) || []).forEach(function (row) {
        const opt = document.createElement("option");
        opt.value = row.id;
        opt.textContent = row.name != null ? String(row.name) : "—";
        sel.appendChild(opt);
      });
    } catch (e) {
      window.alert(
        "Şirket listesi yüklenemedi: " + (e && e.message ? e.message : String(e))
      );
    }
  }

  function wireDropZone() {
    const zone = document.getElementById("qrDropZone");
    const input = document.getElementById("qrFileInput");
    if (!zone || !input) return;

    let depth = 0;
    function drag(on) {
      if (on) zone.classList.add("qr-studio-drop--active");
      else zone.classList.remove("qr-studio-drop--active");
    }

    zone.addEventListener("click", function (e) {
      if (e.target !== input) input.click();
    });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener("dragenter", function (e) {
      e.preventDefault();
      depth++;
      drag(true);
    });
    zone.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      drag(true);
    });
    zone.addEventListener("dragleave", function (e) {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) drag(false);
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      depth = 0;
      drag(false);
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    input.addEventListener("change", function () {
      const f = input.files && input.files[0];
      if (f) handleFile(f);
      input.value = "";
    });
  }

  function init() {
    assignNewQrFileName();
    fillDefaultQrReportDates();

    wireDropZone();

    const addBtn = document.getElementById("qrAddBtn");
    const completeBtn = document.getElementById("qrCompleteBtn");
    const saveRepoBtn = document.getElementById("qrSaveToRepoBtn");
    if (addBtn) addBtn.addEventListener("click", addQrToCanvas);
    if (completeBtn) completeBtn.addEventListener("click", completeWorkflow);
    if (saveRepoBtn) saveRepoBtn.addEventListener("click", saveQrToRepository);

    loadCompanies().catch(function (e) {
      window.alert(
        "Şirket listesi yüklenemedi: " + (e && e.message ? e.message : String(e))
      );
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
