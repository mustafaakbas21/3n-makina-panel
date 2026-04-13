/**
 * 3N Makine — Appwrite (tek modül, yerel import yok)
 *
 * CDN script’i (window.Appwrite) bu dosyadan önce yüklenmelidir.
 * Koleksiyon / bucket ID’lerini Appwrite konsolundan alıp burada güncelleyin.
 */
/** CDN: <script src=".../appwrite.../sdk.js"> → window.Appwrite */
const AppwriteGlobal =
  (typeof globalThis !== "undefined" && globalThis.Appwrite) ||
  (typeof window !== "undefined" && window.Appwrite) ||
  null;

if (!AppwriteGlobal || !AppwriteGlobal.Client) {
  throw new Error(
    "Appwrite SDK yüklenmedi. HTML içinde Appwrite CDN script’i, type=module satırından önce olmalıdır."
  );
}

const { Client, Account, Databases, Storage, ID, Query } = AppwriteGlobal;

/** Appwrite Storage fileId: en fazla 36 karakter; a-z, A-Z, 0-9, _ ; başta _ olamaz. */
function isValidStorageFileId(id) {
  if (id == null || typeof id !== "string") return false;
  var s = id.trim();
  if (s.length < 1 || s.length > 36) return false;
  if (s.charAt(0) === "_") return false;
  return /^[a-zA-Z0-9_]+$/.test(s);
}

/**
 * CDN: window.Appwrite.ID.unique() — asla string "unique()" değil.
 * Kimlik üretilemezse boş döner (çağıran kod kontrol eder).
 */
function newUniqueFileId() {
  var IdClass =
    (typeof window !== "undefined" && window.Appwrite && window.Appwrite.ID) ||
    ID;
  if (!IdClass || typeof IdClass.unique !== "function") {
    console.error("[3N] window.Appwrite.ID.unique kullanılamıyor (CDN sırası?).");
    return "";
  }
  var uid = IdClass.unique();
  uid = uid != null ? String(uid).trim() : "";
  if (!isValidStorageFileId(uid)) {
    console.error("[3N] ID.unique() geçersiz değer döndü:", uid);
    uid = IdClass.unique();
    uid = uid != null ? String(uid).trim() : "";
  }
  if (!isValidStorageFileId(uid)) {
    console.error("[3N] ID.unique() ikinci denemede de geçersiz:", uid);
    return "";
  }
  return uid;
}

const client = new Client()
  .setEndpoint("https://fra.cloud.appwrite.io/v1")
  .setProject("69dcde32001b4de0d04e");

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

const DATABASE_ID = "69dcdeff0008deb14b78";
/** scripts/setup-appwrite.cjs ile oluşturulan koleksiyon / bucket ID'leri */
const COLLECTION_COMPANIES = "companies";
const COLLECTION_REPORTS = "reports";
/** Appwrite Storage bucket ($id) — konsolda oluşturulan depo */
const STORAGE_BUCKET_ID = "69dd6d03000313133460";
const BUCKET_ID = STORAGE_BUCKET_ID;

/** Editör PDF’leri — aynı bucket kullanılabilir */
const BUCKET_REPORT_PDFS = BUCKET_ID;
/** Rapor deposu / QR stüdyosu — aynı bucket kullanılabilir */
const BUCKET_REPORTS = BUCKET_ID;

function normalizeDocument(doc) {
  if (!doc || typeof doc !== "object") return doc;
  var out = Object.assign({}, doc);
  if (doc.$id != null) out.id = doc.$id;
  if (doc.$createdAt != null) out.createdAt = doc.$createdAt;
  if (doc.$updatedAt != null) out.updatedAt = doc.$updatedAt;
  return out;
}

function normalizeDocuments(docs) {
  return (docs || []).map(normalizeDocument);
}

/**
 * İstemci ile aynı endpoint/project; örnek:
 * {endpoint}/storage/buckets/{bucketId}/files/{fileId}/view?project={projectId}
 */
function buildStorageFileViewUrl(bucketId, fileId) {
  if (!isValidStorageFileId(fileId)) {
    return "";
  }
  var ep = String(client.config.endpoint || "").replace(/\/$/, "");
  var pid = String(client.config.project || "");
  var b = encodeURIComponent(String(bucketId));
  var f = encodeURIComponent(String(fileId));
  return (
    ep +
    "/storage/buckets/" +
    b +
    "/files/" +
    f +
    "/view?project=" +
    encodeURIComponent(pid)
  );
}

function getStorageFileViewUrl(bucketId, fileId) {
  return buildStorageFileViewUrl(bucketId, fileId);
}

function extractFileIdFromStorageUploadResponse(uploadResult) {
  if (!uploadResult || typeof uploadResult !== "object") {
    return "";
  }
  var keys = ["$id", "id", "fileId", "file_id"];
  var i;
  var fid;
  for (i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (uploadResult[k] != null) {
      fid = String(uploadResult[k]).trim();
      if (isValidStorageFileId(fid)) return fid;
    }
  }
  console.warn("[3N] storage yanıtında geçerli dosya $id bulunamadı:", uploadResult);
  return "";
}

/**
 * Yalnızca createFile yanıtındaki gerçek dosya kimliği ile URL (yanıtta $id zorunlu).
 */
function pdfViewUrlFromUploadResult(bucketId, uploadResult) {
  var fid = extractFileIdFromStorageUploadResponse(uploadResult);
  if (!fid) return "";
  return buildStorageFileViewUrl(bucketId, fid);
}

function blobToFile(blob, filename) {
  return new File([blob], filename, {
    type: (blob && blob.type) || "application/octet-stream",
  });
}

function isConfigured() {
  if (!DATABASE_ID || DATABASE_ID.indexOf("BURAYA") !== -1) return false;
  if (!COLLECTION_COMPANIES || COLLECTION_COMPANIES.indexOf("BURAYA") !== -1)
    return false;
  if (!COLLECTION_REPORTS || COLLECTION_REPORTS.indexOf("BURAYA") !== -1)
    return false;
  if (!BUCKET_ID || BUCKET_ID.indexOf("BURAYA") !== -1) return false;
  return true;
}

window.__3nAppwrite = {
  client: client,
  account: account,
  databases: databases,
  storage: storage,
  ID: ID,
  Query: Query,
  newUniqueFileId: newUniqueFileId,
  isValidStorageFileId: isValidStorageFileId,
  buildStorageFileViewUrl: buildStorageFileViewUrl,
  pdfViewUrlFromUploadResult: pdfViewUrlFromUploadResult,
  extractFileIdFromStorageUploadResponse: extractFileIdFromStorageUploadResponse,
  DATABASE_ID: DATABASE_ID,
  COLLECTION_COMPANIES: COLLECTION_COMPANIES,
  COLLECTION_REPORTS: COLLECTION_REPORTS,
  STORAGE_BUCKET_ID: STORAGE_BUCKET_ID,
  BUCKET_ID: BUCKET_ID,
  BUCKET_REPORT_PDFS: BUCKET_REPORT_PDFS,
  BUCKET_REPORTS: BUCKET_REPORTS,
  isConfigured: isConfigured,
  normalizeDocument: normalizeDocument,
  normalizeDocuments: normalizeDocuments,
  getStorageFileViewUrl: getStorageFileViewUrl,
  blobToFile: blobToFile,
};
