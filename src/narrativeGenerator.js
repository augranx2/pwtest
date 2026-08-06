// Helper module untuk menghasilkan Pembahasan Tren per Parameter dan
// Kesimpulan untuk Pengkajian SPA, meniru gaya bahasa pada contoh dokumen
// Pengkajian PW/WFI/Pure Steam yang sudah ada (rentang nilai, titik & tanggal
// tertinggi/terendah, perbandingan ke Alert/Action Limit, dan interpretasi).

const PARAM_META = {
  kejernihan: { label: "Kejernihan", short: "Kejernihan", unit: "", huruf: "A" },
  warna: { label: "Warna", short: "Warna", unit: "", huruf: "B" },
  bau: { label: "Bau", short: "Bau", unit: "", huruf: "C" },
  konduktivitas: { label: "Konduktivitas", short: "Konduktivitas", unit: "µS/cm", huruf: "D" },
  ph: { label: "pH", short: "pH", unit: "", huruf: "E" },
  toc: { label: "Total Organic Carbon (TOC)", short: "TOC", unit: "ppb", huruf: "F" },
  mikrobiologi: { label: "Cemaran Mikrobiologi", short: "Cemaran Mikrobiologi", unit: "CFU/mL", huruf: "G" },
  endotoksin: { label: "Endotoksin", short: "Endotoksin", unit: "EU/mL", huruf: "H" },
  kontrolPositif: { label: "Kontrol Positif", short: "Kontrol Positif", unit: "", huruf: "I" },
  kontrolNegatif: { label: "Kontrol Negatif", short: "Kontrol Negatif", unit: "", huruf: "J" },
};

// Kontrol Positif/Kontrol Negatif TIDAK lagi per-entri di sini — sekarang
// jadi data MINGGUAN terpisah (lihat QUALI_OPTIONS + weekKeyForISO di bawah),
// berlaku untuk SEMUA sistem termasuk PW (mengikuti Nomor Kontrol
// Media/Bakteri minggu itu, sesuai kontrol uji mikrobiologi mingguan).
const PARAMS_BY_JENIS = {
  PW: ["kejernihan", "warna", "bau", "konduktivitas", "ph", "toc", "mikrobiologi"],
  WFI: ["kejernihan", "warna", "bau", "konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
  "Pure Steam": ["kejernihan", "warna", "bau", "konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
};

const LIMITS = {
  kejernihan: { qualitative: true, passValue: "Jernih" },
  warna: { qualitative: true, passValue: "Tidak Berwarna" },
  bau: { qualitative: true, passValue: "Tidak Berbau" },
  konduktivitas: { syaratMax: 2.1, alertMax: 1.67, actionMax: 1.94 },
  toc: { syaratMax: 500, alertMax: 375, actionMax: 450 },
  ph: { syaratMin: 5.00, syaratMax: 7.00, alertMin: 5.39, actionMin: 5.10, alertMax: 6.52, actionMax: 6.80 },
  mikrobiologi: { syaratMax: 100, alertMax: 65, actionMax: 89 },
  endotoksin: { qualitative: true, passValue: "Negatif" },
  kontrolPositif: { qualitative: true, passValue: "Positif" },
  kontrolNegatif: { qualitative: true, passValue: "Negatif" },
};

// Beberapa parameter punya persyaratan yang BEDA tergantung jenis air —
// mikrobiologi WFI/Pure Steam jauh lebih ketat (≤10 CFU/100ml, sesuai
// Formulir Pemeriksaan WFI FM.QC.063) dibanding PW (≤100 CFU/mL). Kalau
// jenis air + paramKey ada di sini, override ini dipakai; kalau tidak, pakai
// LIMITS di atas (default/umum untuk PW).
const LIMITS_OVERRIDE_BY_JENIS = {
  WFI: {
    mikrobiologi: { syaratMax: 10, alertMax: 6.5, actionMax: 8.9 },
  },
  "Pure Steam": {
    mikrobiologi: { syaratMax: 10, alertMax: 6.5, actionMax: 8.9 },
  },
};

function getLimit(paramKey, jenis) {
  return (jenis && LIMITS_OVERRIDE_BY_JENIS[jenis] && LIMITS_OVERRIDE_BY_JENIS[jenis][paramKey]) || LIMITS[paramKey];
}

// Pilihan dropdown untuk setiap parameter kualitatif (dipakai saat entri data
// di App.jsx) — opsi pertama = hasil yang sesuai persyaratan (passValue).
const QUALI_OPTIONS = {
  kejernihan: ["Jernih", "Tidak Jernih"],
  warna: ["Tidak Berwarna", "Berwarna"],
  bau: ["Tidak Berbau", "Berbau"],
  endotoksin: ["Negatif", "Positif"],
  kontrolPositif: ["Positif", "Negatif"],
  kontrolNegatif: ["Negatif", "Positif"],
};

// --- KONTROL MINGGUAN: perhitungan kunci minggu (WeekKey) ------------------
// Logikanya HARUS sama persis dengan weekKeyForISO_ di Code.gs (backend),
// supaya minggu yang dihitung di layar (panel input) sama dengan minggu yang
// dipakai untuk mencari status/deviasi di dashboard.
//
// Aturan: 1 minggu = blok Senin-Jumat. Kalau blok Senin-Jumat itu memotong 2
// bulan, hari-harinya ikut bulan kalendernya masing-masing — jadi bisa jadi
// minggu TERAKHIR bulan sebelumnya (untuk hari-hari di awal blok) dan minggu
// PERTAMA bulan berikutnya (untuk hari-hari di akhir blok). Akhir pekan yang
// "menempel" ke blok bulan sebelumnya tidak menggeser nomor minggu kerja.
function mondayOf(y, m0, d) {
  const dt = new Date(y, m0, d);
  const dow = dt.getDay(); // 0=Minggu..6=Sabtu
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(y, m0, d + diff);
}

function ymdKeyLocal(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function weekKeyForISO(iso) {
  if (!iso) return null;
  const parts = String(iso).split("-").map(Number);
  const y = parts[0], m0 = parts[1] - 1, day = parts[2];
  if (!y || !parts[1] || !day) return null;
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const seen = [];
  let myBlockKey = null;
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const dow = new Date(y, m0, dd).getDay();
    const blockKey = ymdKeyLocal(mondayOf(y, m0, dd));
    if (dow >= 1 && dow <= 5 && !seen.includes(blockKey)) seen.push(blockKey);
    if (dd === day) myBlockKey = blockKey;
  }
  const weekNum = seen.indexOf(myBlockKey) + 1;
  return { key: `${y}-${String(m0 + 1).padStart(2, "0")}-W${weekNum}`, year: y, month: m0 + 1, weekNum };
}

const MONTH_NAMES_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function weekLabel(wk) {
  if (!wk) return "-";
  return `Minggu ${wk.weekNum} — ${MONTH_NAMES_ID[wk.month - 1]} ${wk.year}`;
}

// --- KONTROL MINGGUAN: cari record yang berlaku -----------------------------
// Nilai Default cukup diisi 1x per BULAN, tapi HANYA berlaku untuk fasilitas
// (sistem) yang mengisinya sendiri — bukan otomatis ke semua fasilitas.
// Kalau di bulan yang sama ada beberapa fasilitas yang looping, masing-
// masing tetap wajib mengisi Default-nya sendiri minimal 1x (walau angkanya
// kebetulan sama dengan fasilitas lain).
// weekKey Default disimpan sebagai "yyyy-MM-W0" (BUKAN "yyyy-MM" polos) —
// supaya tidak berisiko salah dibaca/dikonversi sebagai tanggal oleh Google
// Sheets saat disimpan (itu yang menyebabkan Default kadang "hilang" walau
// datanya ada di spreadsheet). Pengecualian minggu tertentu memakai
// "yyyy-MM-Wn" (n mulai dari 1). Urutan pencarian: pengecualian-minggu
// (sistem ini) > default-bulan (sistem ini). Record yang seluruh isiannya
// kosong dianggap "tidak ada" (dilewati) — dipakai untuk "menghapus" sebuah
// pengecualian tanpa perlu benar-benar hapus baris di sheet.
const KONTROL_MINGGUAN_FIELDS = [
  "noKontrolMedia", "noKontrolBakteri", "kontrolPositif", "kontrolNegatif",
  "kontrolNegatifLAL", "kontrolPositifLAL", "noBetLAL", "noBetCSE", "sensitivitasLAL", "sensitivitasCSE",
];

function isBlankKontrolRecord(rec) {
  if (!rec) return true;
  return KONTROL_MINGGUAN_FIELDS.every((f) => !rec[f]);
}

function monthDefaultWeekKey(monthKey) {
  return `${monthKey}-W0`;
}

function findKontrolMingguan(records, weekKey, systemKey, monthKey) {
  const weekSystem = records.find((r) => r.weekKey === weekKey && r.system === systemKey);
  if (weekSystem && !isBlankKontrolRecord(weekSystem)) return weekSystem;
  const monthDefault = records.find((r) => r.weekKey === monthDefaultWeekKey(monthKey) && r.system === systemKey);
  if (monthDefault && !isBlankKontrolRecord(monthDefault)) return monthDefault;
  return null;
}

function parseNumericValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const str = String(rawValue).trim();
  const m = str.match(/^<\s*([\d.]+)$/);
  if (m) {
    const n = Number(m[1]);
    return Number.isNaN(n) ? null : n - 0.001;
  }
  const n = Number(str.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function fmtNum(v) {
  // Format ala dokumen: pakai koma sebagai desimal, buang trailing zero berlebih.
  if (v === null || v === undefined) return "-";
  const rounded = Math.round(v * 1000) / 1000;
  return String(rounded).replace(".", ",");
}

function displayRaw(raw) {
  // Untuk ditampilkan di narasi: pertahankan "<1" apa adanya (bukan angka
  // hasil epsilon dari parseNumericValue, yang cuma dipakai untuk logika
  // perbandingan internal, bukan untuk ditampilkan ke pengguna).
  if (raw === null || raw === undefined || raw === "") return "-";
  const str = String(raw).trim();
  if (/^<\s*[\d.]+$/.test(str)) return str.replace(/\s+/g, "").replace(".", ",");
  const n = parseNumericValue(raw);
  return n === null ? str : fmtNum(n);
}

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function fullDateID(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[Number(m) - 1] || m} ${y}`;
}

// level: 1=Terkendali, 2=Alert, 3=Action, 4=Melebihi Syarat(penyimpangan)
// arah: "atas" | "bawah" | null (dipakai untuk parameter dua-arah seperti pH)
function statusFor(rawValue, paramKey, jenis) {
  const limit = getLimit(paramKey, jenis);
  if (!limit) return { level: 0 };
  if (rawValue === null || rawValue === undefined || rawValue === "") return { level: 0 };

  if (limit.qualitative) {
    return { level: String(rawValue).trim() === limit.passValue ? 1 : 4 };
  }

  const v = parseNumericValue(rawValue);
  if (v === null) return { level: 0 };

  if (limit.syaratMin !== undefined) {
    // parameter dua arah (pH)
    if (v < limit.syaratMin) return { level: 4, arah: "bawah", value: v };
    if (v > limit.syaratMax) return { level: 4, arah: "atas", value: v };
    if (v <= limit.actionMin) return { level: 3, arah: "bawah", value: v };
    if (v >= limit.actionMax) return { level: 3, arah: "atas", value: v };
    if (v <= limit.alertMin) return { level: 2, arah: "bawah", value: v };
    if (v >= limit.alertMax) return { level: 2, arah: "atas", value: v };
    return { level: 1, value: v };
  }
  // parameter satu arah (konduktivitas/TOC/mikrobiologi) — makin tinggi makin buruk
  if (v > limit.syaratMax) return { level: 4, value: v };
  if (v >= limit.actionMax) return { level: 3, value: v };
  if (v >= limit.alertMax) return { level: 2, value: v };
  return { level: 1, value: v };
}

function collectPoints(entries, paramKey) {
  return entries
    .map((e) => ({ titik: e.titikSampling || "Titik", tanggal: e.tanggal, raw: e[paramKey] }))
    .filter((p) => p.raw !== null && p.raw !== undefined && p.raw !== "");
}

function paramNarrative(paramKey, entries, jenisLabel) {
  const meta = PARAM_META[paramKey];
  const limit = getLimit(paramKey, jenisLabel);
  const points = collectPoints(entries, paramKey);

  if (points.length === 0) {
    return `${meta.huruf}. ${meta.label}\nBelum terdapat data ${meta.short} yang tercatat pada periode ini.`;
  }

  if (limit.qualitative) {
    const positif = points.filter((p) => String(p.raw).trim() !== limit.passValue);
    let text = `Seluruh hasil pengujian ${meta.short} pada periode ini menunjukkan hasil ${limit.passValue}, sesuai dengan persyaratan yang ditetapkan (${limit.passValue}).`;
    if (positif.length > 0) {
      const list = positif.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${p.raw}`).join("; ");
      text = `Ditemukan hasil pengujian ${meta.short} yang tidak sesuai pada ${list}. Hasil ini tidak memenuhi persyaratan (${limit.passValue}) sehingga dikategorikan sebagai penyimpangan dan memerlukan investigasi akar masalah serta pengujian ulang segera.`;
    }
    return `${meta.huruf}. ${meta.label}\n${text}`;
  }

  const numeric = points.map((p) => ({ ...p, value: parseNumericValue(p.raw) })).filter((p) => p.value !== null);
  if (numeric.length === 0) {
    return `${meta.huruf}. ${meta.label}\nBelum terdapat data ${meta.short} yang tercatat pada periode ini.`;
  }
  const values = numeric.map((p) => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const minPoint = numeric.find((p) => p.value === minVal);
  const maxPoint = numeric.find((p) => p.value === maxVal);

  const syaratText = limit.syaratMin !== undefined
    ? `${fmtNum(limit.syaratMin)}–${fmtNum(limit.syaratMax)}`
    : `≤ ${fmtNum(limit.syaratMax)}`;

  const withStatus = numeric.map((p) => ({ ...p, status: statusFor(p.raw, paramKey, jenisLabel) }));
  const outOfSpec = withStatus.filter((p) => p.status.level >= 4);
  const actionPts = withStatus.filter((p) => p.status.level === 3);
  const alertPts = withStatus.filter((p) => p.status.level === 2);

  let text = `Hasil pengujian ${meta.short} selama periode ini berada pada rentang ${displayRaw(minPoint.raw)}${meta.unit ? " " + meta.unit : ""} hingga ${displayRaw(maxPoint.raw)}${meta.unit ? " " + meta.unit : ""}. `;
  text += outOfSpec.length === 0
    ? `Seluruh hasil pengujian masih memenuhi spesifikasi yang ditetapkan (${syaratText}${meta.unit ? " " + meta.unit : ""}). `
    : `Terdapat hasil yang melebihi batas persyaratan/spesifikasi yang ditetapkan (${syaratText}${meta.unit ? " " + meta.unit : ""}) sehingga dikategorikan sebagai penyimpangan. `;

  if (limit.syaratMin !== undefined) {
    // pH — sebut arah atas/bawah secara terpisah
    const alertAtas = alertPts.filter((p) => p.status.arah === "atas");
    const alertBawah = alertPts.filter((p) => p.status.arah === "bawah");
    const actionAtas = actionPts.filter((p) => p.status.arah === "atas");
    const actionBawah = actionPts.filter((p) => p.status.arah === "bawah");
    if (alertAtas.length === 0 && alertBawah.length === 0 && actionAtas.length === 0 && actionBawah.length === 0) {
      text += `Tidak ditemukan hasil yang mencapai maupun melebihi Alert Limit (≤${fmtNum(limit.alertMin)} / ≥${fmtNum(limit.alertMax)}) maupun Action Limit (≤${fmtNum(limit.actionMin)} / ≥${fmtNum(limit.actionMax)}).`;
    } else {
      if (alertAtas.length > 0) {
        text += `\nDitemukan hasil yang mencapai/melebihi Alert Limit batas atas (≥${fmtNum(limit.alertMax)}): ${alertAtas.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}.`;
      }
      if (alertBawah.length > 0) {
        text += `\nDitemukan hasil yang mencapai/melebihi Alert Limit batas bawah (≤${fmtNum(limit.alertMin)}): ${alertBawah.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}.`;
      }
      if (actionAtas.length > 0) {
        text += `\nDitemukan hasil yang mencapai/melebihi Action Limit batas atas (≥${fmtNum(limit.actionMax)}): ${actionAtas.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}.`;
      }
      if (actionBawah.length > 0) {
        text += `\nDitemukan hasil yang mencapai/melebihi Action Limit batas bawah (≤${fmtNum(limit.actionMin)}): ${actionBawah.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}.`;
      }
      text += ` Nilai tersebut masih di bawah batas spesifikasi (${syaratText}) sehingga belum dikategorikan sebagai penyimpangan, namun tetap perlu dicermati pada pengujian periode berikutnya.`;
    }
  } else {
    text += `Nilai tertinggi diperoleh pada ${maxPoint.titik} tanggal ${fullDateID(maxPoint.tanggal)} sebesar ${displayRaw(maxPoint.raw)}${meta.unit ? " " + meta.unit : ""}, sedangkan nilai terendah diperoleh pada ${minPoint.titik} tanggal ${fullDateID(minPoint.tanggal)} sebesar ${displayRaw(minPoint.raw)}${meta.unit ? " " + meta.unit : ""}.`;
    if (actionPts.length > 0) {
      text += ` Ditemukan hasil yang mencapai/melebihi Action Limit (≥${fmtNum(limit.actionMax)}${meta.unit ? " " + meta.unit : ""}) pada ${actionPts.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}. Nilai tersebut masih di bawah batas spesifikasi sehingga belum dikategorikan sebagai penyimpangan, namun perlu dievaluasi lebih lanjut, misalnya dengan meninjau efektivitas sanitasi sistem dan mencermati hasil pada pengujian periode berikutnya.`;
    } else if (alertPts.length > 0) {
      text += ` Ditemukan hasil yang mencapai Alert Limit (≥${fmtNum(limit.alertMax)}${meta.unit ? " " + meta.unit : ""}) pada ${alertPts.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${displayRaw(p.raw)}`).join("; ")}, namun masih di bawah Action Limit sehingga cukup dipantau pada pengujian periode berikutnya.`;
    } else {
      text += ` Tidak ditemukan hasil yang mencapai maupun melebihi Alert Limit (≥${fmtNum(limit.alertMax)}${meta.unit ? " " + meta.unit : ""}) maupun Action Limit (≥${fmtNum(limit.actionMax)}${meta.unit ? " " + meta.unit : ""}).`;
    }
  }

  return `${meta.huruf}. ${meta.label}\n${text}`;
}

function kesimpulanText(systemLabel, jenisAir, monthLabel, entries, params) {
  let anyOutOfSpec = false;
  let anyAlertOrAction = false;
  params.forEach((paramKey) => {
    const points = collectPoints(entries, paramKey);
    points.forEach((p) => {
      const st = statusFor(p.raw, paramKey, jenisAir);
      if (st.level >= 4) anyOutOfSpec = true;
      else if (st.level >= 2) anyAlertOrAction = true;
    });
  });

  const paramNames = params.map((p) => PARAM_META[p].label).join(", ");
  let text = `Berdasarkan hasil pengkajian tren ${jenisAir} ${systemLabel} periode ${monthLabel}, `;
  if (!anyOutOfSpec) {
    text += `seluruh parameter kualitas air yaitu ${paramNames} masih memenuhi spesifikasi yang telah ditetapkan.\n\n`;
    text += anyAlertOrAction
      ? `Terdapat beberapa hasil yang mencapai Alert maupun Action Limit pada periode ini, namun seluruhnya masih berada dalam batas spesifikasi dan belum dikategorikan sebagai penyimpangan. Kondisi ini menunjukkan sistem masih dalam kendali proses normal, dengan catatan perlu terus dipantau pada periode berikutnya.\n\n`
      : `Tidak ditemukan hasil yang mencapai Alert maupun Action Limit pada seluruh parameter, menunjukkan sistem berada dalam kondisi stabil dan terkendali.\n\n`;
    text += `Secara keseluruhan, sistem ${jenisAir} ${systemLabel} pada periode ${monthLabel} dinyatakan masih berada dalam kondisi terkendali, memenuhi persyaratan mutu, dan layak digunakan untuk mendukung proses produksi sesuai ketentuan CPOB.`;
  } else {
    text += `terdapat hasil yang melebihi batas persyaratan/spesifikasi yang ditetapkan pada satu atau lebih parameter, sehingga dikategorikan sebagai penyimpangan.\n\n`;
    text += `Diperlukan investigasi akar masalah, tindakan perbaikan (sanitasi ulang/flushing sesuai kebutuhan), dan pengujian ulang pada titik terkait untuk memastikan sistem kembali ke kondisi terkendali sebelum digunakan lebih lanjut.\n\n`;
    text += `Sistem ${jenisAir} ${systemLabel} pada periode ${monthLabel} memerlukan tindak lanjut dan pemantauan ketat hingga diperoleh hasil yang konsisten memenuhi persyaratan sesuai ketentuan CPOB.`;
  }
  return text;
}

export function generateLocalNarrative({ systemLabel, jenisAir, monthLabel, entries, prevEntries }) {
  const params = PARAMS_BY_JENIS[jenisAir] || PARAMS_BY_JENIS.PW;

  const pendahuluan = `Pengkajian tren kualitas ${jenisAir} untuk periode ${monthLabel} dilakukan berdasarkan hasil pengujian rutin pada titik-titik sampling sistem ${systemLabel}. Pengkajian ini merupakan bagian dari kegiatan ongoing verification sistem utilitas sesuai Standar CPOB tahun 2024 dan 2025 yang berlaku, dengan tujuan memastikan sistem tetap berada dalam kondisi terkendali, stabil, dan mampu menghasilkan air/uap yang memenuhi persyaratan mutu. Evaluasi dilakukan terhadap kesesuaian hasil pengujian dengan spesifikasi yang ditetapkan, serta terhadap Alert Limit dan Action Limit sebagai bagian dari pengendalian tren sistem sehingga potensi penyimpangan dapat dideteksi sejak dini.\n\nParameter yang dievaluasi meliputi: ${params.map((p) => PARAM_META[p].label).join(", ")}.`;

  const perParameter = {};
  params.forEach((paramKey) => {
    perParameter[paramKey] = paramNarrative(paramKey, entries, jenisAir);
  });

  let reviewTren = "";
  if (prevEntries && prevEntries.length > 0) {
    const lines = params.map((paramKey) => {
      const curPoints = collectPoints(entries, paramKey).map((p) => statusFor(p.raw, paramKey, jenisAir).level);
      const prevPoints = collectPoints(prevEntries, paramKey).map((p) => statusFor(p.raw, paramKey, jenisAir).level);
      const curNoted = curPoints.filter((l) => l >= 2).length;
      const prevNoted = prevPoints.filter((l) => l >= 2).length;
      const meta = PARAM_META[paramKey];
      if (curNoted === 0 && prevNoted === 0) {
        return `Pada parameter ${meta.short}, hasil pengujian periode ini maupun periode sebelumnya sama-sama tidak menunjukkan hasil yang mencapai Alert/Action Limit, menunjukkan kondisi yang stabil dan konsisten.`;
      }
      if (curNoted <= prevNoted) {
        return `Pada parameter ${meta.short}, jumlah titik yang mencapai Alert/Action Limit pada periode ini (${curNoted} titik) tidak lebih banyak dibanding periode sebelumnya (${prevNoted} titik), menunjukkan kondisi yang stabil atau membaik.`;
      }
      return `Pada parameter ${meta.short}, jumlah titik yang mencapai Alert/Action Limit pada periode ini (${curNoted} titik) meningkat dibanding periode sebelumnya (${prevNoted} titik), sehingga perlu dicermati lebih lanjut pada periode berikutnya.`;
    });
    reviewTren = `Berdasarkan hasil evaluasi tren ${jenisAir} ${systemLabel} periode ${monthLabel} dibandingkan dengan periode sebelumnya:\n\n${lines.join("\n\n")}\n\nSecara keseluruhan, hasil review tren menunjukkan bahwa sistem ${systemLabel} masih berada dalam kondisi terkendali dibandingkan periode sebelumnya.`;
  } else {
    // Belum ada data periode sebelumnya — tetap rangkum hasil periode ini
    // sendiri, dan jelaskan kenapa perbandingan tren belum bisa dilakukan,
    // alih-alih membiarkan bagian ini kosong.
    const noted = params.flatMap((paramKey) =>
      collectPoints(entries, paramKey).filter((p) => statusFor(p.raw, paramKey, jenisAir).level >= 2).map(() => paramKey)
    );
    const ringkasan = noted.length === 0
      ? `seluruh parameter (${params.map((p) => PARAM_META[p].label).join(", ")}) berada dalam kondisi terkendali tanpa hasil yang mencapai Alert maupun Action Limit`
      : `terdapat beberapa hasil yang mencapai Alert/Action Limit pada parameter ${Array.from(new Set(noted)).map((p) => PARAM_META[p].short).join(", ")}, namun secara umum sistem masih berada dalam kondisi terkendali`;
    reviewTren = `Untuk periode ${monthLabel}, hasil pengujian ${jenisAir} ${systemLabel} menunjukkan bahwa ${ringkasan}.\n\nPerbandingan tren dengan periode sebelumnya belum dapat dijelaskan lebih detail karena data periode sebelumnya belum tersedia di sistem. Review tren dibanding periode sebelumnya akan dapat disusun mulai periode berikutnya, setelah data bulan ini tersimpan sebagai pembanding.`;
  }

  const kesimpulan = kesimpulanText(systemLabel, jenisAir, monthLabel, entries, params);

  return { pendahuluan, perParameter, reviewTren, kesimpulan };
}

export { PARAM_META, PARAMS_BY_JENIS, LIMITS, getLimit, QUALI_OPTIONS, statusFor, parseNumericValue, fullDateID, weekKeyForISO, weekLabel, findKontrolMingguan, monthDefaultWeekKey, KONTROL_MINGGUAN_FIELDS };
