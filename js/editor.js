/**
 * 3N Makine — Rapor editörü
 * Fabric.js tuval + Appwrite (şirket listesi, Storage, DB) + jsPDF + QRCode
 *
 * Önkoşullar (create-report.html sırasıyla):
 * - appwrite (npm) + appwrite-config.mjs, fabric.js, jspdf.umd, qrcode.min.js, editor.js
 * - Inter fontu, #reportCanvas ve ilgili buton / form id'leri
 *
 * Appwrite Client / ID sabitleri: js/appwrite-config.mjs → window.__3nAppwrite
 */

(function () {
  "use strict";

function getAw() {
  return typeof window.__3nAppwrite !== "undefined" && window.__3nAppwrite
    ? window.__3nAppwrite
    : null;
}

/** Appwrite koleksiyonuna gönderilen attribute adları (camelCase) */
const REPORT_DB_COLUMNS = {
  title: "title",
  companyId: "companyId",
  pdfUrl: "pdfUrl",
  expiryDate: "expiryDate",
};

/**
 * Bu oturumdaki bir sonraki yüklemede kullanılacak dosya adı (örn. 1702581234567.pdf).
 * QR kod, yükleme öncesi bu adla getFileView ile hesaplanan görüntüleme URL’sini içerir.
 */
let currentReportFileName = "";

/**
 * Yeni benzersiz dosya adı üretir (tahmini URL ile uyum için kayıt/yenileme noktalarında çağrılır).
 */
function assignNewReportFileName() {
  currentReportFileName = Date.now() + ".pdf";
}

/**
 * currentReportFileName için Appwrite Storage görüntüleme URL’si (yüklemeden önce tahmin).
 * Gerçek yükleme sonrası URL ile aynı olmalıdır.
 */
function getPredictedPublicUrlForCurrentReport() {
  const aw = getAw();
  if (!aw || !currentReportFileName) return "";
  return aw.getStorageFileViewUrl(aw.BUCKET_REPORT_PDFS, currentReportFileName);
}

/** Son başarılı kayıttan sonra modal aksiyonları (indir / WhatsApp) */
let lastReportPdfDoc = null;
let lastReportPdfUrl = null;

// -----------------------------------------------------------------------------
// Tuval sabitleri
// -----------------------------------------------------------------------------
const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 1680;
const BG_COLOR = "#ffffff";

/** Tuval JSON’unda korunacak özel alanlar (geri al / ileri al) */
const HISTORY_INCLUDE = ["checkRowId", "checkKind", "reportQr"];

let canvas = null;

/** Periyodik kontrol tablosu: satır → { u, ud, nu } işaret metinleri (✓) */
let checklistMarkRegistry = [];

let historySuspended = false;
let canvasHistoryStack = [];
let canvasHistoryPosition = -1;
const CANVAS_HISTORY_LIMIT = 35;
let historyDebounceTimer = null;

function rebuildChecklistRegistry() {
  checklistMarkRegistry = [];
  if (!canvas) return;
  canvas.forEachObject(function (o) {
    if (!o || o.checkRowId == null || !o.checkKind) return;
    if (o.type !== "text") return;
    const r = o.checkRowId;
    const k = o.checkKind;
    if (!checklistMarkRegistry[r]) {
      checklistMarkRegistry[r] = { u: null, ud: null, nu: null };
    }
    if (k === "u") checklistMarkRegistry[r].u = o;
    else if (k === "ud") checklistMarkRegistry[r].ud = o;
    else if (k === "nu") checklistMarkRegistry[r].nu = o;
  });
}

function canvasSnapshotJson() {
  return JSON.stringify(canvas.toJSON(HISTORY_INCLUDE));
}

function canvasHistoryResetToCurrent() {
  if (!canvas) return;
  historySuspended = true;
  canvasHistoryStack = [canvasSnapshotJson()];
  canvasHistoryPosition = 0;
  historySuspended = false;
}

function canvasHistoryPushImmediate() {
  if (historySuspended || !canvas) return;
  const snap = canvasSnapshotJson();
  canvasHistoryStack = canvasHistoryStack.slice(0, canvasHistoryPosition + 1);
  if (
    canvasHistoryStack.length &&
    canvasHistoryStack[canvasHistoryStack.length - 1] === snap
  ) {
    return;
  }
  canvasHistoryStack.push(snap);
  canvasHistoryPosition = canvasHistoryStack.length - 1;
  while (canvasHistoryStack.length > CANVAS_HISTORY_LIMIT) {
    canvasHistoryStack.shift();
    canvasHistoryPosition--;
  }
}

function scheduleHistoryPush() {
  if (historySuspended || !canvas) return;
  clearTimeout(historyDebounceTimer);
  historyDebounceTimer = setTimeout(function () {
    historyDebounceTimer = null;
    canvasHistoryPushImmediate();
  }, 420);
}

function canvasHistoryApplySnapshot(jsonStr) {
  historySuspended = true;
  canvas.loadFromJSON(JSON.parse(jsonStr), function () {
    canvas.renderAll();
    rebuildChecklistRegistry();
    historySuspended = false;
  });
}

function canvasHistoryUndo() {
  if (!canvas || canvasHistoryPosition <= 0) return;
  canvasHistoryPosition--;
  canvasHistoryApplySnapshot(canvasHistoryStack[canvasHistoryPosition]);
}

function canvasHistoryRedo() {
  if (
    !canvas ||
    canvasHistoryPosition >= canvasHistoryStack.length - 1
  ) {
    return;
  }
  canvasHistoryPosition++;
  canvasHistoryApplySnapshot(canvasHistoryStack[canvasHistoryPosition]);
}

function wireCanvasHistory() {
  if (!canvas || canvas.__historyWired) return;
  canvas.__historyWired = true;
  canvas.on("object:modified", scheduleHistoryPush);
  canvas.on("text:changed", scheduleHistoryPush);
  canvas.on("object:added", function () {
    if (historySuspended) return;
    scheduleHistoryPush();
  });
  canvas.on("object:removed", function () {
    if (historySuspended) return;
    scheduleHistoryPush();
  });
}

function wireCanvasUndoRedoKeys() {
  if (document.__3nUndoRedoKeys) return;
  document.__3nUndoRedoKeys = true;
  document.addEventListener(
    "keydown",
    function (e) {
      if (!canvas) return;
      const tag = (e.target && e.target.tagName) || "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          if (e.shiftKey) {
            e.preventDefault();
            canvasHistoryRedo();
          } else {
            e.preventDefault();
            canvasHistoryUndo();
          }
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          canvasHistoryRedo();
        }
      }
    },
    true
  );
}

/** GENEL KONTROLLER maddeleri (Excel benzeri satırlar) */
const PERIODIC_CHECKLIST_ITEMS = [
  "Projeye / projelendirilmiş sisteme uygunluk",
  "Filtre yerleşimi, bakımı ve değişim kayıtları",
  "Fan / aspiratör ve yardımcı donanımlar",
  "Hava ısıtıcı ve soğutucu birimler",
  "Nemlendirme sistemleri",
  "Hava işleme üniteleri (AHU / Klima santrali)",
  "Periyodik bakım ve kontrol kayıtları",
  "Kanal bağlantıları ve sızdırmazlık",
  "Filtre temizliği / tıkanıklık kontrolü",
  "Hava hızı / debi ölçümleri",
  "Gürültü seviyesi (gerekli ise)",
  "İşletme talimatı ve uyarı levhaları",
];

function getCanvasCenter() {
  return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
}

function initCanvas() {
  const el = document.getElementById("reportCanvas");
  if (!el) {
    return null;
  }
  if (typeof fabric === "undefined") {
    return null;
  }
  return new fabric.Canvas("reportCanvas", {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: BG_COLOR,
    preserveObjectStacking: true,
  });
}

function addTextAtCenter() {
  const center = getCanvasCenter();
  const text = new fabric.IText("Metni düzenleyin", {
    left: center.x,
    top: center.y,
    originX: "center",
    originY: "center",
    fill: "#000000",
    fontFamily: "Inter, sans-serif",
    fontSize: 24,
    fontWeight: "400",
  });
  canvas.add(text);
  canvas.setActiveObject(text);
  canvas.renderAll();
}

function addLineAtCenter() {
  const center = getCanvasCenter();
  const halfLen = 160;
  const line = new fabric.Line(
    [center.x - halfLen, center.y, center.x + halfLen, center.y],
    { stroke: "#000000", strokeWidth: 2, selectable: true }
  );
  canvas.add(line);
  canvas.setActiveObject(line);
  canvas.renderAll();
}

function addRectAtCenter() {
  const center = getCanvasCenter();
  const rect = new fabric.Rect({
    left: center.x,
    top: center.y,
    width: 220,
    height: 120,
    fill: "transparent",
    stroke: "#000000",
    strokeWidth: 2,
    originX: "center",
    originY: "center",
  });
  canvas.add(rect);
  canvas.setActiveObject(rect);
  canvas.renderAll();
}

function deleteSelectedObjects() {
  const active = canvas.getActiveObject();
  if (!active) return;
  if (active.type === "activeSelection") {
    active.getObjects().slice().forEach(function (obj) {
      canvas.remove(obj);
    });
    canvas.discardActiveObject();
  } else {
    canvas.remove(active);
    canvas.discardActiveObject();
  }
  canvas.renderAll();
}

function clearWholeCanvas() {
  const ok = window.confirm(
    "Tüm tuval içeriğini silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
  );
  if (!ok) return;
  resetCanvasNoConfirm();
  checklistMarkRegistry = [];
  rebuildChecklistRegistry();
  canvasHistoryResetToCurrent();
}

/** Onay olmadan tuvali boşaltır (şablon geçişleri için) */
function resetCanvasNoConfirm() {
  if (!canvas) return;
  canvas.clear();
  canvas.setWidth(CANVAS_WIDTH);
  canvas.setHeight(CANVAS_HEIGHT);
  canvas.backgroundColor = BG_COLOR;
  canvas.renderAll();
  assignNewReportFileName();
}

// -----------------------------------------------------------------------------
// Rapor şablonları (Fabric)
// -----------------------------------------------------------------------------

const TEMPLATE_VENTILATION = "ventilation";
const TEMPLATE_BLANK = "blank";

/**
 * Excel benzeri kontrol hücresi: üstte görünmez hit alanı (tıklama), altta ✓ metni.
 */
function addCheckCell(left, top, w, h, rowId, kind) {
  const mark = new fabric.Text("", {
    left: left + w / 2,
    top: top + h / 2,
    originX: "center",
    originY: "center",
    fontFamily: "Inter, sans-serif",
    fontSize: 12,
    fontWeight: "bold",
    fill: "#0f172a",
    selectable: false,
    evented: false,
  });
  const hit = new fabric.Rect({
    left: left,
    top: top,
    width: w,
    height: h,
    fill: "rgba(59,130,246,0.06)",
    stroke: "#94a3b8",
    strokeWidth: 0.65,
    hoverCursor: "pointer",
    selectable: true,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  });
  hit.checkRowId = rowId;
  hit.checkKind = kind;
  mark.checkRowId = rowId;
  mark.checkKind = kind;
  canvas.add(mark);
  canvas.add(hit);
  return { mark: mark, hit: hit };
}

/**
 * GENEL KONTROLLER tablosu: çizgiler + tıklanabilir U / U.D. / N.U. (satır başına tek seçim).
 * @returns {number} Tablonun altındaki y
 */
function drawPeriodicChecklistGrid(left, topY, totalWidth) {
  const colNo = 22;
  const colU = 26;
  const colUD = 26;
  const colNU = 26;
  const colAcik = 118;
  const colDesc =
    totalWidth - colNo - colU - colUD - colNU - colAcik - 6;
  const headerH = 22;
  const rowH = 21;
  const n = PERIODIC_CHECKLIST_ITEMS.length;
  const tableH = headerH + n * rowH;

  const border = new fabric.Rect({
    left: left,
    top: topY,
    width: totalWidth,
    height: tableH,
    fill: "transparent",
    stroke: "#0f172a",
    strokeWidth: 1,
    selectable: false,
    evented: false,
  });
  canvas.add(border);

  const splits = [
    colNo,
    colDesc,
    colU,
    colUD,
    colNU,
    colAcik,
  ];

  for (let r = 1; r <= n; r++) {
    const ly = topY + headerH + r * rowH;
    canvas.add(
      new fabric.Line([left, ly, left + totalWidth, ly], {
        stroke: "#64748b",
        strokeWidth: 0.55,
        selectable: false,
        evented: false,
      })
    );
  }

  let vx = left;
  for (let c = 0; c < splits.length - 1; c++) {
    vx += splits[c];
    canvas.add(
      new fabric.Line([vx, topY, vx, topY + tableH], {
        stroke: "#64748b",
        strokeWidth: c === 0 ? 0.8 : 0.55,
        selectable: false,
        evented: false,
      })
    );
  }

  const headLabels = [
    { t: "No", x: left + 4, w: colNo },
    { t: "GENEL KONTROLLER", x: left + colNo + 3, w: colDesc },
    { t: "U", x: left + colNo + colDesc + 5, w: colU },
    { t: "U.D.", x: left + colNo + colDesc + colU + 2, w: colUD },
    { t: "N.U.", x: left + colNo + colDesc + colU + colUD + 2, w: colNU },
    { t: "AÇIKLAMALAR", x: left + colNo + colDesc + colU + colUD + colNU + 3, w: colAcik },
  ];
  headLabels.forEach(function (h) {
    canvas.add(
      new fabric.IText(h.t, {
        left: h.x,
        top: topY + 4,
        fontFamily: "Inter, sans-serif",
        fontSize: 6.5,
        fontWeight: "bold",
        fill: "#0f172a",
        width: Math.max(40, h.w - 2),
      })
    );
  });

  for (let i = 0; i < n; i++) {
    const rowTop = topY + headerH + i * rowH;
    const rowId = i;
    checklistMarkRegistry[rowId] = { u: null, ud: null, nu: null };

    canvas.add(
      new fabric.IText(String(i + 1), {
        left: left + 6,
        top: rowTop + 4,
        fontFamily: "Inter, sans-serif",
        fontSize: 6.5,
        fill: "#334155",
        width: colNo - 4,
      })
    );

    canvas.add(
      new fabric.IText(PERIODIC_CHECKLIST_ITEMS[i], {
        left: left + colNo + 2,
        top: rowTop + 3,
        fontFamily: "Inter, sans-serif",
        fontSize: 6.2,
        fill: "#1e293b",
        width: colDesc - 4,
      })
    );

    const cU = addCheckCell(
      left + colNo + colDesc,
      rowTop,
      colU,
      rowH,
      rowId,
      "u"
    );
    const cUD = addCheckCell(
      left + colNo + colDesc + colU,
      rowTop,
      colUD,
      rowH,
      rowId,
      "ud"
    );
    const cNU = addCheckCell(
      left + colNo + colDesc + colU + colUD,
      rowTop,
      colNU,
      rowH,
      rowId,
      "nu"
    );
    checklistMarkRegistry[rowId].u = cU.mark;
    checklistMarkRegistry[rowId].ud = cUD.mark;
    checklistMarkRegistry[rowId].nu = cNU.mark;

    canvas.add(
      new fabric.IText("", {
        left: left + colNo + colDesc + colU + colUD + colNU + 2,
        top: rowTop + 3,
        fontFamily: "Inter, sans-serif",
        fontSize: 6.5,
        fill: "#334155",
        width: colAcik - 4,
      })
    );
  }

  return topY + tableH;
}

function onChecklistCellMouseDown(opt) {
  if (!canvas) return;
  const t = opt.target;
  if (!t || t.checkRowId == null || !t.checkKind) return;
  let row = checklistMarkRegistry[t.checkRowId];
  if (!row || !row.u) {
    rebuildChecklistRegistry();
    row = checklistMarkRegistry[t.checkRowId];
  }
  if (!row || !row.u) return;
  row.u.set("text", "");
  row.ud.set("text", "");
  row.nu.set("text", "");
  if (t.checkKind === "u") row.u.set("text", "✓");
  else if (t.checkKind === "ud") row.ud.set("text", "✓");
  else if (t.checkKind === "nu") row.nu.set("text", "✓");
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  if (!historySuspended) {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = null;
    canvasHistoryPushImmediate();
  }
}

/**
 * Havalandırma ve iklimlendirme — periyodik kontrol raporu (profesyonel şablon).
 */
function applyVentilationTemplate() {
  if (!canvas) return;
  historySuspended = true;
  resetCanvasNoConfirm();
  checklistMarkRegistry = [];

  const M = 14;
  let y = 10;
  const W = CANVAS_WIDTH - 2 * M;

  canvas.add(
    new fabric.IText("3N MÜHENDİSLİK", {
      left: M,
      top: y,
      fontFamily: "Inter, sans-serif",
      fontSize: 9,
      fontWeight: "bold",
      fill: "#1d4ed8",
      width: 220,
    })
  );

  const badge = new fabric.Rect({
    left: CANVAS_WIDTH - M - 118,
    top: y - 2,
    width: 118,
    height: 36,
    fill: "#1e40af",
    stroke: "#b91c1c",
    strokeWidth: 2,
    rx: 3,
    ry: 3,
    selectable: false,
    evented: false,
  });
  canvas.add(badge);
  canvas.add(
    new fabric.IText("PERIODICAL\nINSPECTION", {
      left: CANVAS_WIDTH - M - 59,
      top: y + 4,
      originX: "center",
      fontFamily: "Inter, sans-serif",
      fontSize: 6,
      fontWeight: "bold",
      fill: "#ffffff",
      textAlign: "center",
      lineHeight: 1.15,
      width: 104,
    })
  );

  const mainTitle = new fabric.Textbox(
    "Havalandırma Ve İklimlendirme Sistemleri Periyodik Kontrol Raporu",
    {
      left: CANVAS_WIDTH / 2,
      top: y,
      originX: "center",
      originY: "top",
      width: W - 130,
      fontFamily: "Inter, sans-serif",
      fontSize: 9.5,
      fontWeight: "bold",
      fill: "#0f172a",
      textAlign: "center",
      selectable: true,
      evented: true,
    }
  );
  canvas.add(mainTitle);
  if (typeof mainTitle.initDimensions === "function") {
    mainTitle.initDimensions();
  }
  y += Math.ceil(mainTitle.getScaledHeight()) + 10;

  canvas.add(
    new fabric.Line([M, y, M + W, y], {
      stroke: "#cbd5e1",
      strokeWidth: 1,
      selectable: false,
      evented: false,
    })
  );
  y += 8;

  canvas.add(
    new fabric.IText("Rapor No: ", {
      left: M,
      top: y,
      fontFamily: "Inter, sans-serif",
      fontSize: 7.5,
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Rapor Tarihi: ", {
      left: M + W * 0.5,
      top: y,
      fontFamily: "Inter, sans-serif",
      fontSize: 7.5,
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 22;

  function bandHeader(txt) {
    canvas.add(
      new fabric.Rect({
        left: M,
        top: y,
        width: W,
        height: 16,
        fill: "#f1f5f9",
        stroke: "#cbd5e1",
        strokeWidth: 0.8,
        selectable: false,
        evented: false,
      })
    );
    canvas.add(
      new fabric.IText(txt, {
        left: M + 6,
        top: y + 2,
        fontFamily: "Inter, sans-serif",
        fontSize: 7,
        fontWeight: "bold",
        fill: "#0f172a",
        width: W - 12,
      })
    );
    y += 18;
  }

  bandHeader("MÜŞTERİ BİLGİLERİ");
  canvas.add(
    new fabric.IText("Unvan: ", {
      left: M + 4,
      top: y,
      fontSize: 7.2,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W - 8,
    })
  );
  y += 18;
  canvas.add(
    new fabric.IText("Adres: ", {
      left: M + 4,
      top: y,
      fontSize: 7.2,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W - 8,
    })
  );
  y += 18;
  canvas.add(
    new fabric.IText("SGK No: ", {
      left: M + 4,
      top: y,
      fontSize: 7.2,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("İSG-KATİP Sözleşme ID: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 7.2,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 22;

  bandHeader("GÖZETİM / DENETİM BİLGİLERİ");
  canvas.add(
    new fabric.IText("Gözetim Tarihi: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.31,
    })
  );
  canvas.add(
    new fabric.IText("Gözetim Yeri: ", {
      left: M + W * 0.33,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.31,
    })
  );
  canvas.add(
    new fabric.IText("Sonraki Gözetim: ", {
      left: M + W * 0.65,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.33,
    })
  );
  y += 18;
  canvas.add(
    new fabric.IText("Başlangıç Saati: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.31,
    })
  );
  canvas.add(
    new fabric.IText("Bitiş Saati: ", {
      left: M + W * 0.33,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.31,
    })
  );
  canvas.add(
    new fabric.IText("Gözetim Süresi: ", {
      left: M + W * 0.65,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.33,
    })
  );
  y += 18;
  canvas.add(
    new fabric.IText(
      "İlgili Mevzuat / Standartlar: (6331, İş Ekipmanı Yönetmeliği, TS EN vb.) ",
      {
        left: M + 4,
        top: y,
        fontSize: 6.5,
        fontFamily: "Inter, sans-serif",
        fill: "#334155",
        width: W - 8,
      }
    )
  );
  y += 28;

  bandHeader("TEKNİK ÖZELLİKLER");
  canvas.add(
    new fabric.IText("Tipi / Cinsi: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Kapasite: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 17;
  canvas.add(
    new fabric.IText("Marka / Üretici: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Voltaj: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 17;
  canvas.add(
    new fabric.IText("İmalat Yılı / Seri No: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Motor Gücü: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 17;
  canvas.add(
    new fabric.IText("Bölüm / Konum: ", {
      left: M + 4,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Ölçüm Cihazları: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 6.8,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 24;

  canvas.add(
    new fabric.IText(
      "U: UYGUN   U.D.: UYGUN DEĞİL   N.U.: NUMUNEYE UYGULANAMAZ — Hücrelere tıklayarak işaretleyin.",
      {
        left: M,
        top: y,
        fontFamily: "Inter, sans-serif",
        fontSize: 6,
        fill: "#64748b",
        fontStyle: "italic",
        width: W,
      }
    )
  );
  y += 14;

  y = drawPeriodicChecklistGrid(M, y, W);
  y += 12;

  bandHeader("İKAZ VE ÖNERİLER");
  canvas.add(
    new fabric.IText("Uygunsuzluk / öneri metni: ", {
      left: M + 4,
      top: y,
      fontSize: 7,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W - 8,
    })
  );
  y += 36;

  canvas.add(
    new fabric.IText(
      "SONUÇ: Tesis edilen ekipmanın teknik incelemesi yapılmış olup, 1 (bir) yıl süreyle emniyetli kullanımına engel bir durum tespit edilmemiştir.",
      {
        left: M,
        top: y,
        fontFamily: "Inter, sans-serif",
        fontSize: 7,
        fontWeight: "bold",
        fill: "#0f172a",
        width: W - 128,
      }
    )
  );
  y += 36;

  bandHeader("KONTROLÜ YAPAN VE ONAYLAYAN");
  canvas.add(
    new fabric.IText("Ad Soyad: ", {
      left: M + 4,
      top: y,
      fontSize: 7,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  canvas.add(
    new fabric.IText("Ünvan: ", {
      left: M + W * 0.5,
      top: y,
      fontSize: 7,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W * 0.48,
    })
  );
  y += 18;
  canvas.add(
    new fabric.IText("Oda Sicil / Diploma No: ", {
      left: M + 4,
      top: y,
      fontSize: 7,
      fontFamily: "Inter, sans-serif",
      fill: "#334155",
      width: W - 8,
    })
  );
  y += 20;
  canvas.add(
    new fabric.Line([M + 4, y, M + 220, y], {
      stroke: "#0f172a",
      strokeWidth: 0.8,
      selectable: false,
      evented: false,
    })
  );
  canvas.add(
    new fabric.IText("İmza / Kaşe", {
      left: M + 4,
      top: y + 4,
      fontSize: 6.5,
      fontFamily: "Inter, sans-serif",
      fill: "#94a3b8",
      width: 200,
    })
  );
  y += 28;

  canvas.add(
    new fabric.IText(
      "* Önemli uygunsuzluk halinde ilgili satır açıklama sütununda detaylandırılmalıdır.",
      {
        left: M,
        top: y,
        fontFamily: "Inter, sans-serif",
        fontSize: 5.8,
        fill: "#64748b",
        width: W,
      }
    )
  );

  canvas.renderAll();
  rebuildChecklistRegistry();
  historySuspended = false;
  canvasHistoryResetToCurrent();
}

/**
 * Önceden tahmin edilen kesin public PDF URL’si ile tuval üzerine sürüklenebilir QR ekler
 * (dosya adı currentReportFileName; kayıtta aynı ad kullanılır).
 */
function generateQrOnCanvas() {
  if (!canvas) return;
  if (typeof QRCode === "undefined") {
    window.alert("QR kütüphanesi yüklenemedi. Sayfayı yenileyin.");
    return;
  }

  const url = getPredictedPublicUrlForCurrentReport().trim();
  if (!url) {
    window.alert(
      "QR için dosya görüntüleme URL’si hesaplanamadı. Appwrite (appwrite-config.mjs) ve Storage bucket yapılandırılmış olmalıdır."
    );
    return;
  }

  canvas.getObjects().forEach(function (o) {
    if (o && o.reportQr) {
      canvas.remove(o);
    }
  });

  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.style.top = "0";
  document.body.appendChild(holder);

  try {
    new QRCode(holder, {
      text: url,
      width: 128,
      height: 128,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    document.body.removeChild(holder);
    window.alert("QR oluşturulamadı.");
    return;
  }

  function finishQrDataUrl(dataUrl) {
    if (holder.parentNode) {
      document.body.removeChild(holder);
    }
    if (!dataUrl) {
      window.alert("QR görüntüsü alınamadı.");
      return;
    }
    fabric.Image.fromURL(
      dataUrl,
      function (img) {
        if (!canvas) return;
        img.scaleToWidth(104);
        img.set({
          left: CANVAS_WIDTH - 116,
          top: CANVAS_HEIGHT - 124,
          cornerSize: 6,
          name: "reportQrImage",
        });
        img.reportQr = true;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        if (!historySuspended) {
          clearTimeout(historyDebounceTimer);
          historyDebounceTimer = null;
          canvasHistoryPushImmediate();
        }
      },
      { crossOrigin: "anonymous" }
    );
  }

  setTimeout(function () {
    const c = holder.querySelector("canvas");
    const im = holder.querySelector("img");
    if (c) {
      finishQrDataUrl(c.toDataURL("image/png"));
    } else if (im && im.complete && im.src) {
      finishQrDataUrl(im.src);
    } else if (im) {
      im.onload = function () {
        finishQrDataUrl(im.src);
      };
    } else {
      if (holder.parentNode) {
        document.body.removeChild(holder);
      }
      window.alert("QR oluşturulamadı.");
    }
  }, 120);
}

function wireTemplateSelect() {
  const sel = document.getElementById("templateSelect");
  if (!sel) return;

  sel.addEventListener("change", function () {
    const v = sel.value;
    if (v === TEMPLATE_VENTILATION) {
      applyVentilationTemplate();
    } else if (v === TEMPLATE_BLANK) {
      historySuspended = true;
      resetCanvasNoConfirm();
      checklistMarkRegistry = [];
      rebuildChecklistRegistry();
      historySuspended = false;
      canvasHistoryResetToCurrent();
    }
  });
}

// -----------------------------------------------------------------------------
// Şirket listesi (Appwrite)
// -----------------------------------------------------------------------------

/**
 * Companies koleksiyonundan kayıtları çekerek #companySelect doldurur.
 */
async function loadCompaniesIntoSelect() {
  const sel = document.getElementById("companySelect");
  if (!sel) return;

  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Şirket Seçin...";
  sel.appendChild(placeholder);

  const aw = getAw();
  if (!aw || !aw.databases || !aw.isConfigured()) {
    window.alert(
      "Appwrite yapılandırması eksik. js/appwrite-config.mjs içinde koleksiyon ve bucket ID’lerini doldurun."
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
      opt.textContent = row.name != null ? String(row.name) : "İsimsiz şirket";
      const ph =
        row.phone != null
          ? String(row.phone)
          : row.Phone != null
            ? String(row.Phone)
            : "";
      opt.setAttribute("data-phone", ph);
      sel.appendChild(opt);
    });
  } catch (err) {
    window.alert(
      "Şirket listesi yüklenemedi. Appwrite koleksiyonu ve izinleri kontrol edin.\n\n" +
        (err && err.message ? err.message : String(err))
    );
  }
}

// -----------------------------------------------------------------------------
// PDF üretimi, Storage yükleme, DB kaydı, QR ve modal
// -----------------------------------------------------------------------------

/**
 * Tuvali PNG (yüksek çözünürlük) olarak alıp A4 PDF üretir: yükleme için blob + indirme için jsPDF örneği.
 */
function buildPdfFromCanvas(fabricCanvas) {
  const imgData = fabricCanvas.toDataURL({ format: "png", multiplier: 2 });
  if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
    throw new Error("jsPDF yüklenmedi (window.jspdf.jsPDF bulunamadı).");
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH, undefined, "FAST");
  const blob = pdf.output("blob");
  return { pdf: pdf, blob: blob };
}

/**
 * Başarı modalını gösterir; PDF public URL’si, QR ve indir / WhatsApp için veri güncellenir.
 * @param {string} publicUrl
 * @param {object} pdfDoc jsPDF örneği (.save için)
 */
function showResultModal(publicUrl, pdfDoc) {
  const modal = document.getElementById("resultModal");
  const link = document.getElementById("pdfPublicLink");
  const qrEl = document.getElementById("qrcodeArea");

  lastReportPdfUrl = publicUrl || null;
  lastReportPdfDoc = pdfDoc || null;

  const dlBtn = document.getElementById("downloadPdfBtn");
  const waBtn = document.getElementById("sendWhatsappBtn");
  if (dlBtn) {
    if (publicUrl) dlBtn.setAttribute("data-pdf-url", publicUrl);
    else dlBtn.removeAttribute("data-pdf-url");
  }
  if (waBtn) {
    if (publicUrl) waBtn.setAttribute("data-pdf-url", publicUrl);
    else waBtn.removeAttribute("data-pdf-url");
  }

  if (link) {
    link.href = publicUrl;
    link.textContent = publicUrl;
  }

  if (qrEl) {
    qrEl.innerHTML = "";
    if (typeof QRCode === "undefined") {
      qrEl.textContent = "QR kütüphanesi yüklenemedi.";
    } else {
      new QRCode(qrEl, {
        text: publicUrl,
        width: 200,
        height: 200,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    }
  }

  if (modal) {
    modal.classList.add("is-visible");
    modal.setAttribute("aria-hidden", "false");
  }
}

function hideResultModal() {
  const modal = document.getElementById("resultModal");
  if (modal) {
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
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

function fillDefaultReportDates() {
  const f = document.getElementById("reportFirstDate");
  const r = document.getElementById("reportReminderDate");
  const ex = document.getElementById("expiryDate");
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

function getReportCalendarDateValues() {
  const f = document.getElementById("reportFirstDate");
  const r = document.getElementById("reportReminderDate");
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

/**
 * Raporu Kaydet: doğrulama → PDF → Storage → public URL → Report satırı → modal + QR
 */
async function saveReportAndUpload() {
  const titleInput = document.getElementById("reportTitle");
  const companySel = document.getElementById("companySelect");
  if (!titleInput || !companySel) return;

  const reportTitle = titleInput.value.trim();
  const selectedCompanyId = companySel.value;

  if (!reportTitle) {
    window.alert("Lütfen rapor başlığını girin.");
    return;
  }
  if (!selectedCompanyId) {
    window.alert("Lütfen bir şirket seçin.");
    return;
  }
  const aw = getAw();
  if (!aw || !aw.storage || !aw.databases || !aw.isConfigured()) {
    window.alert(
      "Appwrite yapılandırması eksik. js/appwrite-config.mjs içinde DATABASE_ID, koleksiyon ve bucket ID’lerini doldurun."
    );
    return;
  }
  if (!canvas) {
    window.alert("Tuval başlatılamadı.");
    return;
  }

  const expiryEl = document.getElementById("expiryDate");
  const expiryVal = expiryEl && expiryEl.value ? expiryEl.value.trim() : "";
  if (!expiryVal) {
    window.alert("Lütfen geçerlilik bitiş tarihini seçin.");
    if (expiryEl) expiryEl.focus();
    return;
  }

  try {
    // 1) PDF (blob yükleme + jsPDF.save için aynı örnek)
    const { pdf: pdfDoc, blob: pdfBlob } = buildPdfFromCanvas(canvas);

    // 2) Storage’a yükle — QR ile aynı hedef link için önceden seçilen dosya adı
    if (!currentReportFileName) {
      assignNewReportFileName();
    }
    const fileName = currentReportFileName;
    const pdfFile = aw.blobToFile(pdfBlob, fileName);
    await aw.storage.createFile(aw.BUCKET_REPORT_PDFS, fileName, pdfFile);
    const publicUrl = aw.getStorageFileViewUrl(aw.BUCKET_REPORT_PDFS, fileName);

    // 4) Veritabanı belgesi (attribute adları REPORT_DB_COLUMNS ile)
    const insertRow = {};
    insertRow[REPORT_DB_COLUMNS.title] = reportTitle;
    insertRow[REPORT_DB_COLUMNS.companyId] = selectedCompanyId;
    insertRow[REPORT_DB_COLUMNS.pdfUrl] = publicUrl;
    insertRow[REPORT_DB_COLUMNS.expiryDate] = expiryVal;

    try {
      await aw.databases.createDocument(
        aw.DATABASE_ID,
        aw.COLLECTION_REPORTS,
        aw.ID.unique(),
        insertRow
      );
    } catch (insertError) {
      window.alert(
        "PDF yüklendi ancak veritabanına kayıt eklenemedi:\n" +
          (insertError && insertError.message
            ? insertError.message
            : String(insertError)) +
          "\n\nReports koleksiyonunda title, companyId, pdfUrl, expiryDate attribute’ları tanımlı olmalı."
      );
      return;
    }

    // 5) Ana sayfa takvimi: ilk rapor + hatırlatıcı tarihleri (localStorage)
    const calDates = getReportCalendarDateValues();
    if (typeof window.__3nSaveReportCalendarMarkers === "function") {
      window.__3nSaveReportCalendarMarkers({
        firstDate: calDates.firstDate,
        reminderDate: calDates.reminderDate,
        title: reportTitle,
      });
    }

    // 6) Modal + QR + indir / WhatsApp için pdf örneği
    showResultModal(publicUrl, pdfDoc);

    // Bir sonraki rapor / QR için yeni dosya adı ve tahmini URL
    assignNewReportFileName();
  } catch (err) {
    window.alert("İşlem sırasında hata: " + (err && err.message ? err.message : err));
  }
}

// -----------------------------------------------------------------------------
// Olay bağlama
// -----------------------------------------------------------------------------

function bindClick(id, handler) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("click", handler);
}

function wireResultModalClose() {
  const closeBtn = document.getElementById("closeResultModal");
  const backdrop = document.getElementById("resultModalBackdrop");
  if (closeBtn) closeBtn.addEventListener("click", hideResultModal);
  if (backdrop) backdrop.addEventListener("click", hideResultModal);
}

/** Boşlukları kaldırır; wa.me/90 ile birleşecek ulusal numara (baştaki 0 / +90 atılır) */
function nationalDigitsForWaMe(raw) {
  let t = String(raw || "").replace(/\s/g, "");
  if (!t) return "";
  t = t.replace(/[^\d]/g, "");
  if (t.startsWith("90")) t = t.slice(2);
  if (t.startsWith("0")) t = t.slice(1);
  return t;
}

function onDownloadPdfBtnClick() {
  if (!lastReportPdfDoc || typeof lastReportPdfDoc.save !== "function") {
    window.alert("İndirilecek PDF bulunamadı. Lütfen raporu yeniden kaydedin.");
    return;
  }
  lastReportPdfDoc.save("3N_Rapor.pdf");
}

function onSendWhatsappBtnClick() {
  const pdfUrl =
    lastReportPdfUrl ||
    (document.getElementById("sendWhatsappBtn") &&
      document.getElementById("sendWhatsappBtn").getAttribute("data-pdf-url")) ||
    "";
  if (!pdfUrl) {
    window.alert("PDF bağlantısı bulunamadı.");
    return;
  }

  const companySel = document.getElementById("companySelect");
  let phone = "";
  if (companySel && companySel.selectedIndex >= 0) {
    const opt = companySel.options[companySel.selectedIndex];
    phone = opt ? opt.getAttribute("data-phone") || "" : "";
  }
  const temizTelefon = phone.replace(/\s/g, "");
  if (!temizTelefon) {
    window.alert(
      "Seçili şirket için kayıtlı telefon numarası yok. companies sayfasından şirkete telefon ekleyin."
    );
    return;
  }

  const ulusal = nationalDigitsForWaMe(temizTelefon);
  if (!ulusal || ulusal.length < 10) {
    window.alert("Telefon numarası geçersiz görünüyor.");
    return;
  }

  const mesaj =
    "Merhaba, 3N Mühendislik periyodik kontrol raporunuz hazır. Aşağıdaki linkten karekodlu raporunuza ulaşabilirsiniz: " +
    pdfUrl;
  const formatliMesaj = encodeURIComponent(mesaj);
  window.open(
    "https://wa.me/90" + ulusal + "?text=" + formatliMesaj,
    "_blank"
  );
}

function wireResultModalActions() {
  bindClick("downloadPdfBtn", onDownloadPdfBtnClick);
  bindClick("sendWhatsappBtn", onSendWhatsappBtnClick);
}

function init() {
  canvas = initCanvas();
  if (!canvas) return;

  if (!canvas.__checkClickBound) {
    canvas.on("mouse:down", onChecklistCellMouseDown);
    canvas.__checkClickBound = true;
  }

  wireCanvasHistory();
  wireCanvasUndoRedoKeys();
  canvasHistoryResetToCurrent();

  bindClick("undoCanvasBtn", canvasHistoryUndo);
  bindClick("redoCanvasBtn", canvasHistoryRedo);

  bindClick("addTextBtn", addTextAtCenter);
  bindClick("addLineBtn", addLineAtCenter);
  bindClick("addRectBtn", addRectAtCenter);
  bindClick("addQrBtn", generateQrOnCanvas);
  bindClick("deleteObjBtn", deleteSelectedObjects);
  bindClick("clearCanvasBtn", clearWholeCanvas);
  bindClick("saveReportBtn", function () {
    saveReportAndUpload();
  });

  wireTemplateSelect();
  wireResultModalClose();
  wireResultModalActions();

  loadCompaniesIntoSelect().catch(function (e) {
    window.alert(
      "Şirket listesi yüklenemedi: " + (e && e.message ? e.message : String(e))
    );
  });

  fillDefaultReportDates();

  assignNewReportFileName();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
