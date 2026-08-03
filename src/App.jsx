import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import {
  ChevronLeft, Plus, Trash2, Printer, Loader2, Sparkles,
  AlertTriangle, CheckCircle2, Droplet, LogIn, LogOut, User, History, Lock,
} from "lucide-react";
import {
  fetchEntries, saveEntries as apiSaveEntries,
  fetchReport, saveReport as apiSaveReport, fetchStatusIndex,
  generateNarrative, approveDikaji as apiApproveDikaji,
  approveMengetahui as apiApproveMengetahui, fetchActivityLog,
  fetchReportHasil, saveReportHasil as apiSaveReportHasil, approveReportHasil as apiApproveReportHasil,
  changePassword as apiChangePassword,
} from "./api.js";
import { generateLocalNarrative, PARAM_META, PARAMS_BY_JENIS, LIMITS, statusFor, parseNumericValue, fullDateID } from "./narrativeGenerator.js";
import { useAuth, hasAccess } from "./auth.js";

// Sistem air TETAP (harus persis sinkron dengan SYSTEMS di Code.gs)
const SYSTEMS = [
  {
    key: "pw_nbl", jenis: "PW", label: "Purified Water — NBL", fasilitas: "Looping Non Betalaktam (NBL)",
    points: ["SV 49-03C", "SV 60-03C",
      "POU-1", "POU-2", "POU-3", "POU-4", "POU-5", "POU-6", "POU-7", "POU-8", "POU-9", "POU-10",
      "POU-11", "POU-12", "POU-13", "POU-14", "POU-15", "POU-16", "POU-17", "POU-18", "POU-19", "POU-20"],
  },
  {
    key: "pw_sefalosporin", jenis: "PW", label: "Purified Water — Sefalosporin", fasilitas: "Looping Sefalosporin",
    points: ["SV 60-02C", "SP-23", "SP-24",
      "POU-01", "POU-02", "POU-03", "POU-04", "POU-05", "POU-06", "POU-07", "POU-08", "POU-09", "POU-10",
      "POU-11", "POU-12", "POU-13", "POU-14", "POU-15", "POU-16", "POU-17", "POU-18", "POU-19", "POU-20"],
  },
  {
    key: "pw_betalaktam", jenis: "PW", label: "Purified Water — Betalaktam", fasilitas: "Looping Betalaktam (BL)",
    points: ["POU-1", "POU-2"],
  },
  {
    key: "wfi_sefalosporin", jenis: "WFI", label: "Water For Injection — Sefalosporin", fasilitas: "Looping Sefalosporin",
    points: ["Tank WFI", "POU-1", "POU-2", "POU-3", "Return WFI"],
  },
  {
    key: "ps_sefalosporin_steril", jenis: "Pure Steam", label: "Pure Steam — Sefalosporin Steril", fasilitas: "Sefalosporin Steril",
    points: ["PS-1"],
  },
];

function uid() {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

const MONTHS_ID_FULL = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function monthLabel(monthKey) {
  if (!monthKey) return "";
  const [y, m] = monthKey.split("-");
  return `${MONTHS_ID_FULL[Number(m) - 1] || m} ${y}`;
}
function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = String(iso).split("-");
  return `${d}/${m}`;
}
function prevMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function displayValue(raw) {
  if (raw === null || raw === undefined || raw === "") return "-";
  const str = String(raw).trim();
  if (/^<\s*[\d.]+$/.test(str)) return str.replace(/\s+/g, "");
  return str;
}

/* ========================================================================= QR VERIFIKASI TANDA TANGAN */
function buildVerifyUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${window.location.origin}/verify?${qs}`;
}

function VerifyQR({ type, system, period, slot, size = 64 }) {
  const params = type === "reportHasil"
    ? { type, system, tanggal: period, slot }
    : { type, system, month: period, slot };
  const url = buildVerifyUrl(params);
  return (
    <div className="flex flex-col items-center gap-1">
      <QRCodeSVG value={url} size={size} level="M" bgColor="#ffffff" fgColor="#0f172a" />
      <span className="text-center text-[9px] leading-tight text-slate-400">Scan untuk verifikasi</span>
    </div>
  );
}

/* ========================================================================= AUTO-RESIZE TEXTAREA (dengan versi khusus cetak/PDF) */
function AutoTextarea({ value, onChange, rows = 3, placeholder, className, readOnly = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  const printClassName = (className || "")
    .split(" ")
    .filter((c) => c && !c.startsWith("focus:") && !c.startsWith("border") && !c.startsWith("ring") && c !== "rounded-lg")
    .join(" ");
  return (
    <>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        readOnly={readOnly}
        className={`only-screen ${className} ${readOnly ? "bg-slate-50 text-slate-500" : ""}`}
        style={{ overflow: "hidden", resize: "none" }}
      />
      <div className={`only-print whitespace-pre-wrap text-justify border-0 ${printClassName}`}>
        {value || <span className="text-slate-300">-</span>}
      </div>
    </>
  );
}

/* ========================================================================= STATUS PILL */
function StatusPill({ level, hasData }) {
  if (!hasData) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
        Belum ada data
      </span>
    );
  }
  if (level >= 4) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#fee2e2", color: "#b91c1c" }}>
        <AlertTriangle size={13} /> Melebihi Syarat
      </span>
    );
  }
  if (level === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#ffedd5", color: "#c2410c" }}>
        <AlertTriangle size={13} /> Terkendali (Perlu Perhatian)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "#dcfce7", color: "#15803d" }}>
      <CheckCircle2 size={13} /> Terkendali
    </span>
  );
}

/* ========================================================================= GRAFIK TREN PER PARAMETER */
function ParamChart({ entries, paramKey, systemLabel }) {
  const meta = PARAM_META[paramKey];
  const limit = LIMITS[paramKey];
  if (!limit || limit.qualitative) return null;

  const pointCounts = {};
  entries.forEach((e) => { pointCounts[e.titikSampling] = (pointCounts[e.titikSampling] || 0) + 1; });

  const outlierCutoff = limit.syaratMax !== undefined ? Math.max(limit.syaratMax * 5, 100) : 1000;
  let excludedCount = 0;
  const data = entries
    .map((e) => {
      const raw = e[paramKey];
      if (raw === null || raw === undefined || raw === "") return null;
      const v = parseNumericValue(raw);
      if (v === null) return null;
      if (limit.syaratMin === undefined && v > outlierCutoff) { excludedCount += 1; return null; }
      const label = pointCounts[e.titikSampling] > 1 ? `${e.titikSampling} (${shortDate(e.tanggal)})` : e.titikSampling;
      return { label, value: v };
    })
    .filter(Boolean);
  if (data.length === 0) return null;

  const isBidirectional = limit.syaratMin !== undefined;
  let domain;
  if (isBidirectional) {
    const lo = Math.min(limit.syaratMin, ...data.map((d) => d.value));
    const hi = Math.max(limit.syaratMax, ...data.map((d) => d.value));
    const pad = (hi - lo) * 0.15 || 0.5;
    domain = [lo - pad, hi + pad];
  } else {
    domain = [0, Math.max(limit.syaratMax, ...data.map((d) => d.value)) * 1.2];
  }

  return (
    <div className="avoid-break overflow-hidden rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold text-slate-500">{meta.label} — {systemLabel}</p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 26, right: 15, left: 15, bottom: 55 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={70} />
          <YAxis domain={domain} tick={{ fontSize: 11 }} width={42} />
          <Tooltip />
          {isBidirectional ? (
            <>
              <ReferenceLine y={limit.syaratMax} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Syarat", fontSize: 10, fill: "#dc2626", position: "insideTopRight" }} />
              <ReferenceLine y={limit.actionMax} stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Action", fontSize: 10, fill: "#f97316", position: "insideTopRight" }} />
              <ReferenceLine y={limit.alertMax} stroke="#eab308" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Alert", fontSize: 10, fill: "#eab308", position: "insideTopRight" }} />
              <ReferenceLine y={limit.alertMin} stroke="#eab308" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Alert", fontSize: 10, fill: "#eab308", position: "insideBottomRight" }} />
              <ReferenceLine y={limit.actionMin} stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Action", fontSize: 10, fill: "#f97316", position: "insideBottomRight" }} />
              <ReferenceLine y={limit.syaratMin} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Syarat", fontSize: 10, fill: "#dc2626", position: "insideBottomRight" }} />
            </>
          ) : (
            <>
              <ReferenceLine y={limit.syaratMax} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Syarat", fontSize: 10, fill: "#dc2626", position: "insideTopRight" }} />
              <ReferenceLine y={limit.actionMax} stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Action", fontSize: 10, fill: "#f97316", position: "insideTopRight" }} />
              <ReferenceLine y={limit.alertMax} stroke="#eab308" strokeWidth={1.5} strokeDasharray="5 4" label={{ value: "Alert", fontSize: 10, fill: "#eab308", position: "insideTopRight" }} />
            </>
          )}
          <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3, fill: "#16a34a" }} label={{ position: "top", fontSize: 10, fill: "#166534" }} />
        </LineChart>
      </ResponsiveContainer>
      {excludedCount > 0 && (
        <p className="mt-1 text-xs italic text-amber-600">
          * {excludedCount} titik data dengan nilai tidak wajar (di luar skala grafik) tidak ditampilkan di sini — cek nilainya di tabel di atas.
        </p>
      )}
    </div>
  );
}

/* ========================================================================= INPUT DATA (EntryEditor) */
function EntryRow({ entry, points, params, readOnly, canDelete, onChange, onDelete }) {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-2 py-1.5">
        <input type="date" disabled={readOnly} className="w-36 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
          value={entry.tanggal || ""} onChange={(ev) => onChange({ ...entry, tanggal: ev.target.value })} />
      </td>
      <td className="px-2 py-1.5">
        <select disabled={readOnly} className="w-40 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
          value={entry.titikSampling || ""} onChange={(ev) => onChange({ ...entry, titikSampling: ev.target.value })}>
          <option value="">-- pilih titik --</option>
          {points.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      {params.map((p) => (
        <td key={p} className="px-2 py-1.5">
          {p === "endotoksin" ? (
            <select disabled={readOnly} className="w-24 rounded border border-slate-200 px-2 py-1 text-center text-sm disabled:bg-slate-50"
              value={entry[p] || ""} onChange={(ev) => onChange({ ...entry, [p]: ev.target.value })}>
              <option value="">-</option>
              <option value="Negatif">Negatif</option>
              <option value="Positif">Positif</option>
            </select>
          ) : (
            <input type="text" disabled={readOnly} className="w-20 rounded border border-slate-200 px-2 py-1 text-center text-sm disabled:bg-slate-50"
              placeholder="-" value={entry[p] === null || entry[p] === undefined ? "" : entry[p]}
              onChange={(ev) => {
                const raw = ev.target.value.trim();
                onChange({ ...entry, [p]: raw === "-" ? null : raw });
              }} />
          )}
        </td>
      ))}
      <td className="px-2 py-1.5 text-center">
        {canDelete && (
          <button onClick={onDelete} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Hapus baris">
            <Trash2 size={15} />
          </button>
        )}
      </td>
    </tr>
  );
}

function EntryEditor({ system, entries, setEntries, onSave, saving, canInput = false, canDeleteExisting = false, accessNote }) {
  const params = PARAMS_BY_JENIS[system.jenis] || [];
  const addRow = () => {
    // Tanggal baris baru ikut tanggal baris paling atas (data terakhir yang
    // barusan diinput), bukan selalu tanggal hari ini — menghemat waktu saat
    // input data historis/bulanan dalam jumlah banyak.
    const defaultTanggal = entries[0]?.tanggal || todayISO();
    const blank = { id: uid(), tanggal: defaultTanggal, titikSampling: "" };
    params.forEach((p) => { blank[p] = ""; });
    setEntries([blank, ...entries]);
  };
  const isExistingRow = (e) => typeof e.id === "string" && e.id.startsWith("row-");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Input Data Bulanan</h3>
        {canInput ? (
          <div className="flex gap-2">
            <button onClick={addRow} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <Plus size={14} /> Tambah Baris
            </button>
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Data Periode Ini
            </button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
            <Lock size={12} /> {accessNote || "Mode lihat saja"}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          {canInput ? 'Belum ada baris. Klik "Tambah Baris" untuk mulai input data titik sampling periode ini.' : "Belum ada data untuk periode ini."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-2 py-1.5">Tanggal</th><th className="px-2 py-1.5">Titik Sampling</th>
                {params.map((p) => <th key={p} className="px-2 py-1.5">{PARAM_META[p].short}{PARAM_META[p].unit ? ` (${PARAM_META[p].unit})` : ""}</th>)}
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => (
                <EntryRow key={e.id} entry={e} points={system.points} params={params}
                  readOnly={!canInput}
                  canDelete={canDeleteExisting || !isExistingRow(e)}
                  onChange={(next) => { const c = entries.slice(); c[idx] = next; setEntries(c); }}
                  onDelete={() => setEntries(entries.filter((_, i) => i !== idx))} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canInput && (
        <p className="mt-2 text-xs text-slate-400">
          Isi "-" untuk parameter yang tidak diuji. Titik sampling yang sama boleh muncul lebih dari satu kali dengan tanggal berbeda.
          {!canDeleteExisting && " Baris yang sudah tersimpan tidak bisa dihapus — hubungi Supervisor/Manager QC atau QA untuk menghapus."}
        </p>
      )}
    </div>
  );
}

/* ========================================================================= HELPERS: STATUS & STATS UNTUK AI */
function systemOverallLevel(entries, jenis) {
  let maxLevel = 0;
  const params = PARAMS_BY_JENIS[jenis] || [];
  entries.forEach((e) => {
    params.forEach((p) => {
      const st = statusFor(e[p], p);
      if (st.level > maxLevel) maxLevel = st.level;
    });
  });
  return maxLevel;
}

function buildStatsSummary(system, entries) {
  const params = PARAMS_BY_JENIS[system.jenis] || [];
  const stats = {};
  params.forEach((paramKey) => {
    const meta = PARAM_META[paramKey];
    const limit = LIMITS[paramKey];
    const points = entries
      .map((e) => ({ titik: e.titikSampling, tanggal: e.tanggal, raw: e[paramKey] }))
      .filter((p) => p.raw !== null && p.raw !== undefined && p.raw !== "");

    if (limit.qualitative) {
      const positif = points.filter((p) => String(p.raw).trim() !== limit.passValue);
      stats[paramKey] = { label: meta.label, qualitative: true, totalTitik: points.length, positif: positif.map((p) => ({ titik: p.titik, tanggal: p.tanggal, hasil: p.raw })) };
      return;
    }

    const numeric = points.map((p) => ({ ...p, value: parseNumericValue(p.raw) })).filter((p) => p.value !== null);
    const noted = numeric.filter((p) => statusFor(p.raw, paramKey).level >= 2)
      .map((p) => ({ titik: p.titik, tanggal: p.tanggal, hasil: displayValue(p.raw), level: statusFor(p.raw, paramKey).level >= 4 ? "Melebihi Syarat" : statusFor(p.raw, paramKey).level === 3 ? "Action" : "Alert" }));

    stats[paramKey] = {
      label: meta.label, unit: meta.unit,
      limit: limit.syaratMin !== undefined
        ? { syaratMin: limit.syaratMin, syaratMax: limit.syaratMax, alertMin: limit.alertMin, actionMin: limit.actionMin, alertMax: limit.alertMax, actionMax: limit.actionMax }
        : { syaratMax: limit.syaratMax, alertMax: limit.alertMax, actionMax: limit.actionMax },
      rentang: numeric.length > 0 ? { min: displayValue(points.find((p) => p.value === Math.min(...numeric.map((n) => n.value)))?.raw), max: displayValue(points.find((p) => p.value === Math.max(...numeric.map((n) => n.value)))?.raw) } : null,
      totalTitik: points.length,
      catatan: noted,
    };
  });
  return stats;
}

/* ========================================================================= DASHBOARD */
function Dashboard({ monthKey, setMonthKey, statusIndex, loadingStatus, statusError, onOpen }) {
  const perluCount = SYSTEMS.filter((s) => (statusIndex[s.key]?.level || 0) === 3).length;
  const tmsCount = SYSTEMS.filter((s) => (statusIndex[s.key]?.level || 0) >= 4).length;
  return (
    <div>
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-blue-900">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">PT. Rama Emerald Multi Sukses — QA</p>
          <h1 className="text-2xl font-bold text-white">Dashboard SPA — Sistem Pengolahan Air</h1>
          <p className="mt-1 text-sm text-blue-100">Rekap pengkajian trend Purified Water, Water For Injection, dan Pure Steam</p>
        </div>
      </div>
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex justify-end">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Periode</label>
            <input type="month" value={monthKey} onChange={(ev) => setMonthKey(ev.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>

        {statusError && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{statusError}</p>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl bg-blue-800 p-4 text-white">
            <p className="text-xs font-medium text-blue-100">Total Sistem</p>
            <p className="text-2xl font-bold">{SYSTEMS.length}</p>
          </div>
          <div className="rounded-xl bg-emerald-700 p-4 text-white">
            <p className="text-xs font-medium text-emerald-100">Terkendali</p>
            <p className="text-2xl font-bold">{SYSTEMS.filter((s) => statusIndex[s.key]?.hasData && (statusIndex[s.key]?.level || 0) < 3).length}</p>
          </div>
          <div className="rounded-xl bg-orange-600 p-4 text-white">
            <p className="text-xs font-medium text-orange-100">Terkendali (Perlu Perhatian)</p>
            <p className="text-2xl font-bold">{perluCount}</p>
          </div>
          <div className="rounded-xl bg-red-700 p-4 text-white">
            <p className="text-xs font-medium text-red-100">Melebihi Syarat</p>
            <p className="text-2xl font-bold">{tmsCount}</p>
          </div>
          <div className="rounded-xl bg-slate-600 p-4 text-white">
            <p className="text-xs font-medium text-slate-200">Belum Ada Data</p>
            <p className="text-2xl font-bold">{SYSTEMS.filter((s) => !statusIndex[s.key]?.hasData).length}</p>
          </div>
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sistem — {monthLabel(monthKey)}</p>
        <div className="space-y-2.5">
          {SYSTEMS.map((s) => {
            const st = statusIndex[s.key];
            return (
              <button key={s.key} onClick={() => onOpen(s.key)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Droplet size={19} /></span>
                  <div>
                    <p className="font-semibold text-slate-800">{s.label}</p>
                    <p className="text-xs text-slate-400">{loadingStatus ? "Memuat..." : st?.hasData ? "Ada data periode ini" : "Belum ada data periode ini"}</p>
                  </div>
                </div>
                {loadingStatus ? <Loader2 className="animate-spin text-slate-300" size={18} /> : <StatusPill level={st?.level || 0} hasData={!!st?.hasData} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= REPORT HASIL PEMERIKSAAN (formulir QC fisik yang didigitalkan) */
function ReportHasilPanel({ systemKey, entriesForMonth, monthKey, session, token, onBack }) {
  const system = SYSTEMS.find((s) => s.key === systemKey);
  const params = PARAMS_BY_JENIS[system.jenis] || [];
  const [tanggal, setTanggal] = useState("");
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const canInput = hasAccess(session, "Staff", "QC");
  const canApprove = hasAccess(session, "Supervisor", "QC");

  const availableDates = useMemo(() => {
    const set = new Set(entriesForMonth.map((e) => e.tanggal).filter(Boolean));
    return Array.from(set).sort();
  }, [entriesForMonth]);

  useEffect(() => {
    if (!tanggal && availableDates.length > 0) setTanggal(availableDates[availableDates.length - 1]);
  }, [availableDates, tanggal]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!tanggal) return;
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await fetchReportHasil(systemKey, tanggal);
        if (cancelled) return;
        setMeta(res);
      } catch (err) {
        if (!cancelled) setErrorMsg("Gagal memuat Report Hasil Pemeriksaan: " + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [systemKey, tanggal]);

  const pointsThisDate = useMemo(
    () => entriesForMonth.filter((e) => e.tanggal === tanggal),
    [entriesForMonth, tanggal]
  );

  async function handleSave() {
    setSaving(true);
    setErrorMsg("");
    try {
      const res = await apiSaveReportHasil(systemKey, tanggal, token);
      if (res.error) throw new Error(res.error);
      setMeta(res);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setErrorMsg("");
    try {
      const res = await apiApproveReportHasil(systemKey, tanggal, token);
      if (res.error) throw new Error(res.error);
      setMeta(res);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setApproving(false);
    }
  }

  const analis = meta?.analis || { nama: "", tanggal: "" };
  const diperiksa = meta?.diperiksa || { nama: "", tanggal: "" };
  const isApproved = !!diperiksa.nama;

  return (
    <div className="mx-auto max-w-5xl p-6 print:max-w-none print:p-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ChevronLeft size={16} /> Kembali ke Pengkajian SPA
        </button>
        <div className="flex items-center gap-2">
          <select value={tanggal} onChange={(ev) => setTanggal(ev.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {availableDates.length === 0 && <option value="">Belum ada tanggal</option>}
            {availableDates.map((d) => <option key={d} value={d}>{fullDateID(d)}</option>)}
          </select>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900">
            <Printer size={15} /> Cetak / Download PDF
          </button>
        </div>
      </div>

      {errorMsg && <p className="no-print mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{errorMsg}</p>}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Memuat...</p>
      ) : !tanggal ? (
        <p className="py-10 text-center text-sm text-slate-400">Belum ada data pengujian untuk periode ini. Isi dulu di halaman Input Data.</p>
      ) : (
        <div className="rounded-xl border border-slate-300 bg-white p-6 print-card">
          <div className="mb-4 flex items-start justify-between border-b border-slate-300 pb-4">
            <div className="flex items-center gap-3">
              <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-14 w-14 shrink-0 object-contain" />
              <div>
                <p className="text-xs font-semibold text-slate-500">PT. Rama Emerald Multi Sukses</p>
                <h2 className="text-lg font-bold uppercase text-slate-800">Formulir Pemeriksaan {system.jenis}</h2>
              </div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <p><span className="text-slate-500">Sistem</span> : <span className="font-medium">{system.label}</span></p>
            <p><span className="text-slate-500">Tanggal Pemeriksaan</span> : <span className="font-medium">{fullDateID(tanggal)}</span></p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border border-slate-300 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <th className="border border-slate-300 px-2 py-1.5">Titik Sampling</th>
                  {params.map((p) => (
                    <th key={p} className="border border-slate-300 px-2 py-1.5">{PARAM_META[p].short}{PARAM_META[p].unit ? ` (${PARAM_META[p].unit})` : ""}</th>
                  ))}
                  <th className="border border-slate-300 px-2 py-1.5">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {pointsThisDate.length === 0 ? (
                  <tr><td colSpan={params.length + 2} className="border border-slate-300 px-2 py-3 text-center text-slate-400">Belum ada data untuk tanggal ini.</td></tr>
                ) : pointsThisDate.map((e) => {
                  let maxLevel = 0;
                  params.forEach((p) => { const st = statusFor(e[p], p); if (st.level > maxLevel) maxLevel = st.level; });
                  const ket = maxLevel >= 4 ? "TMS" : maxLevel === 0 ? "-" : "MS";
                  return (
                    <tr key={e.id}>
                      <td className="border border-slate-300 px-2 py-1.5 font-medium">{e.titikSampling}</td>
                      {params.map((p) => <td key={p} className="border border-slate-300 px-2 py-1.5 text-center">{displayValue(e[p])}</td>)}
                      <td className={`border border-slate-300 px-2 py-1.5 text-center font-semibold ${ket === "TMS" ? "text-red-600" : "text-emerald-600"}`}>{ket}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Diperiksa oleh</p>
              <div className="mb-2 flex h-24 items-center justify-center rounded border border-dashed border-slate-300 print:h-28">
                {analis.nama ? (
                  <VerifyQR type="reportHasil" system={systemKey} period={tanggal} slot="analis" size={64} />
                ) : (
                  <span className="only-screen text-xs text-slate-300">Ruang tanda tangan</span>
                )}
              </div>
              <p className="text-sm font-medium">{analis.nama || "-"}</p>
              <p className="text-xs text-slate-400">{analis.tanggal ? fullDateID(analis.tanggal) : ""}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Mengetahui</p>
              <div className="mb-2 flex h-24 items-center justify-center rounded border border-dashed border-slate-300 print:h-28">
                {diperiksa.nama ? (
                  <VerifyQR type="reportHasil" system={systemKey} period={tanggal} slot="diperiksa" size={64} />
                ) : (
                  <span className="only-screen text-xs text-slate-300">Ruang tanda tangan</span>
                )}
              </div>
              <p className="text-sm font-medium">{diperiksa.nama || "-"}</p>
              <p className="text-xs text-slate-400">{diperiksa.tanggal ? fullDateID(diperiksa.tanggal) : ""}</p>
            </div>
          </div>

          <div className="no-print mt-6 flex justify-end gap-2">
            {canInput && !isApproved && (
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null} {analis.nama ? "Perbarui" : "Tandatangani (Diperiksa oleh)"}
              </button>
            )}
            {canApprove && !isApproved && analis.nama && (
              <button onClick={handleApprove} disabled={approving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                {approving ? <Loader2 size={14} className="animate-spin" /> : null} Setujui (Mengetahui)
              </button>
            )}
            {isApproved && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
                <CheckCircle2 size={15} /> Sudah disetujui
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= LEGEND */
function LegendRow() {
  const items = [
    { label: "Terkendali", bg: "#dcfce7", color: "#15803d" },
    { label: "Alert", bg: "#fef3c7", color: "#b45309" },
    { label: "Action", bg: "#ffedd5", color: "#c2410c" },
    { label: "Melebihi Syarat", bg: "#fee2e2", color: "#b91c1c" },
    { label: "N/A / Belum diuji", bg: "#f1f5f9", color: "#64748b" },
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.bg, border: `1px solid ${it.color}` }} />
          <span className="text-slate-600">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function emptyNarrative() {
  return { pendahuluan: "", perParameter: {}, reviewTren: "", kesimpulan: "" };
}
function emptySignoff() {
  return { dinilai: { nama: "", jabatan: "", tanggal: "" }, diperiksa: { nama: "", jabatan: "", tanggal: "" } };
}

/* ========================================================================= SYSTEM DETAIL (halaman Pengkajian SPA) */
function SystemDetail({ systemKey, monthKey, setMonthKey, onBack, onSaved, session, token }) {
  const system = SYSTEMS.find((s) => s.key === systemKey);
  const params = PARAMS_BY_JENIS[system.jenis] || [];

  const canInputQC = hasAccess(session, "Staff", "QC") || hasAccess(session, "Supervisor", "QA");
  const canDeleteQC = hasAccess(session, "Supervisor", "QC") || hasAccess(session, "Supervisor", "QA");
  const canEditQA = hasAccess(session, "Supervisor", "QA");
  const canApproveFinal = hasAccess(session, "Manager", "QA");
  const isAdmin = session?.role === "Administrator";
  const isQA = isAdmin || session?.departemen === "QA";
  const isQC = isAdmin || session?.departemen === "QC";
  const [mode, setMode] = useState("pengkajian"); // 'pengkajian' | 'reportHasil'

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [entries, setEntries] = useState([]);
  const [narrative, setNarrative] = useState(emptyNarrative());
  const [signoff, setSignoff] = useState(emptySignoff());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [ent, rep] = await Promise.all([
          fetchEntries(systemKey, monthKey),
          fetchReport(systemKey, monthKey),
        ]);
        if (cancelled) return;
        setEntries(ent.map((e) => ({ ...e, id: e.id || uid() })));
        if (rep.found) {
          setNarrative({ ...emptyNarrative(), ...rep.narrative });
          setSignoff(rep.signoff || emptySignoff());
        } else {
          setNarrative(emptyNarrative());
          setSignoff(emptySignoff());
        }
      } catch (err) {
        if (!cancelled) setLoadError("Gagal memuat data dari spreadsheet: " + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [systemKey, monthKey]);

  const overallLevel = systemOverallLevel(entries, system.jenis);

  const reloadReport = useCallback(async () => {
    try {
      const rep = await fetchReport(systemKey, monthKey);
      if (rep.found) {
        setNarrative({ ...emptyNarrative(), ...rep.narrative });
        setSignoff(rep.signoff || emptySignoff());
      }
    } catch {
      // biarkan, bukan blocking error
    }
  }, [systemKey, monthKey]);

  const saveEntriesOnly = useCallback(async () => {
    setSaving(true);
    setSaveError("");
    try {
      await apiSaveEntries(systemKey, monthKey, entries, token);
      onSaved && onSaved();
    } catch (err) {
      setSaveError("Gagal menyimpan data: " + err.message);
    } finally {
      setSaving(false);
    }
  }, [systemKey, monthKey, entries, token, onSaved]);

  const saveNarrativeOnly = useCallback(async () => {
    setSaving(true);
    setSaveError("");
    try {
      await apiSaveReport(systemKey, monthKey, narrative, token);
      onSaved && onSaved();
    } catch (err) {
      setSaveError("Gagal menyimpan narasi: " + err.message);
    } finally {
      setSaving(false);
    }
  }, [systemKey, monthKey, narrative, token, onSaved]);

  const handleApproveDikaji = useCallback(async () => {
    setApproving(true);
    setSaveError("");
    try {
      await apiApproveDikaji(systemKey, monthKey, token);
      await reloadReport();
      onSaved && onSaved();
    } catch (err) {
      setSaveError("Gagal menyetujui: " + err.message);
    } finally {
      setApproving(false);
    }
  }, [systemKey, monthKey, token, reloadReport, onSaved]);

  const handleApproveMengetahui = useCallback(async () => {
    setApproving(true);
    setSaveError("");
    try {
      await apiApproveMengetahui(systemKey, monthKey, token);
      await reloadReport();
      onSaved && onSaved();
    } catch (err) {
      setSaveError("Gagal menyetujui: " + err.message);
    } finally {
      setApproving(false);
    }
  }, [systemKey, monthKey, token, reloadReport, onSaved]);

  async function handleGenerateNarrative(useAI = true) {
    setGenerating(true);
    setAiError("");
    const localRes = generateLocalNarrative({
      systemLabel: system.label, jenisAir: system.jenis, monthLabel: monthLabel(monthKey), entries,
    });

    if (!useAI) {
      setNarrative((prev) => ({
        ...prev, pendahuluan: localRes.pendahuluan,
        perParameter: { ...prev.perParameter, ...localRes.perParameter },
        reviewTren: localRes.reviewTren, kesimpulan: localRes.kesimpulan,
      }));
      setGenerating(false);
      return;
    }

    try {
      const stats = buildStatsSummary(system, entries);
      let prevSummary = "Tidak ada data periode sebelumnya.";
      try {
        const prevRep = await fetchReport(systemKey, prevMonthKey(monthKey));
        if (prevRep.found) prevSummary = prevRep.narrative?.kesimpulan || "Ada data periode sebelumnya, namun tanpa ringkasan tertulis.";
      } catch {
        // biarkan default
      }
      const parsed = await generateNarrative({
        systemLabel: system.label, jenisAir: system.jenis, monthLabel: monthLabel(monthKey), stats, prevSummary,
      });
      setNarrative((prev) => ({
        ...prev, pendahuluan: localRes.pendahuluan,
        perParameter: { ...prev.perParameter, ...parsed.perParameter },
        reviewTren: localRes.reviewTren, kesimpulan: parsed.kesimpulan || localRes.kesimpulan,
      }));
    } catch (err) {
      setNarrative((prev) => ({
        ...prev, pendahuluan: localRes.pendahuluan,
        perParameter: { ...prev.perParameter, ...localRes.perParameter },
        reviewTren: localRes.reviewTren, kesimpulan: localRes.kesimpulan,
      }));
      setAiError("AI gagal merespons, dipakai narasi otomatis dari data sebagai gantinya. Detail error: " + err.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} /> Memuat data dari spreadsheet...</div>;
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft size={16} /> Kembali ke Dashboard
        </button>
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  if (mode === "reportHasil") {
    return (
      <ReportHasilPanel systemKey={systemKey} entriesForMonth={entries} monthKey={monthKey}
        session={session} token={token} onBack={() => setMode("pengkajian")} />
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 print:max-w-none print:p-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft size={16} /> Kembali ke Dashboard
        </button>
        <div className="flex items-center gap-2">
          <input type="month" value={monthKey} onChange={(ev) => setMonthKey(ev.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          {isQC && (
            <button onClick={() => setMode("reportHasil")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Printer size={15} /> Report Hasil Pemeriksaan
            </button>
          )}
          {isQA && (
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Printer size={15} /> Download / Print PDF
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 print-card">
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-blue-900 px-5 py-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-12 w-12 shrink-0 object-contain brightness-0 invert" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">PT. Rama Emerald Multi Sukses — QA</p>
                <h2 className="text-xl font-bold text-white">Pengkajian Trend Data Sistem Pengolahan Air (SPA)</h2>
                <p className="text-sm text-blue-100">
                  Sistem: <span className="font-medium text-white">{system.label}</span> · Periode: <span className="font-medium text-white">{monthLabel(monthKey)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between bg-white px-5 py-3">
          <span className="text-xs text-slate-400">Status keseluruhan periode ini</span>
          <StatusPill level={overallLevel} hasData={entries.length > 0} />
        </div>
      </div>

      {saveError && <p className="no-print mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{saveError}</p>}

      {!session && (
        <div className="no-print mb-4 rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
          Anda melihat mode publik (lihat saja). Login sebagai Staff/Supervisor/Manager untuk mengisi atau menyetujui data.
        </div>
      )}

      <div className="no-print mb-5">
        <EntryEditor system={system} entries={entries} setEntries={setEntries} onSave={saveEntriesOnly} saving={saving}
          canInput={canInputQC} canDeleteExisting={canDeleteQC}
          accessNote={session ? "Staff/Supervisor/Manager QC atau Supervisor/Manager QA yang bisa mengisi data" : "Login untuk mengisi data"} />
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Persyaratan</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Parameter</th>
                <th className="px-3 py-2 text-right">Syarat</th><th className="px-3 py-2 text-right">Alert Limit</th><th className="px-3 py-2 text-right">Action Limit</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const meta = PARAM_META[p];
                const limit = LIMITS[p];
                if (limit.qualitative) {
                  return (
                    <tr key={p} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-1.5">{meta.short}</td>
                      <td className="px-3 py-1.5 text-right">{limit.passValue}</td>
                      <td className="px-3 py-1.5 text-right">-</td>
                      <td className="px-3 py-1.5 text-right">-</td>
                    </tr>
                  );
                }
                const syarat = limit.syaratMin !== undefined ? `${limit.syaratMin}–${limit.syaratMax}` : `≤ ${limit.syaratMax}`;
                const alert = limit.alertMin !== undefined ? `≤${limit.alertMin} / ≥${limit.alertMax}` : `≥ ${limit.alertMax}`;
                const action = limit.actionMin !== undefined ? `≤${limit.actionMin} / ≥${limit.actionMax}` : `≥ ${limit.actionMax}`;
                return (
                  <tr key={p} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-1.5">{meta.short}{meta.unit ? ` (${meta.unit})` : ""}</td>
                    <td className="px-3 py-1.5 text-right">{syarat}</td>
                    <td className="px-3 py-1.5 text-right">{alert}</td>
                    <td className="px-3 py-1.5 text-right">{action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><LegendRow /></div>
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700">Pembahasan &amp; Narasi</h3>
        {canEditQA ? (
          <div className="flex gap-2">
            <button onClick={() => handleGenerateNarrative(false)} disabled={generating || entries.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Buat Narasi dari Data
            </button>
            <button onClick={() => handleGenerateNarrative(true)} disabled={generating || entries.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? "Menyusun narasi..." : "Buat Narasi dengan AI"}
            </button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
            <Lock size={12} /> Hanya Supervisor/Manager QA yang bisa menyusun narasi
          </span>
        )}
      </div>
      {aiError && <p className="no-print mb-3 text-sm text-red-600">{aiError}</p>}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Pendahuluan</label>
        <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          rows={4} value={narrative.pendahuluan} onChange={(ev) => setNarrative({ ...narrative, pendahuluan: ev.target.value })} readOnly={!canEditQA} />
      </div>

      <div className="mb-5 space-y-4">
        {params.map((p) => (
          <div key={p} className="overflow-hidden rounded-xl border border-slate-200 bg-white print-card">
            {!LIMITS[p].qualitative && <div className="p-4"><ParamChart entries={entries} paramKey={p} systemLabel={system.label} /></div>}
            <div className="border-t border-slate-100 p-4 avoid-break">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Hasil &amp; Tren {PARAM_META[p].short}
              </label>
              <AutoTextarea
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                rows={6}
                value={narrative.perParameter[p] || ""}
                placeholder={`Tulis ulasan hasil dan tren untuk ${PARAM_META[p].short}...`}
                onChange={(ev) => setNarrative({ ...narrative, perParameter: { ...narrative.perParameter, [p]: ev.target.value } })}
                readOnly={!canEditQA}
              />
            </div>
          </div>
        ))}
      </div>

      {(narrative.reviewTren || canEditQA) && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
          <h3 className="mb-3 text-sm font-bold text-slate-700">Review Tren (dibanding periode sebelumnya)</h3>
          <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
            rows={6} placeholder="Opsional — isi kalau ada data periode sebelumnya untuk dibandingkan."
            value={narrative.reviewTren} onChange={(ev) => setNarrative({ ...narrative, reviewTren: ev.target.value })} readOnly={!canEditQA} />
        </div>
      )}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Kesimpulan</h3>
        <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          rows={8} value={narrative.kesimpulan} onChange={(ev) => setNarrative({ ...narrative, kesimpulan: ev.target.value })} readOnly={!canEditQA} />
      </div>

      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Tanda Tangan</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { field: "dinilai", label: "Dikaji Oleh", canApprove: canEditQA, onApprove: handleApproveDikaji,
              disabledNote: "Hanya Supervisor/Manager QA yang bisa menyetujui" },
            { field: "diperiksa", label: "Mengetahui", canApprove: canApproveFinal, onApprove: handleApproveMengetahui,
              disabledNote: signoff.dinilai?.nama ? "Hanya Manager QA yang bisa menyetujui final" : "Menunggu approval \"Dikaji Oleh\" terlebih dahulu" },
          ].map(({ field, label, canApprove, onApprove, disabledNote }) => (
            <div key={field} className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <div className="mb-3 flex h-24 items-center justify-center rounded border border-dashed border-slate-300 print:h-28">
                {signoff[field]?.nama ? (
                  <VerifyQR type="pengkajian" system={systemKey} period={monthKey} slot={field} size={68} />
                ) : (
                  <span className="only-screen text-xs text-slate-300">Ruang tanda tangan</span>
                )}
              </div>
              {signoff[field]?.nama ? (
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-slate-700">{signoff[field].nama}</p>
                  <p className="text-slate-500">{signoff[field].jabatan}</p>
                  <p className="text-xs text-slate-400">{signoff[field].tanggal ? fullDateID(signoff[field].tanggal) : ""}</p>
                </div>
              ) : canApprove ? (
                <button onClick={onApprove} disabled={approving || (field === "diperiksa" && !signoff.dinilai?.nama)}
                  className="no-print inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                  {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Setujui &amp; Tanda Tangani
                </button>
              ) : (
                <p className="no-print inline-flex items-center gap-1.5 text-xs text-slate-400"><Lock size={12} /> {disabledNote}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {canEditQA && (
        <div className="no-print mb-8 flex justify-end">
          <button onClick={saveNarrativeOnly} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Simpan Narasi &amp; Pembahasan
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= AUTH UI */
function LoginModal({ onClose, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (ev) => {
    ev.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(username.trim(), password);
      onClose();
    } catch (err) {
      setError(err.message || "Login gagal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <Lock size={18} className="text-blue-700" />
          <h3 className="text-base font-bold text-slate-800">Login SPA</h3>
        </div>
        <form onSubmit={submit}>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Username</label>
          <input autoFocus type="text" value={username} onChange={(ev) => setUsername(ev.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password</label>
          <input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Batal
            </button>
            <button type="submit" disabled={submitting || !username || !password}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null} Masuk
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChangePasswordModal({ token, onClose }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (ev) => {
    ev.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("Password baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru tidak sama.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiChangePassword(oldPassword, newPassword, token);
      if (res.error) throw new Error(res.error);
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Gagal mengganti password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <Lock size={18} className="text-blue-700" />
          <h3 className="text-base font-bold text-slate-800">Ganti Password</h3>
        </div>
        {success ? (
          <div>
            <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Password berhasil diganti.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800">
                Tutup
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password Lama</label>
            <input autoFocus type="password" value={oldPassword} onChange={(ev) => setOldPassword(ev.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password Baru</label>
            <input type="password" value={newPassword} onChange={(ev) => setNewPassword(ev.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Ulangi Password Baru</label>
            <input type="password" value={confirmPassword} onChange={(ev) => setConfirmPassword(ev.target.value)}
              className="mb-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
            <p className="mb-4 text-xs text-slate-400">Minimal 6 karakter. Lupa password lama? Hubungi Administrator, bukan lewat form ini.</p>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="submit" disabled={submitting || !oldPassword || !newPassword || !confirmPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Password Baru
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ========================================================================= TOP BAR */
function TopBar({ session, onLoginClick, onLogout, onChangePasswordClick, view, setView }) {
  return (
    <div className="no-print border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button onClick={() => setView("dashboard")} className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-8 w-8 object-contain" />
          SPA — PT. Rama Emerald Multi Sukses
        </button>
        <div className="flex items-center gap-2">
          {session && hasAccess(session, "Supervisor") && (
            <button onClick={() => setView("activity")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${view === "activity" ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              <History size={14} /> Riwayat Aktivitas
            </button>
          )}
          {session ? (
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 sm:inline-flex">
                <User size={13} /> {session.nama} · {session.role} {session.departemen}
              </span>
              <button onClick={onChangePasswordClick} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Lock size={14} /> Ganti Password
              </button>
              <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <LogOut size={14} /> Keluar
              </button>
            </div>
          ) : (
            <button onClick={onLoginClick} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800">
              <LogIn size={14} /> Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= RIWAYAT AKTIVITAS */
function ActivityLogPage({ token, onBack }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchActivityLog(token)
      .then((res) => { if (!cancelled) setLogs(res); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ChevronLeft size={16} /> Kembali ke Dashboard
      </button>
      <h2 className="mb-4 text-lg font-bold text-slate-800">Riwayat Aktivitas</h2>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" size={16} /> Memuat...</div>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      ) : logs.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Belum ada aktivitas tercatat.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Waktu</th><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Aksi</th><th className="px-3 py-2">Sistem</th><th className="px-3 py-2">Periode</th><th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">{new Date(l.waktu).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-1.5">{l.nama}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{l.role} {l.departemen}</td>
                  <td className="px-3 py-1.5">{l.aksi}</td>
                  <td className="px-3 py-1.5">{l.sistem}</td>
                  <td className="px-3 py-1.5">{l.bulan}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= VERIFIKASI TANDA TANGAN (halaman publik, dibuka lewat scan QR) */
function VerifyPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const type = params.get("type"); // "reportHasil" | "pengkajian"
  const systemKey = params.get("system");
  const slot = params.get("slot");
  const period = type === "reportHasil" ? params.get("tanggal") : params.get("month");
  const system = SYSTEMS.find((s) => s.key === systemKey);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!type || !systemKey || !period || !slot || !system) {
        setErrorMsg("Kode QR tidak lengkap atau tidak dikenali.");
        setLoading(false);
        return;
      }
      try {
        const res = type === "reportHasil" ? await fetchReportHasil(systemKey, period) : await fetchReport(systemKey, period);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setErrorMsg(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let signer = null;
  let docLabel = "";
  let periodLabel = "";
  if (data && !data.error) {
    if (type === "reportHasil") {
      docLabel = "Report Hasil Pemeriksaan " + system.jenis;
      periodLabel = "Tanggal Pemeriksaan: " + fullDateID(period);
      signer = slot === "analis"
        ? { nama: data.analis?.nama, label: "Diperiksa oleh", tanggal: data.analis?.tanggal }
        : { nama: data.diperiksa?.nama, label: "Mengetahui (QC)", tanggal: data.diperiksa?.tanggal };
    } else {
      docLabel = "Pengkajian Trend Data SPA";
      periodLabel = "Periode: " + monthLabel(period);
      signer = slot === "dinilai"
        ? { nama: data.signoff?.dinilai?.nama, label: "Dikaji Oleh", tanggal: data.signoff?.dinilai?.tanggal, jabatan: data.signoff?.dinilai?.jabatan }
        : { nama: data.signoff?.diperiksa?.nama, label: "Mengetahui (Final)", tanggal: data.signoff?.diperiksa?.tanggal, jabatan: data.signoff?.diperiksa?.jabatan };
    }
  }
  const isValid = !!signer?.nama;
  const [periodLabelKey, periodLabelVal] = periodLabel.split(/:\s(.+)/);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center gap-1.5">
          <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-14 w-14 object-contain" />
          <h1 className="text-center text-base font-bold text-slate-800">Verifikasi Dokumen SPA</h1>
          <p className="text-center text-xs text-slate-500">PT. Rama Emerald Multi Sukses</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <p className="py-4 text-center text-sm text-slate-400">Memeriksa data…</p>
          ) : errorMsg || !system || data?.error ? (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <AlertTriangle className="text-red-500" size={28} />
              <p className="text-sm font-semibold text-red-600">Kode tidak valid</p>
              <p className="text-xs text-slate-500">{errorMsg || data?.error || "Dokumen tidak ditemukan di sistem."}</p>
            </div>
          ) : !isValid ? (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <AlertTriangle className="text-amber-500" size={28} />
              <p className="text-sm font-semibold text-amber-600">Belum ditandatangani</p>
              <p className="text-xs text-slate-500">Slot tanda tangan ini belum disetujui di sistem.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-1 text-center">
              <CheckCircle2 className="text-emerald-600" size={32} />
              <p className="text-sm font-semibold text-emerald-700">Dokumen tercatat sah dalam sistem</p>
              <div className="w-full space-y-1.5 rounded-lg bg-slate-50 p-3 text-left text-sm">
                <p><span className="text-slate-400">Dokumen: </span><span className="font-medium">{docLabel}</span></p>
                <p><span className="text-slate-400">Sistem: </span><span className="font-medium">{system.label}</span></p>
                <p><span className="text-slate-400">{periodLabelKey}: </span><span className="font-medium">{periodLabelVal}</span></p>
                <p><span className="text-slate-400">{signer.label}: </span><span className="font-medium">{signer.nama}</span></p>
                {signer.jabatan && <p><span className="text-slate-400">Jabatan: </span><span className="font-medium">{signer.jabatan}</span></p>}
                <p><span className="text-slate-400">Tanggal disetujui: </span><span className="font-medium">{signer.tanggal ? fullDateID(signer.tanggal) : "-"}</span></p>
              </div>
            </div>
          )}
        </div>

        <p className="mx-auto mt-4 max-w-xs text-center text-[11px] text-slate-400">
          Halaman ini menampilkan data langsung dari sistem SPA secara real-time, bukan dari isi file PDF yang di-scan.
        </p>
      </div>
    </div>
  );
}

/* ========================================================================= APP ROOT */
export default function App() {
  if (typeof window !== "undefined" && window.location.pathname === "/verify") {
    return <VerifyPage />;
  }
  const { session, checking, login: doLogin, logout: doLogout } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [view, setView] = useState("dashboard");
  const [systemKey, setSystemKey] = useState(null);
  const [monthKey, setMonthKey] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [statusIndex, setStatusIndex] = useState({});
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState("");

  const refreshStatus = useCallback(async (month) => {
    setLoadingStatus(true);
    setStatusError("");
    try {
      const idx = await fetchStatusIndex(month);
      setStatusIndex(idx);
    } catch (err) {
      setStatusError("Gagal memuat status dari spreadsheet: " + err.message);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (view === "dashboard") refreshStatus(monthKey);
  }, [view, monthKey, refreshStatus]);

  useEffect(() => {
    if (view === "activity" && !(session && hasAccess(session, "Supervisor"))) {
      setView("dashboard");
    }
  }, [session, view]);

  if (checking) {
    return <div className="flex h-screen items-center justify-center text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} /> Memuat sesi...</div>;
  }

  return (
    <div className="min-h-full bg-slate-50">
      <style>{`
        .only-print { display: none; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          .no-print { display: none !important; }
          .only-screen { display: none !important; }
          .only-print { display: block !important; }
          .print-card { box-shadow: none !important; border: 1px solid #cbd5e1 !important; page-break-inside: avoid; break-inside: avoid; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
        }
        @page {
          margin: 1.5cm 1.5cm 2cm 1.5cm;
        }
        @page {
          @bottom-right {
            content: "Halaman " counter(page);
            font-size: 9px;
            color: #64748b;
          }
        }
      `}</style>
      <TopBar session={session} onLoginClick={() => setShowLogin(true)} onLogout={doLogout} onChangePasswordClick={() => setShowChangePassword(true)} view={view} setView={setView} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={doLogin} />}
      {showChangePassword && <ChangePasswordModal token={session?.token} onClose={() => setShowChangePassword(false)} />}
      {view === "dashboard" ? (
        <Dashboard
          monthKey={monthKey}
          setMonthKey={setMonthKey}
          statusIndex={statusIndex}
          loadingStatus={loadingStatus}
          statusError={statusError}
          onOpen={(key) => { setSystemKey(key); setView("detail"); }}
        />
      ) : view === "activity" ? (
        <ActivityLogPage token={session?.token} onBack={() => setView("dashboard")} />
      ) : (
        <SystemDetail
          systemKey={systemKey}
          monthKey={monthKey}
          setMonthKey={setMonthKey}
          onBack={() => setView("dashboard")}
          onSaved={() => refreshStatus(monthKey)}
          session={session}
          token={session?.token}
        />
      )}
    </div>
  );
}
