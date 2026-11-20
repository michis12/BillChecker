/* Rechnungsscan: Bild vorbereiten, Texterkennung (Tesseract.js, läuft im Browser), Bon auswerten */
(function (root) {
  const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";

  const BRANDS = [
    ["lebensmittel", ["interspar", "eurospar", "spar", "billa", "hofer", "lidl", "penny", "mpreis", "m-preis", "unimarkt", "nah&frisch", "nah & frisch", "merkur", "aldi", "rewe", "edeka", "kaufland", "metro", "maximarkt", "denn's", "biomarkt"]],
    ["gesundheit", ["dm drogerie", "dm-drogerie", "bipa", "müller", "rossmann", "apotheke", "optik", "fielmann"]],
    ["transport", ["omv", "shell", "eni", "avanti", "turmöl", "turmoel", "aral", "jet tankstelle", "bp ", "öbb", "oebb", "wiener linien", "westbahn", "linz ag", "flixbus", "tankstelle", "diesel", "super 95", "parkgarage", "parken", "apcoa", "asfinag"]],
    ["essen", ["mcdonald", "burger king", "kfc", "subway", "starbucks", "nordsee", "vapiano", "restaurant", "gasthaus", "gasthof", "pizzeria", "pizza", "kebap", "kebab", "döner", "doner", "cafe", "café", "bäckerei", "baeckerei", "ströck", "stroeck", "anker", "backwerk", "five guys", "dunkin", "wirtshaus", "bar & ", "lounge"]],
    ["shopping", ["h&m", "h & m", "zara", "primark", "c&a", "mediamarkt", "media markt", "saturn", "deichmann", "humanic", "intersport", "hervis", "foot locker", "snipes", "peek", "tk maxx", "action", "tedi", "pepco", "kik", "new yorker", "bershka", "pull&bear", "jd sports", "decathlon", "thalia", "amazon"]],
    ["wohnen", ["ikea", "obi", "bauhaus", "hornbach", "xxxlutz", "möbelix", "moebelix", "kika", "leiner", "lagerhaus", "jysk"]],
    ["bildung", ["libro", "pagro", "morawa", "schreibwaren"]],
    ["freizeit", ["cineplexx", "kino", "megaplex", "bowling", "therme", "fitness", "clever fit", "mcfit", "eintritt", "ticket"]],
    ["abos", ["spotify", "netflix", "magenta", "drei.at", "hot telekom", "yesss"]]
  ];
  const PRETTY = { "dm drogerie": "dm", "dm-drogerie": "dm", "mcdonald": "McDonald's", "h&m": "H&M", "h & m": "H&M", "c&a": "C&A", "omv": "OMV", "bp ": "BP", "öbb": "ÖBB", "oebb": "ÖBB", "kfc": "KFC", "tk maxx": "TK Maxx", "xxxlutz": "XXXLutz", "mpreis": "MPreis", "m-preis": "MPreis" };
  const cap = s => s.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  /* ---- Bild verkleinern (+ für OCR: Graustufen & Kontrast) ---- */
  async function prepare(file, max, forOcr) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d", { willReadFrequently: forOcr });
      g.drawImage(img, 0, 0, c.width, c.height);
      if (forOcr) {
        const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
        let lo = 255, hi = 0;
        const gray = new Uint8ClampedArray(p.length / 4);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = p[i] * .299 + p[i + 1] * .587 + p[i + 2] * .114; gray[j] = v; }
        const hist = new Uint32Array(256); for (const v of gray) hist[v]++;
        let acc = 0, n = gray.length;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * .02) { lo = v; break; } }
        acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * .02) { hi = v; break; } }
        const span = Math.max(hi - lo, 1);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) { const v = (gray[j] - lo) * 255 / span; p[i] = p[i + 1] = p[i + 2] = v; }
        g.putImageData(d, 0, 0);
      }
      const q = forOcr ? .92 : .6;
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
      return { blob, dataUrl: forOcr ? null : c.toDataURL("image/jpeg", q) };
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---- Texterkennung ---- */
  let workerP = null, progressCb = null;
  function loadScript(src) {
    return new Promise((res, rej) => { if (root.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function getWorker() {
    if (!workerP) {
      workerP = (async () => {
        await loadScript(TESS_URL);
        return root.Tesseract.createWorker("deu", 1, {
          logger: m => {
            if (!progressCb) return;
            const label = m.status === "recognizing text" ? "Text wird erkannt …" : /load|init/i.test(m.status) ? "Texterkennung wird geladen (nur beim ersten Mal) …" : "Bitte warten …";
            progressCb(label, m.progress || 0);
          }
        });
      })();
      workerP.catch(() => { workerP = null; });
    }
    return workerP;
  }
  async function ocr(blob, onProgress) {
    progressCb = onProgress;
    onProgress && onProgress("Texterkennung wird geladen …", 0);
    const w = await getWorker();
    const { data } = await w.recognize(blob);
    progressCb = null;
    return data.text || "";
  }

  /* ---- Bon auswerten ---- */
  const AMT = /(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})+|\d{1,5})\s?[,.]\s?(\d{2})(?![\d%])/g;
  const toCents = (a, b) => parseInt(a.replace(/[.\s]/g, ""), 10) * 100 + parseInt(b, 10);
  function amounts(line) { const out = []; let m; AMT.lastIndex = 0; while ((m = AMT.exec(line))) out.push(toCents(m[1], m[2])); return out; }

  const TOTAL_KEYS = [
    /zu\s*zahlen|zahlbetrag|endbetrag|rechnungsbetrag|gesamtbetrag/i,
    /\bsumme\b|\bsumne\b|\bsunme\b|\bsum\b|gesamtsumme/i,
    /\bgesamt\b|\btotal\b|\bbetrag\b/i,
    /\beur\b|€/i
  ];
  const NOT_TOTAL = /zwischen|z-?summe|mwst|ust\b|netto|steuer|rückgeld|ruckgeld|ruckgabe|rückgabe|gegeben|wechselgeld|\d\s?%|rabatt|ersparnis|gespart|pfand|trinkgeld|tip\b|punkte/i;

  function parse(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const low = text.toLowerCase();
    const r = { cents: 0, date: null, pay: null, merchant: "", cat: null };

    /* Gesamtbetrag */
    let best = null;
    lines.forEach((l, i) => {
      if (NOT_TOTAL.test(l)) return;
      for (let p = 0; p < TOTAL_KEYS.length; p++) {
        if (!TOTAL_KEYS[p].test(l)) continue;
        let a = amounts(l);
        if (!a.length && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) a = amounts(lines[i + 1]);
        if (!a.length) continue;
        const v = a[a.length - 1];
        if (v <= 0 || v > 1000000) continue;
        if (!best || p < best.p || (p === best.p && v > best.v)) best = { p, v };
        break;
      }
    });
    if (best && best.p <= 2) r.cents = best.v;
    else {
      const all = lines.filter(l => !NOT_TOTAL.test(l)).flatMap(amounts).filter(v => v > 0 && v < 500000);
      if (all.length) r.cents = Math.max(...all);
    }

    /* Datum */
    const now = new Date(), minD = new Date(now.getFullYear() - 2, 0, 1), maxD = new Date(now.getTime() + 864e5);
    const pad = n => String(n).padStart(2, "0");
    const DATE = /(\d{1,2})\s?[.\/-]\s?(\d{1,2})\s?[.\/-]\s?(\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})-(\d{2})/g;
    let m;
    while ((m = DATE.exec(text))) {
      let d, mo, y;
      if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
      const dt = new Date(y, mo - 1, d);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && dt.getDate() === d && dt >= minD && dt <= maxD) { r.date = y + "-" + pad(mo) + "-" + pad(d); break; }
    }

    /* Zahlungsmittel */
    if (/paypal/.test(low)) r.pay = "paypal";
    else if (/debit|maestro|v\s?pay|bankomat|girocard|ec[\s-]?karte|bankkarte/.test(low)) r.pay = "bankomat";
    else if (/\bvisa\b|master\s?card|kreditkarte|amex|american express|credit|diners/.test(low)) r.pay = "kredit";
    else if (/\bbar\b|bargeld|r[uü]ckgeld|gegeben|wechselgeld|\bcash\b/.test(low)) r.pay = "bar";
    else if (/karte|kontaktlos|nfc|apple\s?pay|google\s?pay|terminal|beleg-?nr|trace/.test(low)) r.pay = "bankomat";
    else if (/überweisung|ueberweisung|iban|zahlungsziel|rechnung\s?nr/.test(low)) r.pay = "ueberweisung";

    /* Händler + Kategorie */
    const head = lines.slice(0, 10).join("\n").toLowerCase() + "\n";
    outer:
    for (const where of [head, low + "\n"]) {
      for (const [cat, names] of BRANDS) {
        for (const n of names) {
          const re = new RegExp("(^|[^\\p{L}])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[^\\p{L}])", "mu");
          if (re.test(where)) {
            r.cat = cat;
            const generic = /kebap|kebab|döner|doner|tankstelle|diesel|super 95|restaurant|gasthaus|gasthof|pizzeria|pizza|cafe|café|bäckerei|apotheke|kino|parken|eintritt|ticket|fitness|schreibwaren|optik|lounge|bar & /.test(n);
            if (!generic) r.merchant = PRETTY[n] || cap(n.trim());
            break outer;
          }
        }
      }
    }
    if (!r.merchant) {
      const cand = lines.slice(0, 6).find(l => (l.match(/\p{L}/gu) || []).length >= 3 && !/rechnung|beleg|kassa|bon|datum|uid|tel|www|straße|strasse|gasse|platz|\d{4}\s+\p{L}/iu.test(l));
      if (cand) r.merchant = cap(cand.replace(/[^\p{L}\d&'\s.-]/gu, "").replace(/\s+/g, " ").trim().toLowerCase()).slice(0, 40);
    }
    if (!r.cat) r.cat = null;
    return r;
  }

  root.Receipt = { prepare, ocr, parse };
})(typeof window !== "undefined" ? window : globalThis);
