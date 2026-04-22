/**
 * 3N Makine — QR Stüdyosu (Fabric + pdf.js önizleme; html2pdf → Blob → Storage → DB pdfUrl)
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
  /** Ekranda gösterilen tuval genişliği (CSS piksel) */
  const MAX_CANVAS_WIDTH = 920;
  /** PDF.js: sayfa raster’ı en az bu kadar geniş (net önizleme + PDF için) */
  const PDF_MIN_RASTER_WIDTH = 1280;
  const PDF_MAX_RASTER_WIDTH = 2000;
  /** html2canvas (Word/Excel HTML → görüntü) */
  const SNAPSHOT_HTML_SCALE = 2.25;
  /** QR kaynak görüntüsü (küçültülünce/büyütülünce okunabilir kalsın) */
  const QR_SOURCE_SIZE = 480;

  /** Storage fileId — QR ile yüklemede aynı kimlik kullanılır */
  let currentQrStorageId = "";
  /** PDF dosya adı (Appwrite File.name) */
  let currentQrDisplayFileName = "";

  let fabricCanvas = null;
  /** @type {fabric.Image | null} */
  let qrFabricImage = null;
  let lastQrDataUrl = "";

  /** pdf.js belgesi (çok sayfalı önizleme) */
  let pdfJsDocument = null;
  let pdfPageCount = 0;
  let pdfCurrentPage = 1;
  /** Karekod hangi PDF sayfasına yerleştirildi (1 tabanlı; çok sayfa dışa aktarım için) */
  let qrOverlayPdfPage = 0;

  /** Şirket seçimi etiketi (boşsa «Belge») */
  function getQrStudioCompanyDisplayName() {
    var sel = document.getElementById("qrStudioCompany");
    if (!sel || sel.selectedIndex < 0) return "Belge";
    var opt = sel.options[sel.selectedIndex];
    if (!opt || !String(opt.value || "").trim()) return "Belge";
    var t = opt.textContent ? opt.textContent.trim() : "Belge";
    return t || "Belge";
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

  function assignNewQrFileName() {
    var aw = getAw();
    currentQrStorageId =
      aw && typeof aw.generateFileId === "function"
        ? aw.generateFileId()
        : aw && typeof aw.newUniqueFileId === "function"
          ? aw.newUniqueFileId()
          : "";
    var firma = sanitizeStorageFileLabel(getQrStudioCompanyDisplayName());
    currentQrDisplayFileName =
      "3N_Makina_Raporu_" + firma + "_" + Date.now() + ".pdf";
  }

  function getPredictedPublicUrl() {
    const aw = getAw();
    if (!aw || !currentQrStorageId) return "";
    return aw.getStorageFileViewUrl(aw.BUCKET_REPORTS, currentQrStorageId);
  }

  function getPdfJs() {
    return typeof pdfjsLib !== "undefined" ? pdfjsLib : null;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function setLoading(visible, message, showProgressBar) {
    const el = document.getElementById("qrLoadingOverlay");
    const msg = document.getElementById("qrLoadingMessage");
    const track = document.getElementById("qrLoadingBarTrack");
    if (msg && message) msg.textContent = message;
    if (track) {
      if (!visible) {
        track.hidden = true;
      } else {
        track.hidden = !showProgressBar;
      }
    }
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? "flex" : "none";
  }

  function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  /**
   * html2pdf çıktısı bazen ArrayBuffer veya boş MIME ile Blob dönebilir.
   */
  function normalizePdfBlobForUpload(pdfOut) {
    if (!pdfOut) return null;
    if (pdfOut instanceof ArrayBuffer) {
      return new Blob([pdfOut], { type: "application/pdf" });
    }
    if (pdfOut instanceof Blob) {
      if (!pdfOut.type || pdfOut.type === "application/octet-stream") {
        return new Blob([pdfOut], { type: "application/pdf" });
      }
      return pdfOut;
    }
    return null;
  }

  /** Appwrite createFile için PDF File (binary; Base64 / DB’ye yazılmaz). */
  function qrStudioPdfFileFromBlob(pdfBlob, displayName) {
    var base =
      displayName && String(displayName).trim()
        ? String(displayName).trim()
        : "3N_Rapor.pdf";
    if (!/\.pdf$/i.test(base)) {
      base += ".pdf";
    }
    return new File([pdfBlob], base, { type: "application/pdf" });
  }

  /**
   * #report-container (Fabric tuvali) → html2pdf → sıkıştırılmış PDF Blob.
   */
  function buildQrPdfBlobHtml2Pdf(displayFilename) {
    return new Promise(function (resolve, reject) {
      if (typeof window.html2pdf !== "function") {
        reject(
          new Error(
            "html2pdf.js yüklenmedi. qr-generator.html içinde html2pdf.bundle sırasını kontrol edin."
          )
        );
        return;
      }
      var el = document.getElementById("report-container");
      if (!el) {
        reject(new Error("report-container bulunamadı."));
        return;
      }
      if (fabricCanvas) {
        try {
          fabricCanvas.requestRenderAll();
        } catch (rErr) {
          /* — */
        }
      }

      var fname =
        displayFilename && String(displayFilename).trim()
          ? String(displayFilename).trim()
          : "3N_Rapor.pdf";
      if (!/\.pdf$/i.test(fname)) {
        fname += ".pdf";
      }

      var opt = {
        margin: 10,
        filename: fname,
        image: { type: "jpeg", quality: 0.8 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        },
        jsPDF: {
          compress: true,
          orientation: "portrait",
          format: "a4",
          unit: "mm",
        },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            window
              .html2pdf()
              .set(opt)
              .from(el)
              .outputPdf("blob")
              .then(function (pdfBlob) {
                var normalized = normalizePdfBlobForUpload(pdfBlob);
                if (!normalized || normalized.size < 64) {
                  reject(
                    new Error(
                      "PDF oluşturulamadı veya dosya boş (html2pdf çıktısı geçersiz)."
                    )
                  );
                  return;
                }
                resolve(normalized);
              })
              .catch(function (h2err) {
                reject(
                  h2err && h2err.message
                    ? h2err
                    : new Error("html2pdf işlemi başarısız oldu.")
                );
              });
          } catch (e) {
            reject(e);
          }
        });
      });
    });
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
    qrOverlayPdfPage = 0;
  }

  function clearPdfSession() {
    pdfJsDocument = null;
    pdfPageCount = 0;
    pdfCurrentPage = 1;
    qrOverlayPdfPage = 0;
    const bar = document.getElementById("qrPdfPageBar");
    if (bar) bar.hidden = true;
  }

  function syncPdfPageUi() {
    const label = document.getElementById("qrPdfPageLabel");
    const inp = document.getElementById("qrPdfPageInput");
    const prev = document.getElementById("qrPdfPagePrev");
    const next = document.getElementById("qrPdfPageNext");
    if (!pdfJsDocument || pdfPageCount < 1) return;
    if (label) {
      label.textContent =
        "Sayfa " + pdfCurrentPage + " / " + pdfPageCount;
    }
    if (inp) {
      inp.min = "1";
      inp.max = String(pdfPageCount);
      inp.value = String(pdfCurrentPage);
    }
    if (prev) prev.disabled = pdfCurrentPage <= 1;
    if (next) next.disabled = pdfCurrentPage >= pdfPageCount;
  }

  /**
   * PDF belgesinin tek bir sayfasını rasterleyip Fabric tuvaline basar.
   * Sayfa değişince QR sıfırlanır (disposeFabric); karekodu yeniden yerleştirin.
   */
  async function renderPdfPageNumber(pageNum, showLoadingOverlay) {
    if (!pdfJsDocument || pdfPageCount < 1) return;
    var n = parseInt(pageNum, 10);
    if (Number.isNaN(n)) n = 1;
    n = Math.max(1, Math.min(pdfPageCount, n));
    pdfCurrentPage = n;
    syncPdfPageUi();

    if (showLoadingOverlay) {
      setLoading(
        true,
        "Sayfa " + n + " / " + pdfPageCount + " yükleniyor…"
      );
    }
    try {
      const page = await pdfJsDocument.getPage(n);
      const baseVp = page.getViewport({ scale: 1 });
      var rasterScale = PDF_MAX_RASTER_WIDTH / baseVp.width;
      if (baseVp.width * rasterScale < PDF_MIN_RASTER_WIDTH) {
        rasterScale = PDF_MIN_RASTER_WIDTH / baseVp.width;
      }
      rasterScale = Math.min(rasterScale, 3.25);
      const viewport = page.getViewport({ scale: rasterScale });

      const tmp = document.createElement("canvas");
      const ctx = tmp.getContext("2d", { alpha: false });
      if (!ctx) {
        throw new Error("Tarayıcı canvas 2D desteklemiyor.");
      }
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) {
        ctx.imageSmoothingQuality = "high";
      }
      tmp.width = Math.floor(viewport.width);
      tmp.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const bgDataUrl = tmp.toDataURL("image/png");
      await openImageDataUrlAsFabricBackground(
        bgDataUrl,
        viewport.width,
        viewport.height
      );
    } finally {
      if (showLoadingOverlay) {
        setLoading(false);
      }
    }
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

  function attachQrStudioFabricHandlers(fc) {
    if (!fc) return;
    fc.on("object:scaling", function (e) {
      var t = e.target;
      if (t && t.name === "qrOverlay") {
        t.setCoords();
        fc.requestRenderAll();
      }
    });
    fc.on("object:modified", function (e) {
      var t = e.target;
      if (t && t.name === "qrOverlay") {
        t.setCoords();
        fc.requestRenderAll();
      }
    });
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
        enableRetinaScaling: true,
      });
      attachQrStudioFabricHandlers(fabricCanvas);

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

    clearPdfSession();

    const dataCopy = new Uint8Array(
      arrayBuffer instanceof ArrayBuffer
        ? arrayBuffer.slice(0)
        : arrayBuffer
    );
    pdfJsDocument = await pdfjs.getDocument({ data: dataCopy }).promise;
    pdfPageCount = pdfJsDocument.numPages || 0;

    const bar = document.getElementById("qrPdfPageBar");
    if (bar) bar.hidden = pdfPageCount < 1;

    pdfCurrentPage = 1;
    syncPdfPageUi();

    await renderPdfPageNumber(1, false);
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
    inner.style.fontSize = "14px";
    inner.style.lineHeight = "1.55";
    inner.style.color = "#0f172a";

    if (typeof html2canvas === "undefined") {
      root.innerHTML = "";
      throw new Error("html2canvas yüklenemedi.");
    }

    const canvas = await html2canvas(inner, {
      scale: SNAPSHOT_HTML_SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      letterRendering: true,
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
    inner.style.width = "1100px";
    inner.style.padding = "24px";
    inner.style.boxSizing = "border-box";
    inner.style.background = "#ffffff";
    inner.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';
    inner.style.fontSize = "13px";
    inner.style.color = "#0f172a";

    if (typeof html2canvas === "undefined") {
      root.innerHTML = "";
      throw new Error("html2canvas yüklenemedi.");
    }

    const canvas = await html2canvas(inner, {
      scale: SNAPSHOT_HTML_SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 1100,
      letterRendering: true,
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

      clearPdfSession();

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
        width: QR_SOURCE_SIZE,
        height: QR_SOURCE_SIZE,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
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
      }, 120);
    });
  }

  async function addQrToCanvas() {
    if (!fabricCanvas) {
      window.alert("Önce bir belge yükleyin.");
      return;
    }

    assignNewQrFileName();

    const aw = getAw();
    if (!aw || !aw.isConfigured()) {
      window.alert(
        "Appwrite yapılandırması eksik. js/appwrite-config.mjs dosyasını kontrol edin."
      );
      return;
    }

    const url = getPredictedPublicUrl().trim();
    if (!url) {
      window.alert(
        "Kalıcı dosya adresi oluşturulamadı. «Karekodu Yerleştir» öncesi Appwrite ve depo kimliğini kontrol edin."
      );
      return;
    }

    let dataUrl;
    try {
      dataUrl = await generateQrDataUrlFromText(url);
    } catch (error) {
      console.error("APPWRITE DETAYLI HATA:", error);
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
          var targetW = Math.min(200, cw * 0.24);
          if (targetW < 96) targetW = 96;
          img.scaleToWidth(targetW);
          img.set({
            left: cw / 2,
            top: ch / 2,
            originX: "center",
            originY: "center",
            cornerSize: 12,
            transparentCorners: false,
            borderColor: "#2563eb",
            cornerColor: "#2563eb",
            name: "qrOverlay",
            /* Önbellek devre dışı: köşeden boyutlandırınce bulanık QR önlenir */
            objectCaching: false,
            lockUniScaling: true,
            centeredScaling: true,
            lockScalingFlip: true,
          });
          fabricCanvas.add(img);
          fabricCanvas.setActiveObject(img);
          img.setCoords();
          fabricCanvas.requestRenderAll();
          qrFabricImage = img;
          qrOverlayPdfPage =
            pdfJsDocument && pdfPageCount > 0 ? pdfCurrentPage : 0;
          resolve();
        },
        { crossOrigin: "anonymous" }
      );
    });
  }

  async function completeWorkflow() {
    if (!fabricCanvas) {
      window.alert("Önce bir belge yükleyin.");
      return;
    }
    if (!qrFabricImage || !lastQrDataUrl) {
      window.alert(
        'Önce «Karekodu Yerleştir / Yenile» ile karekodu tuval üzerine ekleyin.'
      );
      return;
    }

    const companySel = document.getElementById("qrStudioCompany");
    const companyId =
      companySel && companySel.value ? companySel.value.trim() : "";
    if (!companyId) {
      window.alert("Kayıt için lütfen şirket seçin.");
      if (companySel) companySel.focus();
      return;
    }

    const titleEl = document.getElementById("qrReportTitle");
    var reportTitle =
      titleEl && titleEl.value && titleEl.value.trim()
        ? titleEl.value.trim()
        : "QR Stüdyosu çıktısı";
    if (reportTitle.length > 512) {
      reportTitle = reportTitle.slice(0, 509) + "…";
    }

    const expiryEl = document.getElementById("qrExpiryDate");
    const expiryVal =
      expiryEl && expiryEl.value ? expiryEl.value.trim() : "";
    if (!expiryVal) {
      window.alert("Lütfen geçerlilik bitiş tarihini seçin.");
      if (expiryEl) expiryEl.focus();
      return;
    }

    const aw = getAw();
    if (!aw || !aw.storage || !aw.databases || !aw.isConfigured()) {
      window.alert(
        "Appwrite yapılandırması eksik. js/appwrite-config.mjs dosyasını kontrol edin."
      );
      return;
    }

    if (!currentQrStorageId) {
      window.alert(
        "Depo dosya kimliği yok. «Karekodu Yerleştir / Yenile» ile yeniden deneyin."
      );
      return;
    }
    if (
      aw.isValidStorageFileId &&
      !aw.isValidStorageFileId(currentQrStorageId)
    ) {
      window.alert("Geçersiz depo dosya kimliği. Karekodu yenileyin.");
      return;
    }

    setLoading(true, "PDF sıkıştırılıyor ve yükleniyor…", true);

    try {
      var WORKFLOW_MS = 240000;
      await Promise.race([
        (async function () {
          let workflowPdfBlob = null;
          let workflowPdfFile = null;
          try {
            const storageApi = aw.storage;
            if (!storageApi || typeof storageApi.createFile !== "function") {
              throw new Error(
                "aw.storage.createFile yok — appwrite-config.mjs ve CDN sırasını kontrol edin."
              );
            }

            workflowPdfBlob = await buildQrPdfBlobHtml2Pdf(
              currentQrDisplayFileName
            );
            if (
              !workflowPdfBlob ||
              !(workflowPdfBlob instanceof Blob) ||
              workflowPdfBlob.size < 64
            ) {
              throw new Error("PDF oluşturulamadı veya boş.");
            }
            workflowPdfFile = qrStudioPdfFileFromBlob(
              workflowPdfBlob,
              currentQrDisplayFileName
            );

            var bucketId = aw.BUCKET_REPORTS;
            var perms = aw.storageFilePermissionsReadAny;
            var fileIdForUpload = currentQrStorageId;

            function oneUpload() {
              return perms && perms.length
                ? storageApi.createFile(
                    bucketId,
                    fileIdForUpload,
                    workflowPdfFile,
                    perms
                  )
                : storageApi.createFile(
                    bucketId,
                    fileIdForUpload,
                    workflowPdfFile
                  );
            }

            var uploadResult;
            try {
              uploadResult = await oneUpload();
            } catch (up1) {
              var msg1 = up1 && up1.message ? String(up1.message) : "";
              if (
                msg1.indexOf("fetch") !== -1 ||
                msg1.indexOf("Failed to fetch") !== -1 ||
                msg1.indexOf("network") !== -1 ||
                msg1.indexOf("QUIC") !== -1 ||
                msg1.indexOf("HTTP2") !== -1
              ) {
                await new Promise(function (r) {
                  setTimeout(r, 1200);
                });
                uploadResult = await oneUpload();
              } else {
                throw up1;
              }
            }

            const publicUrl = aw.pdfViewUrlFromUploadResult(
              bucketId,
              uploadResult
            );
            if (!publicUrl) {
              throw new Error(
                "Yükleme yanıtında geçerli dosya kimliği ($id) yok; Storage URL oluşturulamadı."
              );
            }

            if (typeof aw.assertReportPdfUrlIsStorageLinkOnly === "function") {
              aw.assertReportPdfUrlIsStorageLinkOnly(publicUrl);
            }

            const insertPayload = {
              title: reportTitle,
              companyId: companyId,
              pdfUrl: publicUrl,
              expiryDate: expiryVal,
            };

            function runCreate() {
              return aw.databases.createDocument(
                aw.DATABASE_ID,
                aw.COLLECTION_REPORTS,
                aw.newUniqueFileId(),
                insertPayload
              );
            }

            if (typeof aw.withNetworkRetry === "function") {
              await aw.withNetworkRetry(runCreate, {
                attempts: 4,
                baseDelayMs: 450,
              });
            } else {
              await runCreate();
            }

            const calDates = getQrCalendarDateValues();
            const calTitle =
              titleEl && titleEl.value && titleEl.value.trim()
                ? titleEl.value.trim()
                : "QR Stüdyosu";
            if (typeof window.__3nSaveReportCalendarMarkers === "function") {
              window.__3nSaveReportCalendarMarkers({
                firstDate: calDates.firstDate,
                reminderDate: calDates.reminderDate,
                title: calTitle,
              });
            }

            assignNewQrFileName();

            window.alert(
              "Rapor Deposu'na kaydedildi. PDF Appwrite Storage'da; listede dosya bağlantısı görünür.\n\nYeni belge için «Karekodu Yerleştir / Yenile» ile yeni depo adresi oluşturun."
            );
          } finally {
            workflowPdfBlob = null;
            workflowPdfFile = null;
          }
        })(),
        new Promise(function (_, rej) {
          setTimeout(function () {
            rej(
              new Error(
                "İşlem zaman aşımına uğradı (4 dk). PDF çok büyük veya ağ kesilmiş olabilir."
              )
            );
          }, WORKFLOW_MS);
        }),
      ]);
    } catch (error) {
      console.error("APPWRITE DETAYLI HATA:", error);
      window.alert(
        (error && error.message ? error.message : String(error)) +
          "\n\nPDF oluşturma, yükleme veya veritabanı kaydı başarısız. Ağ ve Appwrite izinlerini kontrol edin."
      );
    } finally {
      setLoading(false);
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
      const res = await (aw.withNetworkRetry
        ? aw.withNetworkRetry(
            function () {
              return aw.databases.listDocuments(
                aw.DATABASE_ID,
                aw.COLLECTION_COMPANIES,
                [aw.Query.orderAsc("name"), aw.Query.limit(500)]
              );
            },
            { attempts: 4, baseDelayMs: 500 }
          )
        : aw.databases.listDocuments(
            aw.DATABASE_ID,
            aw.COLLECTION_COMPANIES,
            [aw.Query.orderAsc("name"), aw.Query.limit(500)]
          ));
      (aw.normalizeDocuments(res.documents || []) || []).forEach(function (row) {
        const opt = document.createElement("option");
        opt.value = row.id;
        opt.textContent = row.name != null ? String(row.name) : "—";
        sel.appendChild(opt);
      });
    } catch (error) {
      console.error("APPWRITE DETAYLI HATA:", error);
      window.alert(
        "Şirket listesi yüklenemedi: " +
          (error && error.message ? error.message : String(error)) +
          "\n\nGeçici ağ hatası olabilir: sayfayı yenileyin; Opera GX’te Chrome deneyin; reklam engelleyiciyi kapatın. Appwrite’da bu site için Web platformu (mustafaakbas21.github.io) tanımlı olmalı."
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

  function wirePdfPageControls() {
    const prev = document.getElementById("qrPdfPagePrev");
    const next = document.getElementById("qrPdfPageNext");
    const inp = document.getElementById("qrPdfPageInput");

    function reportPdfNavError(err) {
      window.alert(err && err.message ? err.message : String(err));
    }

    if (prev) {
      prev.addEventListener("click", function () {
        if (pdfCurrentPage > 1) {
          renderPdfPageNumber(pdfCurrentPage - 1, true).catch(reportPdfNavError);
        }
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        if (pdfCurrentPage < pdfPageCount) {
          renderPdfPageNumber(pdfCurrentPage + 1, true).catch(reportPdfNavError);
        }
      });
    }
    if (inp) {
      function goToInputPage() {
        var v = parseInt(String(inp.value || "1"), 10);
        renderPdfPageNumber(v, true).catch(reportPdfNavError);
      }
      inp.addEventListener("change", goToInputPage);
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          goToInputPage();
        }
      });
    }
  }

  function init() {
    assignNewQrFileName();
    fillDefaultQrReportDates();

    wireDropZone();
    wirePdfPageControls();

    const addBtn = document.getElementById("qrAddBtn");
    const completeBtn = document.getElementById("qrCompleteBtn");
    if (addBtn) addBtn.addEventListener("click", addQrToCanvas);
    if (completeBtn) completeBtn.addEventListener("click", completeWorkflow);

    loadCompanies().catch(function (error) {
      console.error("APPWRITE DETAYLI HATA:", error);
      window.alert(
        "Şirket listesi yüklenemedi: " +
          (error && error.message ? error.message : String(error))
      );
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
