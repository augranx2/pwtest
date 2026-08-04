/**
 * @OnlyCurrentDoc
 */
/**
 * SPA (SISTEM PENGOLAHAN AIR) — Google Apps Script backend
 * PT. Rama Emerald Multi Sukses — QA
 *
 * Tempel seluruh isi file ini ke Apps Script (Extensions > Apps Script) yang
 * menempel pada Google Sheet KHUSUS SPA (BEDA dari spreadsheet EM Viable).
 *
 * Setelah ditempel: Deploy > New deployment > Web app, Execute as: Me,
 * Who has access: Anyone. Salin URL yang dihasilkan (diakhiri /exec) untuk
 * dipakai di public/config.js pada project React SPA.
 *
 * Tab yang dibutuhkan di spreadsheet ini:
 *   User_Roles       : Nama | Role | Departemen | Username | PasswordBaru | PasswordHash | Salt
 *   Sessions         : Token | Username | Nama | Role | Departemen | LoginAt | ExpiresAt
 *   Audit_Log        : Waktu | Username | Nama | Role | Departemen | Aksi | Sistem | Bulan | Detail
 *   Pengkajian_Narasi: System | Bulan | Pendahuluan | PerParameterJSON | ReviewTren |
 *                       Kesimpulan | DinilaiNama | DinilaiJabatan | DinilaiTanggal |
 *                       DiperiksaNama | DiperiksaJabatan | DiperiksaTanggal | UpdatedAt
 *   Report_Hasil     : System | Tanggal | AnalisNama | AnalisUsername | AnalisTanggal |
 *                       DiperiksaNama | DiperiksaUsername | DiperiksaTanggal | UpdatedAt
 *
 * PLUS 2 tab per sistem (5 sistem = 10 tab tambahan), namanya harus PERSIS
 * seperti di SYSTEMS di bawah (masterSheet & dataSheet):
 *   <Sistem>_Master  : TitikSampling | NamaRuangan
 *                       (database titik sampling + nama ruangan/area-nya,
 *                       mis. "PW_NBL_Master": POU-1 | Ruang Loading Area)
 *   <Sistem>_Data    : Tanggal | TitikSampling | NamaRuangan | Kejernihan |
 *                       Warna | Bau | Konduktivitas | pH | TOC | Mikrobiologi |
 *                       Endotoksin | NoKontrolMedia | NoKontrolBakteri
 *                       (hasil pengujian mentah, 1 tab per sistem — mis.
 *                       "PW_NBL_Data" — supaya rapi seperti di EM Viable)
 *
 * Kalau tab <Sistem>_Master belum dibuat/masih kosong, sistem sementara
 * memakai daftar titik bawaan (tanpa nama ruangan) supaya tetap bisa dipakai
 * sambil menunggu data nama ruangan lengkap menyusul.
 *
 * User_Roles, Sessions, Audit_Log, dan sistem login/role-nya PERSIS SAMA
 * dengan EM Viable (5 role: Staff, Supervisor, Manager, Assistant Manager,
 * Administrator) — hanya datanya terpisah (spreadsheet & Sessions sendiri),
 * jadi akun SPA tidak otomatis bisa dipakai login ke EM Viable atau
 * sebaliknya, walau pola izin per role-nya identik.
 * Untuk set/reset password: ketik password baru (teks biasa) di kolom
 * PasswordBaru baris orang itu — otomatis ter-enkripsi begitu ada yang
 * login (siapa saja), lalu PasswordBaru dikosongkan lagi otomatis.
 */

// ---------------------------------------------------------------------------
// KONFIGURASI: sistem air (jenis air x fasilitas), TETAP/fixed sesuai arahan
// ---------------------------------------------------------------------------
const SYSTEMS = {
  pw_nbl: {
    jenis: "PW", label: "Purified Water — NBL", masterSheet: "PW_NBL_Master", dataSheet: "PW_NBL_Data",
    defaultPoints: ["SV 49-03C", "SV 60-03C",
      "POU-1", "POU-2", "POU-3", "POU-4", "POU-5", "POU-6", "POU-7", "POU-8", "POU-9", "POU-10",
      "POU-11", "POU-12", "POU-13", "POU-14", "POU-15", "POU-16", "POU-17", "POU-18", "POU-19", "POU-20"],
  },
  pw_sefalosporin: {
    jenis: "PW", label: "Purified Water — Sefalosporin", masterSheet: "PW_Sefalosporin_Master", dataSheet: "PW_Sefalosporin_Data",
    defaultPoints: ["SV 60-02C", "SP-23", "SP-24",
      "POU-01", "POU-02", "POU-03", "POU-04", "POU-05", "POU-06", "POU-07", "POU-08", "POU-09", "POU-10",
      "POU-11", "POU-12", "POU-13", "POU-14", "POU-15", "POU-16", "POU-17", "POU-18", "POU-19", "POU-20"],
  },
  pw_betalaktam: {
    jenis: "PW", label: "Purified Water — Betalaktam", masterSheet: "PW_Betalaktam_Master", dataSheet: "PW_Betalaktam_Data",
    defaultPoints: ["POU-1", "POU-2"],
  },
  wfi_sefalosporin: {
    jenis: "WFI", label: "Water For Injection — Sefalosporin", masterSheet: "WFI_Sefalosporin_Master", dataSheet: "WFI_Sefalosporin_Data",
    defaultPoints: ["Tank WFI", "POU-1", "POU-2", "POU-3", "Return WFI"],
  },
  ps_sefalosporin_steril: {
    jenis: "Pure Steam", label: "Pure Steam — Sefalosporin Steril", masterSheet: "PureSteam_SefaSteril_Master", dataSheet: "PureSteam_SefaSteril_Data",
    defaultPoints: ["PS-1"],
  },
};

// Parameter yang dievaluasi tiap jenis air. PW tidak ada Endotoksin.
const PARAMS_BY_JENIS = {
  PW: ["konduktivitas", "ph", "toc", "mikrobiologi"],
  WFI: ["konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
  "Pure Steam": ["konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
};

const PARAM_META = {
  konduktivitas: { label: "Konduktivitas", unit: "µS/cm", short: "Konduktivitas" },
  ph: { label: "pH", unit: "", short: "pH" },
  toc: { label: "Total Organic Carbon (TOC)", unit: "ppb", short: "TOC" },
  mikrobiologi: { label: "Cemaran Mikrobiologi", unit: "CFU/mL", short: "Mikrobiologi" },
  endotoksin: { label: "Endotoksin", unit: "EU/mL", short: "Endotoksin" },
};

// Persyaratan/Alert/Action — SAMA untuk semua fasilitas & jenis air (PW/WFI/
// Pure Steam), sesuai contoh Pengkajian yang dilampirkan. pH punya batas
// bawah MAUPUN atas (beda dari EM Viable yang cuma 1 arah).
const LIMITS = {
  konduktivitas: { syaratMax: 2.1, alertMax: 1.67, actionMax: 1.94 },
  toc: { syaratMax: 500, alertMax: 375, actionMax: 450 },
  ph: { syaratMin: 5.00, syaratMax: 7.00, alertMin: 5.39, actionMin: 5.10, alertMax: 6.52, actionMax: 6.80 },
  mikrobiologi: { syaratMax: 100, alertMax: 65, actionMax: 89 },
  endotoksin: { qualitative: true, passValue: "Negatif" },
};

// ---------------------------------------------------------------------------
// KONFIGURASI: AUTH / ROLE / AUDIT  (identik dengan EM Viable)
// ---------------------------------------------------------------------------
const USER_ROLES_SHEET = "User_Roles";
const SESSIONS_SHEET = "Sessions";
const AUDIT_LOG_SHEET = "Audit_Log";
const NARRATIVE_SHEET = "Pengkajian_Narasi";
const REPORT_HASIL_SHEET = "Report_Hasil";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 jam
const ROLE_LEVEL = { Staff: 1, Supervisor: 2, Manager: 3, "Assistant Manager": 3, Administrator: 4 };

// ---------------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;
    switch (action) {
      case "master":
        result = getMaster_(e.parameter.system);
        break;
      case "entries":
        result = getEntries_(e.parameter.system, e.parameter.month);
        break;
      case "report":
        result = getReport_(e.parameter.system, e.parameter.month);
        break;
      case "statusIndex":
        result = getStatusIndex_(e.parameter.month);
        break;
      case "whoami":
        result = whoami_(e.parameter.token);
        break;
      case "activityLog":
        result = getActivityLog_(e.parameter.token, e.parameter.month, e.parameter.system);
        break;
      case "reportHasil":
        result = getReportHasil_(e.parameter.system, e.parameter.tanggal);
        break;
      default:
        result = { error: "Aksi tidak dikenal: " + action };
    }
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let result;
    switch (body.action) {
      case "login":
        result = login_(body.username, body.password);
        break;
      case "logout":
        result = logout_(body.token);
        break;
      case "changePassword":
        result = withAuth_(body.token, function (session) {
          return changePasswordAuthed_(session, body.oldPassword, body.newPassword);
        });
        break;
      case "saveEntries":
        result = withAuth_(body.token, function (session) {
          return saveEntriesAuthed_(session, body.system, body.month, body.entries || []);
        });
        break;
      case "saveReport":
        result = withAuth_(body.token, function (session) {
          return saveReportAuthed_(session, body.system, body.month, body.narrative || {});
        });
        break;
      case "approveDikaji":
        result = withAuth_(body.token, function (session) {
          return approveDikajiAuthed_(session, body.system, body.month);
        });
        break;
      case "approveMengetahui":
        result = withAuth_(body.token, function (session) {
          return approveMengetahuiAuthed_(session, body.system, body.month);
        });
        break;
      case "saveReportHasil":
        result = withAuth_(body.token, function (session) {
          return saveReportHasilAuthed_(session, body.system, body.tanggal);
        });
        break;
      case "approveReportHasil":
        result = withAuth_(body.token, function (session) {
          return approveReportHasilAuthed_(session, body.system, body.tanggal);
        });
        break;
      default:
        result = { error: "Aksi tidak dikenal: " + body.action };
    }
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function withAuth_(token, fn) {
  const session = validateSession_(token);
  if (!session) return { error: "Sesi tidak valid atau sudah habis, silakan login ulang." };
  try {
    return fn(session);
  } catch (err) {
    return { error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// AUTH: LOGIN / LOGOUT / SESSION  (identik dengan EM Viable)
// ---------------------------------------------------------------------------

function randomHex_(numBytes) {
  const chars = [];
  for (let i = 0; i < numBytes; i++) {
    chars.push(("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2));
  }
  return chars.join("");
}

function generateSalt_() {
  return randomHex_(16);
}

function generateToken_() {
  return Utilities.getUuid().replace(/-/g, "") + randomHex_(8);
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password) + "::" + String(salt)
  );
  return digest
    .map(function (b) {
      return ("0" + (b & 0xff).toString(16)).slice(-2);
    })
    .join("");
}

function getUserRolesSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USER_ROLES_SHEET);
  if (!sheet) throw new Error("Tab '" + USER_ROLES_SHEET + "' tidak ditemukan.");
  return sheet;
}

// Kolom User_Roles (posisi tetap): A Nama | B Role | C Departemen | D Username
// | E PasswordBaru | F PasswordHash | G Salt
function migratePasswords_() {
  const sheet = getUserRolesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, 1, lastRow - 1, 7);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    const passwordBaru = values[i][4];
    if (passwordBaru !== "" && passwordBaru !== null && passwordBaru !== undefined) {
      const salt = generateSalt_();
      const hash = hashPassword_(String(passwordBaru), salt);
      values[i][4] = ""; // kosongkan PasswordBaru
      values[i][5] = hash; // PasswordHash
      values[i][6] = salt; // Salt
      changed = true;
    }
  }
  if (changed) range.setValues(values);
}

function findUserByUsername_(username) {
  const sheet = getUserRolesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const target = String(username || "").trim().toLowerCase();
  if (!target) return null;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const uname = String(row[3] || "").trim().toLowerCase();
    if (uname && uname === target) {
      return {
        nama: row[0],
        role: String(row[1] || "").trim(),
        departemen: String(row[2] || "").trim(),
        username: row[3],
        passwordHash: row[5],
        salt: row[6],
      };
    }
  }
  return null;
}

function login_(username, password) {
  if (!username || !password) return { error: "Username dan password wajib diisi." };
  migratePasswords_();
  const user = findUserByUsername_(username);
  if (!user || !user.passwordHash) return { error: "Username atau password salah." };
  const hash = hashPassword_(password, user.salt);
  if (hash !== user.passwordHash) return { error: "Username atau password salah." };
  if (!ROLE_LEVEL[user.role]) return { error: "Role akun ini belum diatur dengan benar. Hubungi Manager." };

  const token = generateToken_();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const sessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SESSIONS_SHEET);
  if (!sessSheet) return { error: "Tab '" + SESSIONS_SHEET + "' tidak ditemukan." };
  sessSheet.appendRow([token, user.username, user.nama, user.role, user.departemen, now, expiresAt]);

  writeAuditLog_({
    username: user.username, nama: user.nama, role: user.role, departemen: user.departemen,
    aksi: "Login", sistem: "", bulan: "", detail: "",
  });

  return { ok: true, token: token, nama: user.nama, role: user.role, departemen: user.departemen, username: user.username };
}

function changePasswordAuthed_(session, oldPassword, newPassword) {
  if (!oldPassword || !newPassword) {
    return { error: "Password lama dan password baru wajib diisi." };
  }
  if (String(newPassword).length < 6) {
    return { error: "Password baru minimal 6 karakter." };
  }
  const sheet = getUserRolesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { error: "Data pengguna tidak ditemukan." };
  const range = sheet.getRange(2, 1, lastRow - 1, 7);
  const values = range.getValues();
  const target = String(session.username || "").trim().toLowerCase();

  for (let i = 0; i < values.length; i++) {
    const uname = String(values[i][3] || "").trim().toLowerCase();
    if (uname && uname === target) {
      const currentHash = values[i][5];
      const currentSalt = values[i][6];
      if (!currentHash || hashPassword_(oldPassword, currentSalt) !== currentHash) {
        return { error: "Password lama yang Anda masukkan salah." };
      }
      const newSalt = generateSalt_();
      const newHash = hashPassword_(String(newPassword), newSalt);
      sheet.getRange(i + 2, 5).setValue("");
      sheet.getRange(i + 2, 6).setValue(newHash);
      sheet.getRange(i + 2, 7).setValue(newSalt);

      writeAuditLog_({
        username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
        aksi: "Ganti Password", sistem: "", bulan: "", detail: "",
      });
      return { ok: true };
    }
  }
  return { error: "Akun tidak ditemukan." };
}

function logout_(token) {
  if (!token) return { ok: true };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SESSIONS_SHEET);
  if (!sheet) return { ok: true };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true };
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(token)) {
      const row = values[i];
      writeAuditLog_({
        username: row[1], nama: row[2], role: row[3], departemen: row[4],
        aksi: "Logout", sistem: "", bulan: "", detail: "",
      });
      sheet.deleteRow(i + 2);
    }
  }
  return { ok: true };
}

// Sessions kolom: A Token | B Username | C Nama | D Role | E Departemen | F LoginAt | G ExpiresAt
function validateSession_(token) {
  if (!token) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SESSIONS_SHEET);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const now = new Date();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[0]) === String(token)) {
      const expiresAt = new Date(row[6]);
      if (isNaN(expiresAt.getTime()) || now.getTime() > expiresAt.getTime()) {
        sheet.deleteRow(i + 2);
        return null;
      }
      return {
        token: row[0], username: row[1], nama: row[2],
        role: String(row[3] || "").trim(), departemen: String(row[4] || "").trim(),
      };
    }
  }
  return null;
}

function whoami_(token) {
  const session = validateSession_(token);
  if (!session) return { error: "invalid" };
  return { ok: true, nama: session.nama, role: session.role, departemen: session.departemen, username: session.username };
}

function requireRole_(session, minRole, departemen) {
  if (session.role === "Administrator") return true;
  const level = ROLE_LEVEL[session.role] || 0;
  const minLevel = ROLE_LEVEL[minRole] || 99;
  if (level < minLevel) return false;
  if (departemen && session.departemen !== departemen) return false;
  return true;
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------
// Kolom: A Waktu | B Username | C Nama | D Role | E Departemen | F Aksi | G Sistem | H Bulan | I Detail
function writeAuditLog_(entry) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_LOG_SHEET);
  if (!sheet) return;
  sheet.appendRow([
    new Date(), entry.username || "", entry.nama || "", entry.role || "", entry.departemen || "",
    entry.aksi || "", entry.sistem || "", entry.bulan || "", entry.detail || "",
  ]);
}

function getActivityLog_(token, month, systemLabel) {
  const session = validateSession_(token);
  if (!session) return { error: "Sesi tidak valid atau sudah habis, silakan login ulang." };
  if (!requireRole_(session, "Supervisor")) {
    return { error: "Hanya Supervisor/Manager yang boleh melihat Riwayat Aktivitas." };
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_LOG_SHEET);
  if (!sheet) return { logs: [] };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { logs: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  let logs = values.map(function (row) {
    return {
      waktu: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
      username: row[1], nama: row[2], role: row[3], departemen: row[4],
      aksi: row[5], sistem: row[6], bulan: row[7], detail: row[8],
    };
  });
  if (month) logs = logs.filter(function (l) { return l.bulan === month; });
  if (systemLabel) logs = logs.filter(function (l) { return l.sistem === systemLabel; });
  logs.sort(function (a, b) { return new Date(b.waktu) - new Date(a.waktu); });
  return { logs: logs.slice(0, 300) };
}

// ---------------------------------------------------------------------------
// MASTER TITIK SAMPLING  (tetap/hardcoded per sistem, lihat SYSTEMS di atas)
// ---------------------------------------------------------------------------
// Tab per sistem, misal "PW_NBL_Master". Kolom: A TitikSampling | B NamaRuangan
// Baris 1 = judul kolom, data mulai baris 2. Kalau tab ini belum dibuat atau
// masih kosong, sistem sementara pakai daftar titik bawaan (defaultPoints)
// tanpa nama ruangan, supaya web app tetap bisa dipakai sambil menunggu data
// nama ruangan lengkap diisi menyusul.
function getMasterPoints_(systemKey) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.masterSheet);
  if (!sheet) return (cfg.defaultPoints || []).map(function (p) { return { code: p, name: "" }; });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return (cfg.defaultPoints || []).map(function (p) { return { code: p, name: "" }; });
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const points = [];
  for (let i = 0; i < values.length; i++) {
    const code = String(values[i][0] || "").trim();
    if (!code) continue;
    points.push({ code: code, name: String(values[i][1] || "").trim() });
  }
  return points.length > 0 ? points : (cfg.defaultPoints || []).map(function (p) { return { code: p, name: "" }; });
}

function getMaster_(systemKey) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  return { system: systemKey, jenis: cfg.jenis, points: getMasterPoints_(systemKey) };
}

function namaRuanganFor_(systemKey, titikCode) {
  const points = getMasterPoints_(systemKey);
  const found = points.find(function (p) { return p.code === titikCode; });
  return found ? found.name : "";
}

// ---------------------------------------------------------------------------
// ENTRIES — 1 tab per sistem (misal "PW_NBL_Data"), seperti data per fasilitas
// di EM Viable. Kolom: A Tanggal | B TitikSampling | C NamaRuangan |
// D Kejernihan | E Warna | F Bau | G Konduktivitas | H pH | I TOC |
// J Mikrobiologi | K Endotoksin | L NoKontrolMedia | M NoKontrolBakteri
// ---------------------------------------------------------------------------
function getEntriesSheet_(systemKey) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) throw new Error("Sistem tidak dikenal: " + systemKey);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.dataSheet);
  if (!sheet) throw new Error("Tab '" + cfg.dataSheet + "' tidak ditemukan.");
  return sheet;
}

function rowToEntry_(row, idx) {
  return {
    id: "row-" + idx,
    tanggal: formatDate_(row[0]),
    titikSampling: row[1] || "",
    namaRuangan: row[2] || "",
    kejernihan: row[3] || "",
    warna: row[4] || "",
    bau: row[5] || "",
    konduktivitas: emptyToNull_(row[6]),
    ph: emptyToNull_(row[7]),
    toc: emptyToNull_(row[8]),
    mikrobiologi: emptyToNull_(row[9]),
    endotoksin: row[10] || "",
    noKontrolMedia: row[11] || "",
    noKontrolBakteri: row[12] || "",
  };
}

function getEntries_(systemKey, month) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const sheet = getEntriesSheet_(systemKey);
  const values = sheet.getDataRange().getValues();
  const entries = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[1]) continue;
    if (month && formatMonth_(row[0]) !== month) continue;
    entries.push(rowToEntry_(row, i));
  }
  return { system: systemKey, month: month, entries: entries };
}

function saveEntries_(systemKey, month, entries) {
  const sheet = getEntriesSheet_(systemKey);
  const values = sheet.getDataRange().getValues();
  const kept = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[1]) continue;
    if (formatMonth_(row[0]) === month) continue; // dibuang, diganti data baru
    kept.push(row);
  }
  const newRows = entries.map(function (e) {
    const namaRuangan = e.namaRuangan || namaRuanganFor_(systemKey, e.titikSampling);
    return [
      e.tanggal || "", e.titikSampling || "", namaRuangan,
      e.kejernihan || "", e.warna || "", e.bau || "",
      e.konduktivitas === null || e.konduktivitas === undefined ? "" : e.konduktivitas,
      e.ph === null || e.ph === undefined ? "" : e.ph,
      e.toc === null || e.toc === undefined ? "" : e.toc,
      e.mikrobiologi === null || e.mikrobiologi === undefined ? "" : e.mikrobiologi,
      e.endotoksin || "",
      e.noKontrolMedia || "", e.noKontrolBakteri || "",
    ];
  });
  const finalRows = kept.concat(newRows);
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 13).clearContent();
  if (finalRows.length > 0) {
    sheet.getRange(2, 1, finalRows.length, 13).setValues(finalRows);
  }
  return { ok: true, saved: newRows.length };
}

function saveEntriesAuthed_(session, systemKey, month, entries) {
  const isQCInput = requireRole_(session, "Staff", "QC");
  const isQAInput = requireRole_(session, "Supervisor", "QA");
  if (!isQCInput && !isQAInput) {
    return { error: "Hanya Staff/Supervisor/Manager QC, atau Supervisor/Manager QA, yang boleh mengisi data pengujian." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };

  const before = getEntries_(systemKey, month).entries || [];
  const submittedIds = {};
  entries.forEach(function (e) { submittedIds[e.id] = true; });
  const deletedRows = before.filter(function (e) { return !submittedIds[e.id]; });
  const canDelete = requireRole_(session, "Supervisor", "QC") || requireRole_(session, "Supervisor", "QA");
  if (deletedRows.length > 0 && !canDelete) {
    return { error: "Staff tidak bisa menghapus data yang sudah tersimpan. Hubungi Supervisor/Manager QC atau QA untuk menghapus baris." };
  }

  const result = saveEntries_(systemKey, month, entries);
  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: deletedRows.length > 0 ? "Hapus/Ubah Data" : "Simpan Data",
    sistem: cfg.label, bulan: month,
    detail: entries.length + " baris tersimpan" + (deletedRows.length > 0 ? ", " + deletedRows.length + " baris dihapus" : ""),
  });
  return result;
}

// ---------------------------------------------------------------------------
// PENGKAJIAN SPA (tab "Pengkajian_Narasi")
// ---------------------------------------------------------------------------
function emptySignoffServer_() {
  return { dinilai: { nama: "", jabatan: "", tanggal: "" }, diperiksa: { nama: "", jabatan: "", tanggal: "" } };
}

function getReport_(systemKey, month) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NARRATIVE_SHEET);
  if (!sheet) return { error: "Tab tidak ditemukan: " + NARRATIVE_SHEET };

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[0] || "").trim() === systemKey && formatMonth_(row[1]) === month) {
      return {
        found: true,
        narrative: {
          pendahuluan: row[2],
          perParameter: safeParseJSON_(row[3]) || {},
          reviewTren: row[4] || "",
          kesimpulan: row[5] || "",
        },
        signoff: {
          dinilai: { nama: row[6], jabatan: row[7], tanggal: formatDate_(row[8]) },
          diperiksa: { nama: row[9], jabatan: row[10], tanggal: formatDate_(row[11]) },
        },
        updatedAt: row[12],
      };
    }
  }
  return { found: false };
}

function saveReport_(systemKey, month, narrative, signoff) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NARRATIVE_SHEET);
  if (!sheet) return { error: "Tab tidak ditemukan: " + NARRATIVE_SHEET };

  const values = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === systemKey && formatMonth_(values[i][1]) === month) {
      targetRow = i + 1;
      break;
    }
  }

  const dinilai = signoff.dinilai || {};
  const diperiksa = signoff.diperiksa || {};
  const now = new Date();

  const rowValues = [
    systemKey, month,
    narrative.pendahuluan || "",
    JSON.stringify(narrative.perParameter || {}),
    narrative.reviewTren || "",
    narrative.kesimpulan || "",
    dinilai.nama || "", dinilai.jabatan || "", dinilai.tanggal || "",
    diperiksa.nama || "", diperiksa.jabatan || "", diperiksa.tanggal || "",
    now,
  ];

  if (targetRow === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  }
  return { ok: true };
}

function saveReportAuthed_(session, systemKey, month, narrative) {
  if (!requireRole_(session, "Supervisor", "QA")) {
    return { error: "Hanya Supervisor/Manager QA yang boleh menyusun Pengkajian SPA." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const existing = getReport_(systemKey, month);
  const signoff = (existing && existing.signoff) || emptySignoffServer_();
  const result = saveReport_(systemKey, month, narrative, signoff);
  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: "Susun Pengkajian SPA", sistem: cfg.label, bulan: month, detail: "",
  });
  return result;
}

function approveDikajiAuthed_(session, systemKey, month) {
  if (!requireRole_(session, "Supervisor", "QA")) {
    return { error: "Hanya Supervisor/Manager QA yang boleh menyetujui 'Dikaji Oleh'." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const existing = getReport_(systemKey, month);
  if (!existing.found) return { error: "Belum ada draf Pengkajian SPA untuk bulan ini, isi dulu narasinya." };
  const signoff = existing.signoff || emptySignoffServer_();
  signoff.dinilai = { nama: session.nama, jabatan: session.role + " QA", tanggal: formatDate_(new Date()) };
  const result = saveReport_(systemKey, month, existing.narrative, signoff);
  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: "Approve Dikaji Oleh", sistem: cfg.label, bulan: month, detail: "",
  });
  return result;
}

function approveMengetahuiAuthed_(session, systemKey, month) {
  if (!requireRole_(session, "Manager", "QA")) {
    return { error: "Hanya Manager QA (atau yang mewakili) yang boleh menyetujui final 'Mengetahui'." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const existing = getReport_(systemKey, month);
  if (!existing.found) return { error: "Belum ada draf Pengkajian SPA untuk bulan ini." };
  if (!existing.signoff || !existing.signoff.dinilai || !existing.signoff.dinilai.nama) {
    return { error: "Pengkajian ini belum di-approve 'Dikaji Oleh', tidak bisa langsung final." };
  }
  const signoff = existing.signoff;
  signoff.diperiksa = { nama: session.nama, jabatan: "Manager QA", tanggal: formatDate_(new Date()) };
  const result = saveReport_(systemKey, month, existing.narrative, signoff);
  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: "Approve Final (Mengetahui)", sistem: cfg.label, bulan: month, detail: "",
  });
  return result;
}

// ---------------------------------------------------------------------------
// REPORT HASIL PEMERIKSAAN (formulir QC fisik yang didigitalkan) — tab
// "Report_Hasil". Cuma menyimpan metadata tanda tangan; datanya sendiri
// diambil live dari tab "Entries" (sama seperti Report Hasil EM di EM Viable).
// Kolom: A System | B Tanggal | C AnalisNama | D AnalisUsername |
// E AnalisTanggal | F DiperiksaNama | G DiperiksaUsername | H DiperiksaTanggal | I UpdatedAt
// ---------------------------------------------------------------------------
function getReportHasilSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_HASIL_SHEET);
  if (!sheet) throw new Error("Tab '" + REPORT_HASIL_SHEET + "' tidak ditemukan.");
  return sheet;
}

function findReportHasilRow_(systemKey, tanggal) {
  const sheet = getReportHasilSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, rowIndex: -1, row: null };
  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === systemKey && formatDate_(values[i][1]) === tanggal) {
      return { sheet: sheet, rowIndex: i + 2, row: values[i] };
    }
  }
  return { sheet: sheet, rowIndex: -1, row: null };
}

function getReportHasil_(systemKey, tanggal) {
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  if (!tanggal) return { found: false };
  const found = findReportHasilRow_(systemKey, tanggal);
  if (found.rowIndex === -1) return { found: false };
  const row = found.row;
  return {
    found: true,
    analis: { nama: row[2] || "", username: row[3] || "", tanggal: formatDate_(row[4]) },
    diperiksa: { nama: row[5] || "", username: row[6] || "", tanggal: formatDate_(row[7]) },
    updatedAt: row[8],
  };
}

function saveReportHasilAuthed_(session, systemKey, tanggal) {
  if (!requireRole_(session, "Staff", "QC")) {
    return { error: "Hanya Staff/Supervisor/Manager QC yang boleh mengisi Report Hasil Pemeriksaan." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  if (!tanggal) return { error: "Tanggal pemeriksaan wajib diisi." };

  const found = findReportHasilRow_(systemKey, tanggal);
  const now = new Date();
  const isNew = found.rowIndex === -1;
  const analisNama = isNew ? session.nama : (found.row[2] || session.nama);
  const analisUsername = isNew ? session.username : (found.row[3] || session.username);
  const analisTanggal = isNew ? formatDate_(now) : (formatDate_(found.row[4]) || formatDate_(now));
  const diperiksaNama = isNew ? "" : (found.row[5] || "");
  const diperiksaUsername = isNew ? "" : (found.row[6] || "");
  const diperiksaTanggal = isNew ? "" : (found.row[7] || "");

  const rowValues = [
    systemKey, tanggal,
    analisNama, analisUsername, analisTanggal,
    diperiksaNama, diperiksaUsername, diperiksaTanggal,
    now,
  ];
  if (isNew) {
    found.sheet.appendRow(rowValues);
  } else {
    found.sheet.getRange(found.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }

  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: isNew ? "Buat Report Hasil Pemeriksaan" : "Update Report Hasil Pemeriksaan",
    sistem: cfg.label, bulan: tanggal, detail: "",
  });

  return getReportHasil_(systemKey, tanggal);
}

function approveReportHasilAuthed_(session, systemKey, tanggal) {
  if (!requireRole_(session, "Supervisor", "QC")) {
    return { error: "Hanya Supervisor/Manager QC yang boleh menyetujui Report Hasil Pemeriksaan." };
  }
  const cfg = SYSTEMS[systemKey];
  if (!cfg) return { error: "Sistem tidak dikenal: " + systemKey };
  const found = findReportHasilRow_(systemKey, tanggal);
  if (found.rowIndex === -1) return { error: "Belum ada draf Report Hasil Pemeriksaan untuk tanggal ini." };

  const row = found.row;
  const now = new Date();
  const rowValues = [
    systemKey, tanggal,
    row[2] || "", row[3] || "", row[4] || "",
    session.nama, session.username, formatDate_(now),
    now,
  ];
  found.sheet.getRange(found.rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

  writeAuditLog_({
    username: session.username, nama: session.nama, role: session.role, departemen: session.departemen,
    aksi: "Approve Report Hasil Pemeriksaan", sistem: cfg.label, bulan: tanggal, detail: "",
  });

  return getReportHasil_(systemKey, tanggal);
}

// ---------------------------------------------------------------------------
// STATUS INDEX  (untuk halaman dashboard rekap 5 sistem)
// ---------------------------------------------------------------------------
function parseNumericValue_(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const str = String(rawValue).trim();
  const m = str.match(/^<\s*([\d.]+)$/);
  if (m) {
    const n = Number(m[1]);
    return isNaN(n) ? null : n - 0.001;
  }
  const n = Number(str.replace(",", "."));
  return isNaN(n) ? null : n;
}

// level: 0=N/A/belum diuji, 1=Terkendali, 2=Alert, 3=Action, 4=Melebihi Syarat
function levelFor_(rawValue, parameter) {
  const limit = LIMITS[parameter];
  if (!limit) return 0;
  if (rawValue === null || rawValue === undefined || rawValue === "") return 0;

  if (limit.qualitative) {
    return String(rawValue).trim() === limit.passValue ? 1 : 4;
  }

  const v = parseNumericValue_(rawValue);
  if (v === null) return 0;

  if (limit.syaratMin !== undefined || limit.syaratMax !== undefined) {
    // Parameter dua arah (pH): syaratMin/Max = batas spesifikasi;
    // alert/actionMin = batas bawah; alert/actionMax = batas atas.
    if (limit.syaratMin !== undefined && v < limit.syaratMin) return 4;
    if (limit.syaratMax !== undefined && v > limit.syaratMax) return 4;
    if (limit.actionMin !== undefined && v <= limit.actionMin) return 3;
    if (limit.actionMax !== undefined && v >= limit.actionMax) return 3;
    if (limit.alertMin !== undefined && v <= limit.alertMin) return 2;
    if (limit.alertMax !== undefined && v >= limit.alertMax) return 2;
    return 1;
  }
  return 0;
}

function getStatusIndex_(month) {
  const out = {};
  Object.keys(SYSTEMS).forEach(function (key) {
    const cfg = SYSTEMS[key];
    const res = getEntries_(key, month);
    const entries = res.entries || [];
    let maxLevel = 0;
    const params = PARAMS_BY_JENIS[cfg.jenis] || [];
    entries.forEach(function (e) {
      params.forEach(function (p) {
        const lvl = levelFor_(e[p], p);
        if (lvl > maxLevel) maxLevel = lvl;
      });
    });
    out[key] = { level: maxLevel, hasData: entries.length > 0 };
  });
  return { month: month, status: out };
}

// ---------------------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------------------
function formatMonth_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM");
  }
  return String(value || "").trim();
}

function formatDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "").trim();
}

function emptyToNull_(value) {
  if (value === "" || value === null || value === undefined) return null;
  return value;
}

function safeParseJSON_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}
