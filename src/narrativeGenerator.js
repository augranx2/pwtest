// Helper module untuk menghasilkan Pembahasan Tren per Parameter dan
// Kesimpulan untuk Pengkajian SPA, meniru gaya bahasa pada contoh dokumen
// Pengkajian PW/WFI/Pure Steam yang sudah ada (rentang nilai, titik & tanggal
// tertinggi/terendah, perbandingan ke Alert/Action Limit, dan interpretasi).

const PARAM_META = {
  konduktivitas: { label: "Konduktivitas", short: "konduktivitas", unit: "µS/cm", huruf: "A" },
  ph: { label: "pH", short: "pH", unit: "", huruf: "B" },
  toc: { label: "Total Organic Carbon (TOC)", short: "TOC", unit: "ppb", huruf: "C" },
  mikrobiologi: { label: "Cemaran Mikrobiologi", short: "cemaran mikrobiologi", unit: "CFU/mL", huruf: "D" },
  endotoksin: { label: "Endotoksin", short: "endotoksin", unit: "EU/mL", huruf: "E" },
};

const PARAMS_BY_JENIS = {
  PW: ["konduktivitas", "ph", "toc", "mikrobiologi"],
  WFI: ["konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
  "Pure Steam": ["konduktivitas", "ph", "toc", "mikrobiologi", "endotoksin"],
};

const LIMITS = {
  konduktivitas: { syaratMax: 2.1, alertMax: 1.67, actionMax: 1.94 },
  toc: { syaratMax: 500, alertMax: 375, actionMax: 450 },
  ph: { syaratMin: 5.00, syaratMax: 7.00, alertMin: 5.39, actionMin: 5.10, alertMax: 6.52, actionMax: 6.80 },
  mikrobiologi: { syaratMax: 100, alertMax: 65, actionMax: 89 },
  endotoksin: { qualitative: true, passValue: "Negatif" },
};

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
function statusFor(rawValue, paramKey) {
  const limit = LIMITS[paramKey];
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
  const limit = LIMITS[paramKey];
  const points = collectPoints(entries, paramKey);

  if (points.length === 0) {
    return `${meta.huruf}. ${meta.label}\nBelum terdapat data ${meta.short} yang tercatat pada periode ini.`;
  }

  if (limit.qualitative) {
    const positif = points.filter((p) => String(p.raw).trim() !== limit.passValue);
    let text = `Seluruh hasil pengujian ${meta.short} pada periode ini menunjukkan hasil ${limit.passValue}, sesuai dengan persyaratan yang ditetapkan (${limit.passValue}).`;
    if (positif.length > 0) {
      const list = positif.map((p) => `${p.titik} (${fullDateID(p.tanggal)}) : ${p.raw}`).join("; ");
      text = `Ditemukan hasil pengujian ${meta.short} dengan status Positif pada ${list}. Hasil ini tidak memenuhi persyaratan (${limit.passValue}) sehingga dikategorikan sebagai penyimpangan dan memerlukan investigasi akar masalah serta pengujian ulang segera.`;
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

  const withStatus = numeric.map((p) => ({ ...p, status: statusFor(p.raw, paramKey) }));
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
      const st = statusFor(p.raw, paramKey);
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
      const curPoints = collectPoints(entries, paramKey).map((p) => statusFor(p.raw, paramKey).level);
      const prevPoints = collectPoints(prevEntries, paramKey).map((p) => statusFor(p.raw, paramKey).level);
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
  }

  const kesimpulan = kesimpulanText(systemLabel, jenisAir, monthLabel, entries, params);

  return { pendahuluan, perParameter, reviewTren, kesimpulan };
}

export { PARAM_META, PARAMS_BY_JENIS, LIMITS, statusFor, parseNumericValue, fullDateID };
