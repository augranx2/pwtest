// Vercel Serverless Function: /api/generate-narrative
// Menerima ringkasan data SPA (PW/WFI/Pure Steam) dari website, memanggil
// Gemini API (Google AI Studio) untuk menyusun narasi, dan mengembalikan
// hasilnya.
//
// PENTING: GEMINI_API_KEY diambil dari Environment Variable di Vercel,
// BUKAN ditulis langsung di file ini — supaya API key tidak ikut ter-upload
// ke GitHub/repo publik.
//
// Cara set di Vercel:
// 1. Buka project SPA ini di dashboard Vercel -> Settings -> Environment Variables
// 2. Tambahkan: Name = GEMINI_API_KEY, Value = (API key Gemini Anda — boleh
//    pakai key yang sama dengan project EM Viable, atau key baru, terserah)
// 3. Pilih semua environment (Production, Preview, Development), lalu Save
// 4. Redeploy project agar env var terbaca

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "GEMINI_API_KEY belum diset di Environment Variables Vercel. Buka Settings > Environment Variables lalu tambahkan GEMINI_API_KEY, kemudian redeploy.",
    });
    return;
  }

  let payload;
  try {
    payload = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    res.status(400).json({ error: "Body request tidak valid" });
    return;
  }

  const { systemLabel, jenisAir, monthLabel, stats, prevSummary } = payload;
  const params = Object.keys(stats || {});

  const prompt = `Anda adalah QA Apoteker berpengalaman di industri farmasi Indonesia yang menyusun bagian pembahasan untuk dokumen resmi "Pengkajian Trend Data Sistem Pengolahan Air (SPA)", mengacu pada Standar CPOB tahun 2024 dan 2025 yang berlaku.
Jenis air/uap: ${jenisAir}
Sistem: ${systemLabel}
Periode: ${monthLabel}
Ringkasan kesimpulan periode sebelumnya: ${prevSummary || "Tidak ada data periode sebelumnya."}
Data ringkasan per parameter — berisi rentang nilai (min-max), limit Syarat/Alert/Action (pH punya batas ATAS dan BAWAH, parameter lain cuma batas atas), dan daftar titik+tanggal yang mencapai Alert/Action/Melebihi Syarat:
${JSON.stringify(stats, null, 2)}

Tulis narasi Bahasa Indonesia formal ala dokumen QA farmasi (gaya umum yang mudah dipahami, bukan bahasa akademis berat), mengacu HANYA pada data di atas — jangan mengarang angka, titik sampling, atau tanggal yang tidak ada di data.

KETENTUAN PENTING soal istilah "penyimpangan": hasil yang mencapai Alert Limit atau Action Limit BUKAN penyimpangan — itu masih di bawah batas Syarat (spesifikasi), jadi masih memenuhi persyaratan. Untuk hasil seperti itu, JANGAN pakai kata "penyimpangan", dan jangan sarankan tindakan berat seperti investigasi RCA/CAPA formal. Cukup sebutkan bahwa nilai tersebut perlu dievaluasi/dicermati pada hasil pengujian periode berikutnya, dan boleh menyinggung peninjauan efektivitas sanitasi/flushing sistem sebagai langkah pencegahan yang wajar. Istilah "penyimpangan" HANYA dipakai kalau ada hasil yang benar-benar melampaui batas Syarat (spesifikasi) — dalam kasus itu baru sarankan investigasi dan pengujian ulang.

Untuk tiap parameter berikut (${params.join(", ")}), tulis 1 narasi (2-4 kalimat/1 paragraf pendek) yang menyebutkan: rentang nilai hasil pengujian, apakah memenuhi spesifikasi, titik+tanggal untuk nilai tertinggi (dan terendah bila relevan), dan status terhadap Alert/Action Limit sesuai ketentuan di atas. Untuk parameter "endotoksin" (kalau ada), ini kualitatif (Negatif/Positif) — cukup nyatakan apakah seluruhnya Negatif atau ada yang Positif.

Untuk "kesimpulan": tulis ringkasan akhir seluruh parameter pada periode ini (rekap singkat tiap parameter digabung jadi satu narasi mengalir, 3-5 kalimat/beberapa paragraf pendek), gunakan kata "terkendali" (JANGAN pakai istilah "state of control" atau istilah Inggris lain yang tidak perlu), terapkan ketentuan istilah "penyimpangan" di atas secara konsisten, dan DIAKHIRI dengan pernyataan tegas apakah sistem ini memenuhi persyaratan Standar CPOB tahun 2024 dan 2025 yang berlaku dan layak digunakan mendukung proses produksi.

Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain) dengan struktur persis:
{
  "perParameter": { "<nama_parameter>": "narasi parameter ini sesuai ketentuan di atas", ... satu entri untuk tiap parameter berikut: ${params.join(", ")} },
  "kesimpulan": "ringkasan akhir sesuai ketentuan di atas"
}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error (HTTP ${geminiRes.status}): ${errText}`);
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const cleanText = text
      .replace(/^```json\n?/i, "")
      .replace(/^```\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanText);

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}
