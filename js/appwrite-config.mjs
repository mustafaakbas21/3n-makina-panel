/**
 * 3N Makine — Appwrite (tek modül, yerel import yok)
 *
 * CDN script’i (window.Appwrite) bu dosyadan önce yüklenmelidir.
 * Koleksiyon / bucket ID’lerini Appwrite konsolundan alıp burada güncelleyin.
 */
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
const BUCKET_ID = "3n-files";

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

function getStorageFileViewUrl(bucketId, fileId) {
  try {
    var u = storage.getFileView(bucketId, fileId);
    if (typeof u === "string") return u;
    if (u && typeof u.href === "string") return u.href;
    return String(u);
  } catch (e) {
    return "";
  }
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
  DATABASE_ID: DATABASE_ID,
  COLLECTION_COMPANIES: COLLECTION_COMPANIES,
  COLLECTION_REPORTS: COLLECTION_REPORTS,
  BUCKET_ID: BUCKET_ID,
  BUCKET_REPORT_PDFS: BUCKET_REPORT_PDFS,
  BUCKET_REPORTS: BUCKET_REPORTS,
  isConfigured: isConfigured,
  normalizeDocument: normalizeDocument,
  normalizeDocuments: normalizeDocuments,
  getStorageFileViewUrl: getStorageFileViewUrl,
  blobToFile: blobToFile,
};

void client.ping().then(
  function () {
    console.info("[Appwrite] ping OK — backend erişilebilir.");
  },
  function (err) {
    console.warn("[Appwrite] ping başarısız:", err);
  }
);
