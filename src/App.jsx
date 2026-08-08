import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  LineChart, Line, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from "recharts";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Printer, Loader2, Sparkles,
  AlertTriangle, CheckCircle2, XCircle, FileQuestion, LayoutGrid,
  Droplet, LogIn, LogOut, User, History, Lock, Calendar as CalendarIcon,
} from "lucide-react";
import {
  fetchMaster, fetchEntries, saveEntries as apiSaveEntries,
  fetchReport, saveReport as apiSaveReport, fetchStatusIndex,
  generateNarrative, approveDikaji as apiApproveDikaji,
  approveMengetahui as apiApproveMengetahui, fetchActivityLog,
  fetchReportHasil, saveReportHasil as apiSaveReportHasil, approveReportHasil as apiApproveReportHasil,
  changePassword as apiChangePassword,
  fetchKontrolMingguan, saveKontrolMingguan as apiSaveKontrolMingguan,
} from "./api.js";
import { generateLocalNarrative, PARAM_META, PARAMS_BY_JENIS, LIMITS, getLimit, QUALI_OPTIONS, statusFor, parseNumericValue, fullDateID, weekKeyForISO, weekLabel, findKontrolMingguan, monthDefaultWeekKey } from "./narrativeGenerator.js";
import { useAuth, hasAccess } from "./auth.js";

// Sistem air TETAP (harus persis sinkron dengan SYSTEMS di Code.gs)
const SYSTEMS = [
  { key: "pw_nbl", jenis: "PW", label: "Purified Water — NBL" },
  { key: "pw_sefalosporin", jenis: "PW", label: "Purified Water — Sefalosporin" },
  { key: "pw_betalaktam", jenis: "PW", label: "Purified Water — Betalaktam" },
  { key: "wfi_sefalosporin", jenis: "WFI", label: "Water For Injection — Sefalosporin" },
  { key: "ps_sefalosporin_steril", jenis: "Pure Steam", label: "Pure Steam — Sefalosporin Steril" },
];

// Penomoran dokumen Formulir QC — beda-beda per sistem/fasilitas (ditampilkan
// di pojok kanan atas Formulir Pemeriksaan, seperti formulir EM Viable).
const DOC_NUMBERS = {
  pw_nbl: { no: "FM.QC.355/R4", tglBerlaku: "01/02/2024", menggantikanNo: "FM.QC.355/R3", tglBerlakuLama: "05/10/2022" },
  pw_betalaktam: { no: "FM.QC.040/R6", tglBerlaku: "05/10/2022", menggantikanNo: "FM.QC.040/R5", tglBerlakuLama: "01/10/2019" },
  pw_sefalosporin: { no: "FM.QC.039/R7", tglBerlaku: "01/02/2024", menggantikanNo: "FM.QC.039/R6", tglBerlakuLama: "05/10/2022" },
  wfi_sefalosporin: { no: "FM.QC.063/R2", tglBerlaku: "05/10/2022", menggantikanNo: "FM.QC.063/R1", tglBerlakuLama: "18/05/2020" },
  ps_sefalosporin_steril: { no: "FM.QC.713/R0", tglBerlaku: "21/09/2022", menggantikanNo: "-", tglBerlakuLama: "-" },
};

function uid() {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// Tambah N hari ke tanggal ISO (yyyy-mm-dd) tanpa masalah timezone/UTC —
// dipakai untuk menghitung Tanggal Baca (Tanggal Pemeriksaan + 3 hari).
function addDaysISO(iso, days) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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
  if (/^<\s*[\d.,]+$/.test(str)) return str.replace(/\s+/g, "").replace(".", ",");
  // Tampilkan konsisten pakai koma sebagai pemisah desimal (data lama yang
  // sempat disimpan pakai titik pun ikut tampil rapi dengan koma di sini).
  return str.replace(/\./g, ",");
}

// Sebagian orang mengetik pemisah desimal pakai titik (.), sebagian pakai
// koma (,) — supaya data yang tersimpan konsisten (dan tidak salah baca saat
// direkap/dibandingkan), titik otomatis diubah jadi koma saat disimpan.
// Notasi "<1" / "<0.5" dst tetap didukung.
function normalizeNumericInput(str) {
  if (str === "" || str === "-") return str;
  return str.replace(/\./g, ",");
}

/* ========================================================================= QR VERIFIKASI TANDA TANGAN */
function buildVerifyUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${window.location.origin}/verify?${qs}`;
}

function VerifyQR({ type, system, period, slot, size = 64 }) {
  const params = { type, system, month: period, slot };
  const url = buildVerifyUrl(params);
  return (
    <div className="flex flex-col items-center gap-1">
      <QRCodeSVG value={url} size={size} level="M" bgColor="#ffffff" fgColor="#0f172a" />
      <span className="text-center text-[9px] leading-tight text-slate-400">Scan untuk verifikasi</span>
    </div>
  );
}

/* ========================================================================= INPUT TANGGAL FORMAT INDONESIA (dd/mm/yyyy)
   <input type="date"> menampilkan format sesuai locale OS/browser (kadang
   mm/dd/yyyy), tidak bisa dipaksa dd/mm/yyyy lewat HTML/CSS saja — jadi kita
   pakai text input dengan pola dd/mm/yyyy, disimpan sebagai ISO (yyyy-mm-dd)
   di data seperti biasa. */
function isoToID(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}
function idToISO(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) return null;
  return `${y}-${mm}-${dd}`;
}
function DateInputID({ value, onChange, disabled, className }) {
  const [text, setText] = useState(isoToID(value));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // {top, left} posisi kalender, dihitung dari input (position: fixed)
  const [viewYM, setViewYM] = useState(() => {
    const iso = value || todayISO();
    const [y, m] = iso.split("-");
    return { y: Number(y), m: Number(m) - 1 };
  });
  const inputRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => { setText(isoToID(value)); }, [value]);

  // Klik di luar input MAUPUN di luar kalender (yang sekarang di-portal ke
  // body, jadi tidak selalu "di dalam" DOM input) otomatis menutupnya.
  useEffect(() => {
    if (!open) return;
    function onDocClick(ev) {
      if (inputRef.current && inputRef.current.contains(ev.target)) return;
      if (popRef.current && popRef.current.contains(ev.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    // Tutup juga kalau halaman di-scroll, supaya posisi kalender tidak "nyangkut"
    // salah tempat relatif terhadap input yang sudah bergeser.
    function onScroll() { setOpen(false); }
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function computePos() {
    const el = inputRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const popW = 224; // w-56
    const popH = 230; // perkiraan tinggi kalender
    let top = rect.bottom + 4;
    let left = rect.left;
    // Kalau kalender bakal kepotong di bawah layar, buka ke ATAS input.
    if (top + popH > window.innerHeight) top = rect.top - popH - 4;
    // Kalau kepotong di kanan layar, geser ke kiri secukupnya.
    if (left + popW > window.innerWidth) left = Math.max(4, window.innerWidth - popW - 4);
    return { top, left };
  }

  function openCalendar() {
    if (disabled) return;
    const iso = value || idToISO(text) || todayISO();
    const [y, m] = iso.split("-");
    setViewYM({ y: Number(y), m: Number(m) - 1 });
    setPos(computePos());
    setOpen(true);
  }

  function shiftMonth(delta) {
    setViewYM((v) => {
      let m = v.m + delta;
      let y = v.y;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      return { y, m };
    });
  }

  function pickDay(d) {
    const iso = `${viewYM.y}-${String(viewYM.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    onChange(iso);
    setOpen(false);
  }

  const daysInMonth = new Date(viewYM.y, viewYM.m + 1, 0).getDate();
  const firstDow = new Date(viewYM.y, viewYM.m, 1).getDay(); // 0=Minggu
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="relative inline-block">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/yyyy"
          disabled={disabled}
          value={text}
          onFocus={openCalendar}
          onClick={openCalendar}
          onChange={(ev) => {
            const t = ev.target.value;
            setText(t);
            const iso = idToISO(t);
            if (iso) onChange(iso);
          }}
          className={`${className} ${disabled ? "" : "cursor-pointer pr-6"}`}
        />
        {!disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={openCalendar}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            title="Buka kalender"
          >
            <CalendarIcon size={13} />
          </button>
        )}
      </div>
      {open && !disabled && pos && createPortal(
        <div
          ref={popRef}
          className="only-screen fixed z-50 w-56 rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">‹</button>
            <span className="text-xs font-semibold text-slate-700">{MONTHS_ID_FULL[viewYM.m]} {viewYM.y}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-400">
            {["M", "S", "S", "R", "K", "J", "S"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const iso = `${viewYM.y}-${String(viewYM.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const isSelected = iso === value;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => pickDay(d)}
                  className={`rounded py-1 hover:bg-teal-50 ${isSelected ? "bg-teal-600 text-white hover:bg-teal-600" : "text-slate-600"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
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

/* ========================================================================= GRAFIK TREN PER PARAMETER (gaya EM Viable: area gradasi, dot & tooltip berwarna status, legend chip) */
function statusForChartValue(value, limit) {
  const isBi = limit.syaratMin !== undefined;
  if (isBi) {
    if (value < limit.syaratMin || value > limit.syaratMax) return { label: "Melebihi Syarat", color: "#b91c1c" };
    if (value < limit.actionMin || value > limit.actionMax) return { label: "Action", color: "#c2410c" };
    if (value < limit.alertMin || value > limit.alertMax) return { label: "Alert", color: "#b45309" };
    return { label: "Terkendali", color: "#15803d" };
  }
  if (value < limit.alertMax) return { label: "Terkendali", color: "#15803d" };
  if (value < limit.actionMax) return { label: "Alert", color: "#b45309" };
  if (value < limit.syaratMax) return { label: "Action", color: "#c2410c" };
  return { label: "Melebihi Syarat", color: "#b91c1c" };
}

function ChartDot({ cx, cy, payload, limit }) {
  if (cx == null || cy == null) return null;
  const s = statusForChartValue(payload.value, limit);
  return <circle cx={cx} cy={cy} r={4} fill={s.color} stroke="#fff" strokeWidth={1.5} />;
}

function ChartTooltip({ active, payload, limit, unit }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const s = statusForChartValue(p.value, limit);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 max-w-[160px] font-semibold text-slate-600">{p.label}</p>
      <p className="text-sm font-bold" style={{ color: s.color }}>{displayValue(p.value)}{unit ? ` ${unit}` : ""}</p>
      <p className="font-medium" style={{ color: s.color }}>{s.label}</p>
    </div>
  );
}

function LegendChip({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function ParamChart({ entries, paramKey, systemLabel, jenis }) {
  const meta = PARAM_META[paramKey];
  const limit = getLimit(paramKey, jenis);
  if (!limit || limit.qualitative) return null;
  const isBidirectional = limit.syaratMin !== undefined;

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
      return { label, value: v, room: e.namaRuangan || e.titikSampling };
    })
    .filter(Boolean);
  if (data.length === 0) return null;

  let domain;
  if (isBidirectional) {
    const lo = Math.min(limit.syaratMin, ...data.map((d) => d.value));
    const hi = Math.max(limit.syaratMax, ...data.map((d) => d.value));
    const pad = (hi - lo) * 0.15 || 0.5;
    domain = [lo - pad, hi + pad];
  } else {
    domain = [0, Math.max(limit.syaratMax, ...data.map((d) => d.value)) * 1.2];
  }

  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  const peakStatus = statusForChartValue(peak.value, limit);
  const gradId = `paramGrad-${jenis}-${paramKey}`.replace(/[^a-zA-Z0-9-]/g, "");

  return (
    <div className="avoid-break overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-slate-100 px-4 py-2.5">
        <div>
          <p className="text-xs font-semibold text-slate-600">{meta.label} — {systemLabel}</p>
          <p className="text-[11px] text-slate-400">
            Tertinggi bulan ini: <span className="font-semibold" style={{ color: peakStatus.color }}>{displayValue(peak.value)}{meta.unit ? ` ${meta.unit}` : ""}</span> ({peak.room})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <LegendChip color="#15803d" label="Terkendali" />
          <LegendChip color="#b45309" label={isBidirectional ? `Alert ${limit.alertMin}–${limit.alertMax}` : `Alert ${limit.alertMax}`} />
          <LegendChip color="#c2410c" label={isBidirectional ? `Action ${limit.actionMin}–${limit.actionMax}` : `Action ${limit.actionMax}`} />
          <LegendChip color="#b91c1c" label={isBidirectional ? `Syarat ${limit.syaratMin}–${limit.syaratMax}` : `Syarat ${limit.syaratMax}`} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 10, right: 15, left: 10, bottom: 50 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          {isBidirectional ? (
            <>
              <ReferenceArea y1={domain[0]} y2={limit.syaratMin} fill="#ef4444" fillOpacity={0.06} ifOverflow="hidden" />
              <ReferenceArea y1={limit.syaratMin} y2={limit.actionMin} fill="#f97316" fillOpacity={0.07} ifOverflow="hidden" />
              <ReferenceArea y1={limit.actionMin} y2={limit.alertMin} fill="#f59e0b" fillOpacity={0.06} ifOverflow="hidden" />
              <ReferenceArea y1={limit.alertMin} y2={limit.alertMax} fill="#22c55e" fillOpacity={0.05} ifOverflow="hidden" />
              <ReferenceArea y1={limit.alertMax} y2={limit.actionMax} fill="#f59e0b" fillOpacity={0.06} ifOverflow="hidden" />
              <ReferenceArea y1={limit.actionMax} y2={limit.syaratMax} fill="#f97316" fillOpacity={0.07} ifOverflow="hidden" />
              <ReferenceArea y1={limit.syaratMax} y2={domain[1]} fill="#ef4444" fillOpacity={0.06} ifOverflow="hidden" />
            </>
          ) : (
            <>
              <ReferenceArea y1={0} y2={limit.alertMax} fill="#22c55e" fillOpacity={0.05} ifOverflow="hidden" />
              <ReferenceArea y1={limit.alertMax} y2={limit.actionMax} fill="#f59e0b" fillOpacity={0.06} ifOverflow="hidden" />
              <ReferenceArea y1={limit.actionMax} y2={limit.syaratMax} fill="#f97316" fillOpacity={0.07} ifOverflow="hidden" />
              <ReferenceArea y1={limit.syaratMax} y2={domain[1]} fill="#ef4444" fillOpacity={0.06} ifOverflow="hidden" />
            </>
          )}
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} angle={-35} textAnchor="end" interval={0} height={62} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
          <YAxis domain={domain} tick={{ fontSize: 11, fill: "#64748b" }} width={38} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip limit={limit} unit={meta.unit} />} />
          <ReferenceLine y={limit.syaratMax} stroke="#dc2626" strokeWidth={1.25} strokeDasharray="4 3" />
          <ReferenceLine y={limit.actionMax} stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" />
          <ReferenceLine y={limit.alertMax} stroke="#eab308" strokeWidth={1} strokeDasharray="4 3" />
          {isBidirectional && (
            <>
              <ReferenceLine y={limit.syaratMin} stroke="#dc2626" strokeWidth={1.25} strokeDasharray="4 3" />
              <ReferenceLine y={limit.actionMin} stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" />
              <ReferenceLine y={limit.alertMin} stroke="#eab308" strokeWidth={1} strokeDasharray="4 3" />
            </>
          )}
          <Area type="monotone" dataKey="value" stroke="none" fill={`url(#${gradId})`} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#16a34a"
            strokeWidth={2.25}
            dot={<ChartDot limit={limit} />}
            activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {excludedCount > 0 && (
        <p className="mx-4 mb-3 text-xs italic text-amber-600">
          * {excludedCount} titik data dengan nilai tidak wajar (di luar skala grafik) tidak ditampilkan di sini — cek nilainya di tabel di atas.
        </p>
      )}
    </div>
  );
}

/* ========================================================================= TABEL NILAI PER PARAMETER (mirip tampilan "per kelas" EM Viable) */
const STATUS_BADGE_CLASS = {
  0: "bg-slate-100 text-slate-500",
  1: "bg-emerald-50 text-emerald-700",
  2: "bg-amber-50 text-amber-700",
  3: "bg-orange-50 text-orange-700",
  4: "bg-red-50 text-red-700",
};

function ParamValueTable({ entries, paramKey, jenis }) {
  const meta = PARAM_META[paramKey];
  const qualitative = getLimit(paramKey, jenis).qualitative;
  const rows = entries.filter((e) => e[paramKey] !== null && e[paramKey] !== undefined && e[paramKey] !== "");
  if (rows.length === 0) return null;

  return (
    <div className="avoid-break overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center justify-between bg-gradient-to-r from-teal-950 via-teal-900 to-teal-800 px-4 py-2.5">
        <h4 className="text-sm font-bold uppercase tracking-wide text-white">{meta.label}</h4>
        <span className="text-xs font-medium text-teal-200">{rows.length} titik data</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-4 py-2">Titik Sampling</th>
              <th className="whitespace-nowrap px-4 py-2">Nama Ruangan</th>
              <th className="whitespace-nowrap px-4 py-2">Tanggal</th>
              <th className="whitespace-nowrap px-4 py-2">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const st = statusFor(e[paramKey], paramKey, jenis);
              return (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">{e.titikSampling || "-"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{e.namaRuangan || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{isoToID(e.tanggal)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[st.level] || STATUS_BADGE_CLASS[0]}`}>
                      {displayValue(e[paramKey])}{!qualitative && meta.unit ? ` ${meta.unit}` : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================================================================= INPUT DATA (EntryEditor) */
function EntryRow({ entry, masterPoints, params, readOnly, canDelete, onChange, onDelete }) {
  const isCustom = entry._custom || !masterPoints.some((p) => p.code === entry.titikSampling);
  const handlePick = (val) => {
    if (val === "__custom__") {
      onChange({ ...entry, _custom: true });
      return;
    }
    const pt = masterPoints.find((p) => p.code === val);
    if (pt) onChange({ ...entry, _custom: false, titikSampling: pt.code, namaRuangan: pt.name });
  };
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-2 py-1.5">
        <DateInputID disabled={readOnly} className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
          value={entry.tanggal || ""} onChange={(iso) => onChange({ ...entry, tanggal: iso })} />
      </td>
      <td className="px-2 py-1.5">
        <select disabled={readOnly} className="w-40 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
          value={isCustom ? "__custom__" : entry.titikSampling || "__custom__"} onChange={(ev) => handlePick(ev.target.value)}>
          <option value="__custom__">-- Input manual --</option>
          {masterPoints.map((p) => <option key={p.code} value={p.code}>{p.code}{p.name ? ` — ${p.name}` : ""}</option>)}
        </select>
        {isCustom && (
          <input type="text" disabled={readOnly} className="mt-1 w-40 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
            placeholder="Kode titik sampling" value={entry.titikSampling || ""}
            onChange={(ev) => onChange({ ...entry, titikSampling: ev.target.value })} />
        )}
      </td>
      <td className="px-2 py-1.5">
        <input type="text" disabled={readOnly || !isCustom} className="w-36 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50"
          placeholder="Nama ruangan/area" value={entry.namaRuangan || ""}
          onChange={(ev) => onChange({ ...entry, namaRuangan: ev.target.value })} />
      </td>
      {params.map((p) => {
        const opts = QUALI_OPTIONS[p];
        return (
          <td key={p} className="px-2 py-1.5">
            {opts ? (
              <select disabled={readOnly} className="w-32 rounded border border-slate-200 px-2 py-1 text-center text-sm disabled:bg-slate-50"
                value={entry[p] || ""} onChange={(ev) => onChange({ ...entry, [p]: ev.target.value })}>
                <option value="">-</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" disabled={readOnly} className="w-20 rounded border border-slate-200 px-2 py-1 text-center text-sm disabled:bg-slate-50"
                placeholder="-" value={entry[p] === null || entry[p] === undefined ? "" : entry[p]}
                onChange={(ev) => {
                  const raw = normalizeNumericInput(ev.target.value.trim());
                  onChange({ ...entry, [p]: raw === "-" ? null : raw });
                }} />
            )}
          </td>
        );
      })}
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

function EntryEditor({ system, masterPoints, entries, setEntries, onSave, saving, canInput = false, canDeleteExisting = false, accessNote }) {
  const params = PARAMS_BY_JENIS[system.jenis] || [];
  const addRow = () => {
    // Tanggal baris baru ikut tanggal baris paling atas (data terakhir yang
    // barusan diinput), bukan selalu tanggal hari ini — menghemat waktu saat
    // input data historis/bulanan dalam jumlah banyak.
    const defaultTanggal = entries[0]?.tanggal || todayISO();
    const blank = { id: uid(), tanggal: defaultTanggal, titikSampling: "", namaRuangan: "" };
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
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
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
                <th className="px-2 py-1.5">Tanggal</th><th className="px-2 py-1.5">Titik Sampling</th><th className="px-2 py-1.5">Nama Ruangan</th>
                {params.map((p) => <th key={p} className="px-2 py-1.5">{PARAM_META[p].short}{PARAM_META[p].unit ? ` (${PARAM_META[p].unit})` : ""}</th>)}
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => (
                <EntryRow key={e.id} entry={e} masterPoints={masterPoints} params={params}
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
      const st = statusFor(e[p], p, jenis);
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
    const limit = getLimit(paramKey, system.jenis);
    const points = entries
      .map((e) => ({ titik: e.titikSampling, tanggal: e.tanggal, raw: e[paramKey] }))
      .filter((p) => p.raw !== null && p.raw !== undefined && p.raw !== "");

    if (limit.qualitative) {
      const positif = points.filter((p) => String(p.raw).trim() !== limit.passValue);
      stats[paramKey] = { label: meta.label, qualitative: true, totalTitik: points.length, positif: positif.map((p) => ({ titik: p.titik, tanggal: p.tanggal, hasil: p.raw })) };
      return;
    }

    const numeric = points.map((p) => ({ ...p, value: parseNumericValue(p.raw) })).filter((p) => p.value !== null);
    const noted = numeric.filter((p) => statusFor(p.raw, paramKey, system.jenis).level >= 2)
      .map((p) => ({ titik: p.titik, tanggal: p.tanggal, hasil: displayValue(p.raw), level: statusFor(p.raw, paramKey, system.jenis).level >= 4 ? "Melebihi Syarat" : statusFor(p.raw, paramKey, system.jenis).level === 3 ? "Action" : "Alert" }));

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
      <div className="relative overflow-hidden bg-gradient-to-br from-teal-950 via-teal-900 to-teal-800">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 py-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">PT. Rama Emerald Multi Sukses — QA</p>
            <h1 className="text-2xl font-bold text-white">Dashboard SPA — Sistem Pengolahan Air</h1>
            <p className="mt-1 text-sm text-teal-100">Rekap pengkajian trend Purified Water, Water For Injection, dan Pure Steam</p>
          </div>
          <label className="no-print inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur-sm">
            <CalendarIcon size={15} className="text-teal-200" />
            <input type="month" value={monthKey} onChange={(ev) => setMonthKey(ev.target.value)} onClick={(ev) => ev.currentTarget.showPicker?.()}
              className="border-none bg-transparent text-sm text-white outline-none [color-scheme:dark]" />
          </label>
        </div>
      </div>
      <div className="mx-auto max-w-5xl p-6">

        {statusError && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{statusError}</p>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard icon={<LayoutGrid size={17} />} iconColor="#0f766e" tint="#ccfbf1" border="#99f6e4" value={SYSTEMS.length} label="Total Sistem" />
          <StatCard icon={<CheckCircle2 size={17} />} iconColor="#15803d" tint="#dcfce7" border="#bbf7d0" value={SYSTEMS.filter((s) => statusIndex[s.key]?.hasData && (statusIndex[s.key]?.level || 0) < 3).length} label="Terkendali" />
          <StatCard icon={<AlertTriangle size={17} />} iconColor="#c2410c" tint="#ffedd5" border="#fed7aa" value={perluCount} label="Perlu Perhatian" />
          <StatCard icon={<XCircle size={17} />} iconColor="#b91c1c" tint="#fee2e2" border="#fecaca" value={tmsCount} label="Melebihi Syarat" />
          <StatCard icon={<FileQuestion size={17} />} iconColor="#475569" tint="#f1f5f9" border="#e2e8f0" value={SYSTEMS.filter((s) => !statusIndex[s.key]?.hasData).length} label="Belum Ada Data" />
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sistem — {monthLabel(monthKey)}</p>
        <div className="space-y-2.5">
          {SYSTEMS.map((s) => {
            const st = statusIndex[s.key];
            const level = st?.hasData ? (st?.level || 0) : 0;
            const accent = STATUS_ACCENT[level];
            const tint = STATUS_TINT[level];
            return (
              <button key={s.key} onClick={() => onOpen(s.key)}
                className="group flex w-full items-center justify-between overflow-hidden rounded-xl border border-slate-200 bg-white pr-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
                <span className="self-stretch w-1.5" style={{ background: accent }} />
                <div className="flex flex-1 items-center gap-3 py-3.5 pl-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: tint.bg, color: tint.fg }}><Droplet size={19} /></span>
                  <div>
                    <p className="font-semibold text-slate-800">{s.label}</p>
                    <p className="text-xs text-slate-400">{loadingStatus ? "Memuat..." : st?.hasData ? "Ada data periode ini" : "Belum ada data periode ini"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {loadingStatus ? <Loader2 className="animate-spin text-slate-300" size={18} /> : <StatusPill level={st?.level || 0} hasData={!!st?.hasData} />}
                  <ChevronRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-400" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, iconColor, tint, border, value, label }) {
  return (
    <div
      className="rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: `linear-gradient(155deg, ${tint} 0%, #ffffff 72%)`, borderColor: border }}
    >
      <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm" style={{ color: iconColor }}>
        {icon}
      </span>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs font-medium text-slate-600">{label}</p>
    </div>
  );
}

const STATUS_TINT = {
  0: { bg: "#f1f5f9", fg: "#64748b" },
  1: { bg: "#ccfbf1", fg: "#0f766e" },
  2: { bg: "#ccfbf1", fg: "#0f766e" },
  3: { bg: "#ffedd5", fg: "#c2410c" },
  4: { bg: "#fee2e2", fg: "#b91c1c" },
};

const STATUS_ACCENT = { 0: "#cbd5e1", 1: "#14b8a6", 2: "#14b8a6", 3: "#f97316", 4: "#ef4444" };

/* ========================================================================= REPORT HASIL PEMERIKSAAN (formulir QC fisik yang didigitalkan) */
function ReportHasilPanel({ systemKey, entriesForMonth, monthKey, session, token, onBack, kontrolRecords = [], masterPoints = [] }) {
  const system = SYSTEMS.find((s) => s.key === systemKey);
  const docNo = DOC_NUMBERS[systemKey];
  const isWFIType = system.jenis === "WFI" || system.jenis === "Pure Steam";
  // Kolom mutu air dasar (di luar Endotoksin — Endotoksin ditempatkan manual
  // setelah blok Kontrol Mikrobiologi/Tanggal Baca, sesuai urutan form fisik).
  const baseParams = ["kejernihan", "warna", "bau", "konduktivitas", "ph", "toc", "mikrobiologi"];

  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const canInput = hasAccess(session, "Staff", "QC");
  const canApprove = hasAccess(session, "Supervisor", "QC");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await fetchReportHasil(systemKey, monthKey);
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
  }, [systemKey, monthKey]);

  // Kelompokkan seluruh data bulan ini per Minggu (Senin-Jumat, aturan
  // potong-bulan sama seperti Kontrol Mingguan) — 1 formulir = 1 bulan penuh,
  // seperti form fisik yang punya beberapa blok "Minggu I/II/III/..." dalam
  // 1 halaman.
  const weeks = useMemo(() => {
    const map = new Map();
    entriesForMonth.forEach((e) => {
      if (!e.tanggal) return;
      const wk = weekKeyForISO(e.tanggal);
      if (!wk) return;
      if (!map.has(wk.key)) map.set(wk.key, { wk, rows: [] });
      map.get(wk.key).rows.push(e);
    });
    const pointOrder = (code) => {
      const idx = masterPoints.findIndex((p) => p.code === code);
      return idx === -1 ? 9999 : idx;
    };
    const list = Array.from(map.values());
    list.forEach((grp) => {
      grp.rows.sort((a, b) => (a.tanggal || "").localeCompare(b.tanggal || "") || pointOrder(a.titikSampling) - pointOrder(b.titikSampling));
    });
    list.sort((a, b) => (a.wk.year - b.wk.year) || (a.wk.month - b.wk.month) || (a.wk.weekNum - b.wk.weekNum));
    return list;
  }, [entriesForMonth, masterPoints]);

  async function handleSave() {
    setSaving(true);
    setErrorMsg("");
    try {
      const res = await apiSaveReportHasil(systemKey, monthKey, token);
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
      const res = await apiApproveReportHasil(systemKey, monthKey, token);
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

  // Total kolom (buat colSpan baris header "Minggu N"): Titik + Tanggal +
  // baseParams + 4 kolom kontrol mikro + Tanggal Baca + (WFI/Pure Steam: 1
  // Endotoksin + 6 kolom LAL/CSE) + Kesimpulan.
  const colCount = 2 + baseParams.length + 4 + 1 + (isWFIType ? 7 : 0) + 1;

  // Lebar kolom proporsional (dipakai lewat <colgroup>) supaya saat print
  // table-layout:fixed tidak membuat semua kolom sama lebar rata — Titik
  // Sampling & kolom kontrol butuh sedikit lebih lega dari kolom parameter biasa.
  const colWeights = [
    1.6, 1.3, // Titik Sampling, Tanggal
    ...baseParams.map(() => 1),
    1.1, 1, 1.1, 1, // No Kontrol Media, Kontrol Negatif, No Kontrol Bakteri, Kontrol Positif
    1.3, // Tanggal Baca
    ...(isWFIType ? [1, 1, 1, 1, 1, 1, 1] : []), // Endotoksin, Kontrol Negatif/Positif LAL, No Bet LAL/CSE, Sensitivitas LAL/CSE
    1, // Kesimpulan
  ];
  const totalWeight = colWeights.reduce((s, w) => s + w, 0);

  if (!session) {
    return (
      <div className="mx-auto max-w-md p-6 pt-20 text-center">
        <Lock size={28} className="mx-auto mb-3 text-slate-300" />
        <h2 className="mb-1 text-base font-bold text-slate-700">Perlu Login</h2>
        <p className="mb-4 text-sm text-slate-500">Formulir Pemeriksaan QC hanya bisa dilihat oleh akun yang sudah login.</p>
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <ChevronLeft size={16} /> Kembali ke Pengkajian SPA
        </button>
      </div>
    );
  }

  const canPrint = hasAccess(session, "Staff");

  return (
    <div className="mx-auto max-w-6xl p-6 print:max-w-none print:p-0" data-print-blocked={!canPrint}>
      <div className="print-blocked-notice">Akses print/download PDF dibatasi untuk akun Staff/Supervisor/Manager ke atas. Silakan login dengan akun yang sesuai.</div>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 1cm; }
        }
        .qc-form-table-wrap { overflow-x: auto; }
        @media print {
          .qc-form-table-wrap { overflow: visible !important; width: auto !important; }
          .qc-form-table { width: 100% !important; font-size: 7.2px !important; table-layout: fixed; }
          .qc-form-table th, .qc-form-table td { padding: 1.5px 2px !important; overflow-wrap: break-word; }
          .qc-form-table thead { display: table-header-group; }
          .qc-form-table tr { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ChevronLeft size={16} /> Kembali ke Pengkajian SPA
        </button>
        {canPrint && (
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900">
            <Printer size={15} /> Cetak / Download PDF
          </button>
        )}
      </div>

      {errorMsg && <p className="no-print mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{errorMsg}</p>}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Memuat...</p>
      ) : weeks.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Belum ada data pengujian untuk periode ini. Isi dulu di halaman Input Data.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-300 print-card">
          <div className="bg-gradient-to-r from-teal-950 via-teal-900 to-teal-800 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-12 w-12 shrink-0 object-contain brightness-0 invert" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">PT. Rama Emerald Multi Sukses</p>
                  <h2 className="text-lg font-bold uppercase text-white">Formulir Pemeriksaan {system.jenis}</h2>
                </div>
              </div>
              {docNo && (
                <div className="shrink-0 text-right text-[11px] leading-tight text-teal-100">
                  <p><span className="text-teal-300">No. </span><span className="font-medium text-white">: {docNo.no}</span></p>
                  <p><span className="text-teal-300">Tgl Berlaku </span><span className="font-medium text-white">: {docNo.tglBerlaku}</span></p>
                  <p><span className="text-teal-300">Menggantikan No. </span><span className="font-medium text-white">: {docNo.menggantikanNo}</span></p>
                  <p><span className="text-teal-300">Tgl Berlaku </span><span className="font-medium text-white">: {docNo.tglBerlakuLama}</span></p>
                </div>
              )}
            </div>
          </div>
          <div className="bg-white p-6">

          <div className="mb-4 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <p><span className="text-slate-500">Sistem</span> : <span className="font-medium">{system.label}</span></p>
            <p><span className="text-slate-500">Periode</span> : <span className="font-medium">{monthLabel(monthKey)}</span></p>
          </div>

          <div className="qc-form-table-wrap">
            <table className="qc-form-table w-full border-collapse text-[10.5px] leading-tight">
              <colgroup>
                {colWeights.map((w, i) => <col key={i} style={{ width: `${(w / totalWeight * 100).toFixed(3)}%` }} />)}
              </colgroup>
              <thead>
                <tr className="border border-slate-300 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <th className="border border-slate-300 px-1.5 py-1.5">Titik Sampling</th>
                  <th className="border border-slate-300 px-1.5 py-1.5">Tanggal</th>
                  {baseParams.map((p) => (
                    <th key={p} className="border border-slate-300 px-1.5 py-1.5">{PARAM_META[p].short}{PARAM_META[p].unit ? ` (${PARAM_META[p].unit})` : ""}</th>
                  ))}
                  <th className="border border-slate-300 px-1.5 py-1.5">No. Kontrol Media</th>
                  <th className="border border-slate-300 px-1.5 py-1.5">Kontrol Negatif</th>
                  <th className="border border-slate-300 px-1.5 py-1.5">No. Kontrol Bakteri</th>
                  <th className="border border-slate-300 px-1.5 py-1.5">Kontrol Positif</th>
                  <th className="border border-slate-300 px-1.5 py-1.5">Tanggal Baca</th>
                  {isWFIType && (
                    <>
                      <th className="border border-slate-300 px-1.5 py-1.5">{PARAM_META.endotoksin.short} ({PARAM_META.endotoksin.unit})</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">Kontrol Negatif</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">Kontrol Positif</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">No Bet LAL</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">No Bet CSE</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">Sensitivitas LAL</th>
                      <th className="border border-slate-300 px-1.5 py-1.5">Sensitivitas CSE</th>
                    </>
                  )}
                  <th className="border border-slate-300 px-1.5 py-1.5">Kesimpulan</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((grp) => {
                  const rec = findKontrolMingguan(kontrolRecords, grp.wk.key, systemKey, monthKey) || {};
                  // Deviasi Kontrol Mingguan berlaku untuk SEMUA baris di minggu itu
                  // (kalau kontrolnya tidak valid, seluruh hasil minggu itu diragukan).
                  let weekDeviates = false;
                  if (rec.kontrolPositif && rec.kontrolPositif !== "Positif") weekDeviates = true;
                  if (rec.kontrolNegatif && rec.kontrolNegatif !== "Negatif") weekDeviates = true;
                  if (isWFIType) {
                    if (rec.kontrolPositifLAL && rec.kontrolPositifLAL !== "Positif") weekDeviates = true;
                    if (rec.kontrolNegatifLAL && rec.kontrolNegatifLAL !== "Negatif") weekDeviates = true;
                  }
                  return (
                    <Fragment key={grp.wk.key}>
                      <tr className="bg-slate-100">
                        <td colSpan={colCount} className="border border-slate-300 px-1.5 py-1 font-semibold text-slate-600">Minggu {grp.wk.weekNum}</td>
                      </tr>
                      {grp.rows.map((e, idx) => {
                        let maxLevel = weekDeviates ? 4 : 0;
                        baseParams.forEach((p) => { const st = statusFor(e[p], p, system.jenis); if (st.level > maxLevel) maxLevel = st.level; });
                        if (isWFIType) { const st = statusFor(e.endotoksin, "endotoksin", system.jenis); if (st.level > maxLevel) maxLevel = st.level; }
                        const ket = maxLevel >= 4 ? "TMS" : maxLevel === 0 ? "-" : "MS";
                        return (
                          <tr key={e.id}>
                            <td className="border border-slate-300 px-1.5 py-1 font-medium">{e.titikSampling}</td>
                            <td className="border border-slate-300 px-1.5 py-1">{isoToID(e.tanggal)}</td>
                            {baseParams.map((p) => <td key={p} className="border border-slate-300 px-1.5 py-1 text-center">{displayValue(e[p])}</td>)}
                            {idx === 0 && (
                              <>
                                <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.noKontrolMedia || "-"}</td>
                                <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.kontrolNegatif || "-"}</td>
                                <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.noKontrolBakteri || "-"}</td>
                                <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.kontrolPositif || "-"}</td>
                              </>
                            )}
                            <td className="border border-slate-300 px-1.5 py-1 text-center">{isoToID(addDaysISO(e.tanggal, 3))}</td>
                            {isWFIType && (
                              <>
                                <td className="border border-slate-300 px-1.5 py-1 text-center">{displayValue(e.endotoksin)}</td>
                                {idx === 0 && (
                                  <>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.kontrolNegatifLAL || "-"}</td>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.kontrolPositifLAL || "-"}</td>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.noBetLAL || "-"}</td>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.noBetCSE || "-"}</td>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.sensitivitasLAL || "-"}</td>
                                    <td rowSpan={grp.rows.length} className="border border-slate-300 px-1.5 py-1 text-center align-middle">{rec.sensitivitasCSE || "-"}</td>
                                  </>
                                )}
                              </>
                            )}
                            <td className={`border border-slate-300 px-1.5 py-1 text-center font-semibold ${ket === "TMS" ? "text-red-600" : ket === "-" ? "text-slate-400" : "text-emerald-600"}`}>{ket}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 p-5 print-card">
            <h3 className="mb-3 text-sm font-bold text-slate-700">Tanda Tangan</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { field: "analis", label: "Diperiksa Oleh", nama: analis.nama, tanggal: analis.tanggal,
                  canApprove: canInput, onApprove: handleSave,
                  disabledNote: "Hanya Staff s/d Manager QC yang bisa menandatangani" },
                { field: "diperiksa", label: "Mengetahui", nama: diperiksa.nama, tanggal: diperiksa.tanggal,
                  canApprove: canApprove, onApprove: handleApprove,
                  disabledNote: analis.nama ? "Hanya Supervisor s/d Manager QC yang bisa menyetujui" : "Menunggu tanda tangan \"Diperiksa Oleh\" terlebih dahulu" },
              ].map(({ field, label, nama, tanggal, canApprove: fieldCanApprove, onApprove, disabledNote }) => (
                <div key={field} className="rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <div className="mb-3 flex h-24 items-center justify-center rounded border border-dashed border-slate-300 print:h-28">
                    {nama ? (
                      <VerifyQR type="reportHasil" system={systemKey} period={monthKey} slot={field} size={68} />
                    ) : (
                      <span className="only-screen text-xs text-slate-300">Ruang tanda tangan</span>
                    )}
                  </div>
                  {nama ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold text-slate-700">{nama}</p>
                      <p className="text-xs text-slate-400">{tanggal ? fullDateID(tanggal) : ""}</p>
                    </div>
                  ) : field === "diperiksa" && !analis.nama ? (
                    <p className="no-print inline-flex items-center gap-1.5 text-xs text-slate-400"><Lock size={12} /> {disabledNote}</p>
                  ) : fieldCanApprove ? (
                    <button onClick={onApprove} disabled={saving || approving}
                      className="no-print inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                      {(saving || approving) ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Setujui &amp; Tanda Tangani
                    </button>
                  ) : (
                    <p className="no-print inline-flex items-center gap-1.5 text-xs text-slate-400"><Lock size={12} /> {disabledNote}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
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

/* ========================================================================= KONTROL MINGGUAN (Nomor Kontrol Media/Bakteri + Kontrol Positif/Negatif) */
// Diisi 1x per minggu (bukan per baris data POU). Defaultnya SATU nomor yang
// sama otomatis berlaku untuk semua sistem minggu itu; kalau minggu tertentu
// nomornya beda untuk sistem ini saja, centang "Khusus sistem ini".
function emptyKontrolFields() {
  return {
    noKontrolMedia: "", noKontrolBakteri: "", kontrolPositif: "", kontrolNegatif: "",
    kontrolNegatifLAL: "", kontrolPositifLAL: "", noBetLAL: "", noBetCSE: "", sensitivitasLAL: "", sensitivitasCSE: "",
  };
}

function kontrolFieldsFrom(rec) {
  const f = emptyKontrolFields();
  Object.keys(f).forEach((k) => { f[k] = rec?.[k] || ""; });
  return f;
}

// Default diisi 1x per BULAN dan otomatis berlaku untuk seluruh minggu bulan
// itu — TAPI HANYA untuk fasilitas (sistem) ini sendiri. Fasilitas lain yang
// looping di bulan yang sama tetap wajib mengisi Default-nya masing-masing
// (walau angkanya kebetulan sama). Kalau ada minggu tertentu yang perlu
// dibedakan lagi, tambahkan sebagai "pengecualian" dengan memilih minggu ke
// berapa yang mau diganti — pengecualian ini menang dari Default untuk
// minggu itu saja.
function KontrolMingguanPanel({ systemKey, jenis, monthKey, entries, records, canInput, saving, onSave }) {
  const isWFIType = jenis === "WFI" || jenis === "Pure Steam";
  const defaultWeekKey = monthDefaultWeekKey(monthKey);

  const weeks = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      if (!e.tanggal) return;
      const wk = weekKeyForISO(e.tanggal);
      if (wk && !map.has(wk.key)) map.set(wk.key, wk);
    });
    return Array.from(map.values()).sort((a, b) => (a.year - b.year) || (a.month - b.month) || (a.weekNum - b.weekNum));
  }, [entries]);

  // Inisialisasi LANGSUNG dari props saat komponen ini dipasang (mount) —
  // bukan lewat useEffect + flag "sudah dimuat" (itu yang sebelumnya bikin
  // data kadang tidak muncul lagi setelah balik dari halaman print: begitu
  // flag itu keburu "true", data baru dari server tidak pernah disinkron
  // ulang). Karena panel ini betul-betul dipasang ulang (unmount lalu mount
  // lagi) tiap kali pindah dari/ke halaman Formulir QC, initializer ini akan
  // selalu jalan dengan data terbaru yang sudah dimuat SystemDetail.
  const [defaultRow, setDefaultRow] = useState(() => {
    const rec = records.find((r) => r.weekKey === defaultWeekKey && r.system === systemKey);
    return kontrolFieldsFrom(rec);
  });

  const [exceptions, setExceptions] = useState(() => {
    const prefix = monthKey + "-W";
    const init = {};
    records.forEach((r) => {
      if (r.weekKey.indexOf(prefix) !== 0) return;
      if (r.weekKey === defaultWeekKey) return; // itu Default, bukan pengecualian
      if (r.system !== systemKey) return;
      init[r.weekKey] = kontrolFieldsFrom(r);
    });
    return init;
  });

  const [addWeekKey, setAddWeekKey] = useState("");
  const [pendingClears, setPendingClears] = useState([]);

  function updateDefault(patch) {
    setDefaultRow((prev) => ({ ...prev, ...patch }));
  }

  function updateException(weekKey, patch) {
    setExceptions((prev) => ({ ...prev, [weekKey]: { ...prev[weekKey], ...patch } }));
  }

  function addException() {
    if (!addWeekKey) return;
    setExceptions((prev) => ({ ...prev, [addWeekKey]: { ...defaultRow } }));
    setAddWeekKey("");
  }

  function removeException(weekKey) {
    setExceptions((prev) => {
      const { [weekKey]: _removed, ...rest } = prev;
      return rest;
    });
    setPendingClears((prev) => [...prev, weekKey]);
  }

  const exceptionWeekKeys = Object.keys(exceptions).sort();
  const addableWeeks = weeks.filter((wk) => !exceptions[wk.key]);

  function handleSaveAll() {
    const out = [{ weekKey: defaultWeekKey, system: systemKey, ...defaultRow }];
    exceptionWeekKeys.forEach((weekKey) => {
      out.push({ weekKey, system: systemKey, ...kontrolFieldsFrom(exceptions[weekKey]) });
    });
    // Pengecualian yang barusan dihapus di layar -> kosongkan juga di server
    // (bukan cuma disembunyikan di layar) supaya minggu itu betul-betul
    // kembali mengikuti Default, bukan nyangkut ke data lama yang basi.
    pendingClears.forEach((weekKey) => out.push({ weekKey, system: systemKey, ...emptyKontrolFields() }));
    onSave(out);
    setPendingClears([]);
  }

  function renderFieldInputs(row, onPatch) {
    return (
      <>
        <td className="px-3 py-2">
          <input type="text" disabled={!canInput} value={row.noKontrolMedia || ""} placeholder="-"
            onChange={(ev) => onPatch({ noKontrolMedia: ev.target.value })}
            className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
        </td>
        <td className="px-3 py-2">
          <input type="text" disabled={!canInput} value={row.noKontrolBakteri || ""} placeholder="-"
            onChange={(ev) => onPatch({ noKontrolBakteri: ev.target.value })}
            className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
        </td>
        <td className="px-3 py-2">
          <select disabled={!canInput} value={row.kontrolPositif || ""} onChange={(ev) => onPatch({ kontrolPositif: ev.target.value })}
            className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50">
            <option value="">-</option>
            {QUALI_OPTIONS.kontrolPositif.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <select disabled={!canInput} value={row.kontrolNegatif || ""} onChange={(ev) => onPatch({ kontrolNegatif: ev.target.value })}
            className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50">
            <option value="">-</option>
            {QUALI_OPTIONS.kontrolNegatif.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </td>
        {isWFIType && (
          <>
            <td className="px-3 py-2">
              <select disabled={!canInput} value={row.kontrolNegatifLAL || ""} onChange={(ev) => onPatch({ kontrolNegatifLAL: ev.target.value })}
                className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50">
                <option value="">-</option>
                {QUALI_OPTIONS.kontrolNegatif.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </td>
            <td className="px-3 py-2">
              <select disabled={!canInput} value={row.kontrolPositifLAL || ""} onChange={(ev) => onPatch({ kontrolPositifLAL: ev.target.value })}
                className="w-28 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50">
                <option value="">-</option>
                {QUALI_OPTIONS.kontrolPositif.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </td>
            <td className="px-3 py-2">
              <input type="text" disabled={!canInput} value={row.noBetLAL || ""} placeholder="-"
                onChange={(ev) => onPatch({ noBetLAL: ev.target.value })}
                className="w-24 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
            </td>
            <td className="px-3 py-2">
              <input type="text" disabled={!canInput} value={row.noBetCSE || ""} placeholder="-"
                onChange={(ev) => onPatch({ noBetCSE: ev.target.value })}
                className="w-24 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
            </td>
            <td className="px-3 py-2">
              <input type="text" disabled={!canInput} value={row.sensitivitasLAL || ""} placeholder="-"
                onChange={(ev) => onPatch({ sensitivitasLAL: normalizeNumericInput(ev.target.value) })}
                className="w-20 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
            </td>
            <td className="px-3 py-2">
              <input type="text" disabled={!canInput} value={row.sensitivitasCSE || ""} placeholder="-"
                onChange={(ev) => onPatch({ sensitivitasCSE: normalizeNumericInput(ev.target.value) })}
                className="w-20 rounded border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50" />
            </td>
          </>
        )}
      </>
    );
  }

  return (
    <div className="no-print mb-5 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Kontrol Mingguan</h3>
          <p className="text-xs text-slate-400">Nomor Kontrol Media/Bakteri &amp; hasil Kontrol Positif/Negatif{isWFIType ? " (mikrobiologi & LAL/Endotoksin)" : ""} — isi sekali untuk fasilitas ini, otomatis berlaku untuk seluruh bulan ini. Tambahkan pengecualian kalau ada minggu tertentu yang beda.</p>
        </div>
        {canInput && (
          <button onClick={handleSaveAll} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Kontrol Mingguan
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Berlaku untuk</th>
              <th className="px-3 py-2">No. Kontrol Media</th>
              <th className="px-3 py-2">No. Kontrol Bakteri</th>
              <th className="px-3 py-2">Kontrol Positif</th>
              <th className="px-3 py-2">Kontrol Negatif</th>
              {isWFIType && (
                <>
                  <th className="px-3 py-2">Kontrol Negatif (LAL)</th>
                  <th className="px-3 py-2">Kontrol Positif (LAL)</th>
                  <th className="px-3 py-2">No Bet LAL</th>
                  <th className="px-3 py-2">No Bet CSE</th>
                  <th className="px-3 py-2">Sensitivitas LAL</th>
                  <th className="px-3 py-2">Sensitivitas CSE</th>
                </>
              )}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100 bg-teal-50/40">
              <td className="px-3 py-2 font-medium">Default — seluruh bulan ini<br /><span className="font-normal text-xs text-slate-400">(khusus fasilitas ini)</span></td>
              {renderFieldInputs(defaultRow, updateDefault)}
              <td className="px-3 py-2"></td>
            </tr>
            {exceptionWeekKeys.map((weekKey) => {
              const row = exceptions[weekKey];
              const wk = weeks.find((w) => w.key === weekKey);
              return (
                <tr key={weekKey} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium">{wk ? weekLabel(wk) : weekKey}</td>
                  {renderFieldInputs(row, (patch) => updateException(weekKey, patch))}
                  <td className="px-3 py-2 text-center">
                    {canInput && (
                      <button onClick={() => removeException(weekKey)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Hapus pengecualian (kembali ke default)">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canInput && addableWeeks.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <select value={addWeekKey} onChange={(ev) => setAddWeekKey(ev.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">-- Pilih minggu untuk dikecualikan --</option>
            {addableWeeks.map((wk) => <option key={wk.key} value={wk.key}>{weekLabel(wk)}</option>)}
          </select>
          <button onClick={addException} disabled={!addWeekKey}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <Plus size={14} /> Tambah Pengecualian Minggu
          </button>
        </div>
      )}
    </div>
  );
}
/* ========================================================================= SYSTEM DETAIL (halaman Pengkajian SPA) */
function SystemDetail({ systemKey, monthKey, setMonthKey, onBack, onSaved, session, token }) {
  const system = SYSTEMS.find((s) => s.key === systemKey);
  const params = PARAMS_BY_JENIS[system.jenis] || [];

  const isAdmin = session?.role === "Administrator";
  const isTamu = session?.role === "Tamu";
  const isQA = isAdmin || (!isTamu && session?.departemen === "QA");
  const isQC = isAdmin || (!isTamu && session?.departemen === "QC");
  const [mode, setMode] = useState("pengkajian"); // 'pengkajian' | 'reportHasil'

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [entries, setEntries] = useState([]);
  const [masterPoints, setMasterPoints] = useState([]);
  const [narrative, setNarrative] = useState(emptyNarrative());
  const [signoff, setSignoff] = useState(emptySignoff());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [approving, setApproving] = useState(false);
  const [kontrolRecords, setKontrolRecords] = useState([]);
  const [kontrolSaving, setKontrolSaving] = useState(false);
  const [kontrolError, setKontrolError] = useState("");
  const [reportHasilMeta, setReportHasilMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [ent, rep, pts, kontrol, rh] = await Promise.all([
          fetchEntries(systemKey, monthKey),
          fetchReport(systemKey, monthKey),
          fetchMaster(systemKey),
          fetchKontrolMingguan().catch(() => []),
          fetchReportHasil(systemKey, monthKey).catch(() => null),
        ]);
        if (cancelled) return;
        setEntries(ent.map((e) => ({ ...e, id: e.id || uid() })));
        setMasterPoints(pts);
        setKontrolRecords(kontrol);
        setReportHasilMeta(rh);
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

  // Formulir QC (Report_Hasil) sudah final di-acc Supervisor/Manager QC?
  const qcFinalApproved = !!reportHasilMeta?.diperiksa?.nama;
  // Pengkajian (narasi QA) sudah final di-acc Manager QA ("Mengetahui")?
  // Begitu ini true, seluruh data (entri, kontrol mingguan, formulir QC,
  // narasi) jadi arsip terkunci — hanya Administrator yang masih bisa ubah/hapus.
  const pengkajianFinalized = !!signoff?.diperiksa?.nama;
  const recordsLocked = !isAdmin && pengkajianFinalized;

  // QC (Staff-Manager QC) & QA (Supervisor/Manager QA, membantu input) boleh
  // isi/hapus data SELAMA formulir QC belum final di-acc & pengkajian belum
  // final — begitu salah satu sudah final, data dianggap selesai/terkunci.
  const canInputQC = isAdmin || (!recordsLocked && !qcFinalApproved && (hasAccess(session, "Staff", "QC") || hasAccess(session, "Supervisor", "QA")));
  const canDeleteQC = isAdmin || (!recordsLocked && !qcFinalApproved && (hasAccess(session, "Supervisor", "QC") || hasAccess(session, "Supervisor", "QA")));
  // QA baru boleh mulai menyusun pengkajian SETELAH formulir QC selesai final
  // di-acc oleh Supervisor/Manager QC (Administrator boleh kapan saja).
  const canEditQA = isAdmin || (!recordsLocked && qcFinalApproved && hasAccess(session, "Supervisor", "QA"));
  const canApproveFinal = isAdmin || (!recordsLocked && qcFinalApproved && hasAccess(session, "Manager", "QA"));
  // Tamu (login) & siapa pun yang login boleh lihat pembahasan/pengkajian
  // lengkap; publik tanpa login hanya boleh lihat data hasil pengujian mentah.
  const canViewPembahasan = !!session;
  const canPrint = hasAccess(session, "Staff");

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

  const handleSaveKontrolMingguan = useCallback(async (records) => {
    setKontrolSaving(true);
    setKontrolError("");
    try {
      const res = await apiSaveKontrolMingguan(records, token);
      if (res.error) throw new Error(res.error);
      const fresh = await fetchKontrolMingguan().catch(() => []);
      setKontrolRecords(fresh);
      onSaved && onSaved();
    } catch (err) {
      setKontrolError("Gagal menyimpan Kontrol Mingguan: " + err.message);
    } finally {
      setKontrolSaving(false);
    }
  }, [token, onSaved]);

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
    let prevEntries = [];
    try {
      const prevRes = await fetchEntries(systemKey, prevMonthKey(monthKey));
      prevEntries = prevRes || [];
    } catch {
      // biarkan kosong — reviewTren akan otomatis menjelaskan belum ada data pembanding
    }
    const localRes = generateLocalNarrative({
      systemLabel: system.label, jenisAir: system.jenis, monthLabel: monthLabel(monthKey), entries, prevEntries,
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
      const prevStats = prevEntries.length > 0 ? buildStatsSummary(system, prevEntries) : null;
      let prevSummary = "Tidak ada data periode sebelumnya.";
      try {
        const prevRep = await fetchReport(systemKey, prevMonthKey(monthKey));
        if (prevRep.found) prevSummary = prevRep.narrative?.kesimpulan || "Ada data periode sebelumnya, namun tanpa ringkasan tertulis.";
      } catch {
        // biarkan default
      }
      const parsed = await generateNarrative({
        systemLabel: system.label, jenisAir: system.jenis, monthLabel: monthLabel(monthKey), stats, prevStats, prevSummary,
      });
      setNarrative((prev) => ({
        ...prev, pendahuluan: localRes.pendahuluan,
        perParameter: { ...prev.perParameter, ...parsed.perParameter },
        reviewTren: parsed.reviewTren || localRes.reviewTren, kesimpulan: parsed.kesimpulan || localRes.kesimpulan,
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
        session={session} token={token}
        onBack={() => {
          setMode("pengkajian");
          fetchReportHasil(systemKey, monthKey).then(setReportHasilMeta).catch(() => {});
        }}
        kontrolRecords={kontrolRecords} masterPoints={masterPoints} />
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 print:max-w-none print:p-0" data-print-blocked={!canPrint}>
      <div className="print-blocked-notice">Akses print/download PDF dibatasi untuk akun Staff/Supervisor/Manager ke atas. Silakan login dengan akun yang sesuai.</div>
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft size={16} /> Kembali ke Dashboard
        </button>
        <div className="flex items-center gap-2">
          <input type="month" value={monthKey} onChange={(ev) => setMonthKey(ev.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          {(isQC || isQA) && (
            <button onClick={() => setMode("reportHasil")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Printer size={15} /> {isQC ? "Report Hasil Pemeriksaan" : "Lihat Formulir QC"}
            </button>
          )}
          {isQA && canPrint && (
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Printer size={15} /> Download / Print PDF
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 print-card">
        <div className="bg-gradient-to-r from-teal-950 via-teal-900 to-teal-800 px-5 py-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <img src="/logo-rama.png" alt="Logo PT. Rama Emerald Multi Sukses" className="h-12 w-12 shrink-0 object-contain brightness-0 invert" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">PT. Rama Emerald Multi Sukses — QA</p>
                <h2 className="text-xl font-bold text-white">Pengkajian Trend Data Sistem Pengolahan Air (SPA)</h2>
                <p className="text-sm text-teal-100">
                  Sistem: <span className="font-medium text-white">{system.label}</span> · Periode: <span className="font-medium text-white">{monthLabel(monthKey)}</span>
                </p>
              </div>
            </div>
            <p className="shrink-0 text-xs font-medium text-teal-100 sm:text-right">No. Formulir: <span className="text-white">QA.FM.156</span></p>
          </div>
        </div>
        <div className="flex items-center justify-between bg-white px-5 py-3">
          <span className="text-xs text-slate-400">Status keseluruhan periode ini</span>
          <StatusPill level={overallLevel} hasData={entries.length > 0} />
        </div>
      </div>

      {saveError && <p className="no-print mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{saveError}</p>}

      {!session && (
        <div className="no-print mb-4 rounded-lg bg-teal-50 px-4 py-2.5 text-sm text-teal-700">
          Anda melihat mode publik — hanya data hasil pengujian mentah. Login untuk melihat grafik, pembahasan, dan pengkajian lengkap.
        </div>
      )}
      {session && recordsLocked && (
        <div className="no-print mb-4 flex items-center gap-1.5 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
          <Lock size={14} /> Pengkajian periode ini sudah final (disetujui) — data terkunci, hanya Administrator yang bisa mengubah/menghapus.
        </div>
      )}
      {session && !recordsLocked && !qcFinalApproved && !isQC && isQA && (
        <div className="no-print mb-4 flex items-center gap-1.5 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Lock size={14} /> Formulir QC belum final disetujui Supervisor/Manager QC — pengkajian baru bisa disusun setelah itu selesai.
        </div>
      )}

      <div className="no-print mb-5">
        <EntryEditor system={system} masterPoints={masterPoints} entries={entries} setEntries={setEntries} onSave={saveEntriesOnly} saving={saving}
          canInput={canInputQC} canDeleteExisting={canDeleteQC}
          accessNote={
            !session ? "Login untuk mengisi data"
            : recordsLocked ? "Pengkajian sudah final — data terkunci (hanya Administrator)"
            : qcFinalApproved ? "Formulir QC sudah final di-acc — data terkunci (hanya Administrator)"
            : "Staff/Supervisor/Manager QC atau Supervisor/Manager QA yang bisa mengisi data"
          } />
      </div>

      {kontrolError && <p className="no-print mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{kontrolError}</p>}
      <KontrolMingguanPanel systemKey={systemKey} jenis={system.jenis} monthKey={monthKey} entries={entries} records={kontrolRecords}
        canInput={canInputQC} saving={kontrolSaving} onSave={handleSaveKontrolMingguan} />

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
                const limit = getLimit(p, system.jenis);
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

      {canViewPembahasan ? (
      <>
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
            <Lock size={12} />
            {recordsLocked ? "Pengkajian sudah final — terkunci"
              : !qcFinalApproved ? "Menunggu Formulir QC di-acc Supervisor/Manager QC"
              : "Hanya Supervisor/Manager QA yang bisa menyusun narasi"}
          </span>
        )}
      </div>
      {aiError && <p className="no-print mb-3 text-sm text-red-600">{aiError}</p>}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Pendahuluan</label>
        <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none"
          rows={4} value={narrative.pendahuluan} onChange={(ev) => setNarrative({ ...narrative, pendahuluan: ev.target.value })} readOnly={!canEditQA} />
      </div>

      <div className="mb-5 space-y-4">
        {params.map((p) => (
          <div key={p} className="overflow-hidden rounded-xl border border-slate-200 bg-white print-card">
            <div className="p-4"><ParamValueTable entries={entries} paramKey={p} jenis={system.jenis} /></div>
            {!getLimit(p, system.jenis).qualitative && <div className="px-4 pb-4"><ParamChart entries={entries} paramKey={p} systemLabel={system.label} jenis={system.jenis} /></div>}
            <div className="border-t border-slate-100 p-4 avoid-break">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Hasil &amp; Tren {PARAM_META[p].short}
              </label>
              <AutoTextarea
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
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
          <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none"
            rows={6} placeholder="Opsional — isi kalau ada data periode sebelumnya untuk dibandingkan."
            value={narrative.reviewTren} onChange={(ev) => setNarrative({ ...narrative, reviewTren: ev.target.value })} readOnly={!canEditQA} />
        </div>
      )}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Kesimpulan</h3>
        <AutoTextarea className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700 focus:border-teal-400 focus:outline-none"
          rows={8} value={narrative.kesimpulan} onChange={(ev) => setNarrative({ ...narrative, kesimpulan: ev.target.value })} readOnly={!canEditQA} />
      </div>

      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 print-card">
        <h3 className="mb-3 text-sm font-bold text-slate-700">Tanda Tangan</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { field: "dinilai", label: "Dikaji Oleh", canApprove: canEditQA, onApprove: handleApproveDikaji,
              disabledNote: !qcFinalApproved ? "Menunggu Formulir QC di-acc Supervisor/Manager QC" : "Hanya Supervisor/Manager QA yang bisa menyetujui" },
            { field: "diperiksa", label: "Mengetahui", canApprove: canApproveFinal, onApprove: handleApproveMengetahui,
              disabledNote: !qcFinalApproved ? "Menunggu Formulir QC di-acc Supervisor/Manager QC" : signoff.dinilai?.nama ? "Hanya Manager QA yang bisa menyetujui final" : "Menunggu approval \"Dikaji Oleh\" terlebih dahulu" },
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
          <button onClick={saveNarrativeOnly} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Simpan Narasi &amp; Pembahasan
          </button>
        </div>
      )}
      </>
      ) : (
        <div className="mb-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <Lock size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">Grafik, pembahasan, dan pengkajian lengkap hanya bisa dilihat oleh akun yang sudah login.</p>
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
          <Lock size={18} className="text-teal-700" />
          <h3 className="text-base font-bold text-slate-800">Login SPA</h3>
        </div>
        <form onSubmit={submit}>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Username</label>
          <input autoFocus type="text" value={username} onChange={(ev) => setUsername(ev.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password</label>
          <input type="password" value={password} onChange={(ev) => setPassword(ev.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Batal
            </button>
            <button type="submit" disabled={submitting || !username || !password}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
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
          <Lock size={18} className="text-teal-700" />
          <h3 className="text-base font-bold text-slate-800">Ganti Password</h3>
        </div>
        {success ? (
          <div>
            <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Password berhasil diganti.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800">
                Tutup
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password Lama</label>
            <input autoFocus type="password" value={oldPassword} onChange={(ev) => setOldPassword(ev.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Password Baru</label>
            <input type="password" value={newPassword} onChange={(ev) => setNewPassword(ev.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Ulangi Password Baru</label>
            <input type="password" value={confirmPassword} onChange={(ev) => setConfirmPassword(ev.target.value)}
              className="mb-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
            <p className="mb-4 text-xs text-slate-400">Minimal 6 karakter. Lupa password lama? Hubungi Administrator, bukan lewat form ini.</p>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="submit" disabled={submitting || !oldPassword || !newPassword || !confirmPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
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
            <button onClick={onLoginClick} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">
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
  const period = params.get("month");
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
      periodLabel = "Periode: " + monthLabel(period);
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

  // Blokir shortcut cetak (Ctrl+P / Cmd+P) untuk publik (belum login) & role
  // Tamu — cadangan tambahan di atas aturan CSS @media print (yang menyensor
  // isi cetakan apa pun caranya, termasuk lewat menu/File > Print browser).
  useEffect(() => {
    const canPrint = hasAccess(session, "Staff");
    if (canPrint) return;
    function blockPrintShortcut(ev) {
      const isPrintCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "p" || ev.key === "P");
      if (isPrintCombo) {
        ev.preventDefault();
        ev.stopPropagation();
        window.alert("Print/Download PDF hanya untuk akun Staff/Supervisor/Manager ke atas. Silakan login dengan akun yang sesuai.");
      }
    }
    window.addEventListener("keydown", blockPrintShortcut, true);
    return () => window.removeEventListener("keydown", blockPrintShortcut, true);
  }, [session]);

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
        .print-blocked-notice { display: none; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          .no-print { display: none !important; }
          .only-screen { display: none !important; }
          .only-print { display: block !important; }
          .print-card { box-shadow: none !important; border: 1px solid #cbd5e1 !important; page-break-inside: avoid; break-inside: avoid; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          [data-print-blocked="true"] > *:not(.print-blocked-notice) { display: none !important; }
          [data-print-blocked="true"] .print-blocked-notice {
            display: block !important; padding: 5rem 2rem; text-align: center;
            font-size: 15px; font-weight: 700; color: #334155;
          }
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
