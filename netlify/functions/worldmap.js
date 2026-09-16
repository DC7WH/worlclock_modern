// ============================================================================
// Weltzeitkarte / Grayline – Server-Side-Rendering (Netlify Function)
// ----------------------------------------------------------------------------
// Warum SSR? qrz.com rendert Bios in einem sandboxed iframe OHNE allow-scripts.
// Sandboxing vererbt sich auf verschachtelte iframes -> kein JavaScript
// moeglich. Deshalb (Prinzip wie die DO1KRT-LED-Uhr):
//   * Uhrzeiten = reine CSS-"Ziffernrollen" (animation-delay = lokale Sekunde
//     des Tages, negativ) -> ticken ganz ohne JavaScript
//   * Grayline  = serverseitig berechnetes SVG (4 gestaffelte Daemmerungs-
//     schichten), wird beim Rendern mit ausgeliefert
//   * <meta refresh="300"> synct alle 5 Minuten neu gegen die Serverzeit
// ============================================================================

const CITIES = [
  // Europa
  { key: 'reykjavik', name: 'Reykjavík',     zone: 'Atlantic/Reykjavik',       cls: 'eu',      x: 43.2, y: 22.8 },
  { key: 'london',    name: 'London',        zone: 'Europe/London',            cls: 'eu',      x: 48.2, y: 29.6 },
  { key: 'koeln',     name: 'Köln ★',       zone: 'Europe/Berlin',            cls: 'home',    x: 49.9, y: 31.4 },
  { key: 'paris',     name: 'Paris',         zone: 'Europe/Paris',             cls: 'eu',      x: 49.6, y: 35.0 },
  { key: 'utc',       name: 'UTC',           zone: 'Etc/UTC',                  cls: 'utc',     x: 47.0, y: 34.4 },
  { key: 'istanbul',  name: 'Istanbul',      zone: 'Europe/Istanbul',          cls: 'eu',      x: 54.4, y: 36.0 },
  { key: 'moskau',    name: 'Moskau',        zone: 'Europe/Moscow',            cls: 'eu',      x: 58.6, y: 28.8 },
  // Afrika
  { key: 'kairo',     name: 'Kairo',         zone: 'Africa/Cairo',             cls: 'africa',  x: 55.0, y: 39.4 },
  { key: 'nairobi',   name: 'Nairobi',       zone: 'Africa/Nairobi',           cls: 'africa',  x: 58.2, y: 55.4 },
  { key: 'kapstadt',  name: 'Kapstadt',      zone: 'Africa/Johannesburg',      cls: 'africa',  x: 53.8, y: 73.6 },
  // Asien
  { key: 'dubai',     name: 'Dubai',         zone: 'Asia/Dubai',               cls: 'asia',    x: 60.8, y: 42.2 },
  { key: 'mumbai',    name: 'Mumbai',        zone: 'Asia/Kolkata',             cls: 'asia',    x: 66.4, y: 44.0 },
  { key: 'bangkok',   name: 'Bangkok',       zone: 'Asia/Bangkok',             cls: 'asia',    x: 68.7, y: 48.6 },
  { key: 'singapur',  name: 'Singapur',      zone: 'Asia/Singapore',           cls: 'asia',    x: 72.6, y: 57.2 },
  { key: 'shanghai',  name: 'Shanghai',      zone: 'Asia/Shanghai',            cls: 'asia',    x: 79.0, y: 37.6 },
  { key: 'tokyo',     name: 'Tokio',         zone: 'Asia/Tokyo',               cls: 'asia',    x: 84.6, y: 35.6 },
  // Ozeanien
  { key: 'sydney',    name: 'Sydney',        zone: 'Australia/Sydney',         cls: 'oceania', x: 84.8, y: 77.8 },
  { key: 'auckland',  name: 'Auckland',      zone: 'Pacific/Auckland',         cls: 'oceania', x: 93.0, y: 85.6 },
  // Nordamerika
  { key: 'honolulu',  name: 'Honolulu',      zone: 'Pacific/Honolulu',         cls: 'na',      x: 6.2,  y: 44.8 },
  { key: 'la',        name: 'Los Angeles',   zone: 'America/Los_Angeles',      cls: 'na',      x: 11.0, y: 38.8 },
  { key: 'chicago',   name: 'Chicago',       zone: 'America/Chicago',          cls: 'na',      x: 18.0, y: 33.6 },
  { key: 'ny',        name: 'New York',      zone: 'America/New_York',         cls: 'na',      x: 24.8, y: 36.0 },
  { key: 'mexiko',    name: 'Mexiko-Stadt',  zone: 'America/Mexico_City',      cls: 'na',      x: 16.2, y: 46.8 },
  // Suedamerika
  { key: 'bogota',    name: 'Bogotá',       zone: 'America/Bogota',           cls: 'sa',      x: 25.2, y: 52.2 },
  { key: 'rio',       name: 'Rio',           zone: 'America/Sao_Paulo',        cls: 'sa',      x: 32.2, y: 65.6 },
  { key: 'buenos',    name: 'Buenos Aires',  zone: 'America/Argentina/Buenos_Aires', cls: 'sa', x: 30.0, y: 74.4 }
];

function pad2(n) { return String(n).padStart(2, '0'); }

// Lokale Zeit oderDatum einer Stadt (Server-seitig, IANA-Zonen via Intl)
function cityNow(now, zone) {
  const t = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone, hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(now);
  const g = (k) => Number(t.find(p => p.type === k).value);
  const h = g('hour') % 24, m = g('minute'), s = g('second');
  const date = new Intl.DateTimeFormat('de-DE', {
    timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(now);
  return { sod: h * 3600 + m * 60 + s, date };
}

// CSS-Ziffernrolle: n Stellen, Periode in s, Startoffset (neg. animation-delay)
function roller(n, period, delay) {
  let lis = '';
  for (let i = 0; i <= n; i++) lis += `<li>${pad2(i % n)}</li>`; // letztes = erstes (Wrap)
  return `<span class="wm-rl" style="--n:${n};--p:${period}s;--d:-${delay}s"><ul>${lis}</ul></span>`;
}

function timeRollers(sod) {
  return roller(24, 86400, sod) + '<span class="wm-c">:</span>'
       + roller(60, 3600, sod % 3600) + '<span class="wm-c">:</span>'
       + roller(60, 60, sod % 60);
}

// --- Grayline: Nachtbereich als SVG-Pfad (Mercator), numerisch robust -------
function nightSvg(now) {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 +
               now.getUTCSeconds() / 3600 + now.getUTCMilliseconds() / 3.6e6;
  const subLon = (12 - utcH) * 15; // Laenge des Subsolar-Punkts
  const dayOfYear = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
                    - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5);
  const decl = 23.44 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  const sinD = Math.sin(decl * Math.PI / 180), cosD = Math.cos(decl * Math.PI / 180);

  const yOf = (lat) => {
    const c = Math.max(-85.5, Math.min(85.5, lat));
    return +(((1 - Math.asinh(Math.tan(c * Math.PI / 180)) / Math.PI) / 2) * 800).toFixed(1);
  };

  // 4 Daemmerungs-Schichten (Sonnenhoehe -> Deckkraft)
  const layers = [
    { k: Math.sin(0 * Math.PI / 180),    a: 0.10 },
    { k: Math.sin(-1.5 * Math.PI / 180), a: 0.06 },
    { k: Math.sin(-3 * Math.PI / 180),   a: 0.10 },
    { k: Math.sin(-6 * Math.PI / 180),   a: 0.16 }
  ];

  const fold = (lat) => { // auf [-90,90] spiegeln (Breitengrad-Raum)
    while (lat > 90) lat = 180 - lat;
    while (lat < -90) lat = -180 - lat;
    return lat;
  };

  let paths = '';
  for (const { k, a } of layers) {
    const upper = [], lower = [];
    for (let x = 0; x <= 1200; x += 3) {
      const lon = (x / 1200) * 360 - 180;
      let H = ((lon - subLon + 180) % 360 + 360) % 360 - 180;
      const cosH = Math.cos(H * Math.PI / 180);
      const f = (latDeg) => {
        const l = latDeg * Math.PI / 180;
        return sinD * Math.sin(l) + cosD * Math.cos(l) * cosH; // = sin(Elevation)
      };
      // Nachtzone in einer Spalte ist EIN Intervall (f hat nur eine Senke).
      const m0 = fold(Math.atan2(-sinD, -(cosD * cosH)) * 180 / Math.PI); // Breite des Minimums
      if (f(m0) >= k) { upper.push([x, m0]); lower.push([x, m0]); continue; } // kein Nachtanteil -> auf 0 Breite
      let up = 90;
      for (let L = m0; L <= 90; L += 0.25) { if (f(L) >= k) { up = L; break; } }
      let lo = -90;
      for (let L = m0; L >= -90; L -= 0.25) { if (f(L) >= k) { lo = L; break; } }
      upper.push([x, up]); lower.push([x, lo]);
    }
    // Polygon: obere Grenze L->R, untere Grenze R->L
    const d = 'M' + upper.map(([x, b]) => `${x} ${yOf(b)}`).join('L')
            + 'L' + lower.slice().reverse().map(([x, b]) => `${x} ${yOf(b)}`).join('L') + 'Z';
    paths += `<path d="${d}" fill="rgba(6,10,24,${a})"/>`;
  }
  return `<svg class="wm-night" viewBox="0 0 1200 800" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
}

function pinHtml(c, now) {
  const { sod, date } = cityNow(now, c.zone);
  return `      <div class="hl-wm-pin" data-city="${c.key}" style="left:${c.x}%; top:${c.y}%;">
        <div class="hl-wm-pin-dot hl-wm-dot-${c.cls}"></div>
        <div class="hl-wm-pin-label"><span class="hl-wm-pin-city">${c.name}</span><span class="hl-wm-pin-time wm-roll">${timeRollers(sod)}</span><span class="hl-wm-pin-date">${date}</span></div>
      </div>`;
}

function render(now) {
  const pins = CITIES.map(c => pinHtml(c, now)).join('\n');
  const night = nightSvg(now);

  const css = `
/* EINE Box: Rahmen/Border/Schatten kommt vom Bio-Wrapper (dc7wh_bio_V3).
   Die Seite selbst ist rahmenlos; Hintergrund = gleiche Farbe wie die
   iFrame-Flaeche in der Bio (#05070d) -> wirkt wie eine einzige Box. */
html,body{margin:0;padding:0;background:#05070d}
body{height:100%}
.hl-wm-page, .hl-wm-page *{box-sizing:border-box}
.hl-wm-page{width:100%;max-width:100%;margin:0 auto;background:transparent;border:none;border-radius:0;box-shadow:none;padding:22px 22px 12px;color:#e0e8f0;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;text-align:left;line-height:1.4}
.hl-wm-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.hl-wm-head h2{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.2;font-family:'Open Sans','Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#00ff88,#0099ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#00ff88}
.hl-wm-head .hl-wm-sub{margin:3px 0 0;font-size:12.5px;color:#8fa1b8;line-height:1.3}
.hl-wm-live{margin-left:auto;display:inline-flex;align-items:center;gap:7px;color:#00ff88;border:1px solid rgba(0,255,136,.45);background:rgba(0,255,136,.07);border-radius:50px;padding:4px 12px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:.12em;white-space:nowrap;font-weight:700;text-shadow:0 0 10px rgba(0,255,136,.5)}
.hl-wm-live i{width:7px;height:7px;border-radius:50%;background:#00ff88;box-shadow:0 0 8px rgba(0,255,136,.9);animation:hlwm-pulse 1.6s ease-in-out infinite;display:inline-block}
@keyframes hlwm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.hl-wm-map-wrap{position:relative;background:#05070d;border:none;border-radius:14px;overflow:hidden;isolation:isolate;box-shadow:inset 0 0 40px rgba(0,0,0,.4)}
.hl-wm-map-bg{position:relative;display:block;width:100%;line-height:0;background:#05070d}
.hl-wm-map-bg img{width:100%;height:auto;display:block}
.wm-night{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;mix-blend-mode:multiply}
.hl-wm-pins{position:absolute;inset:0;width:100%;height:100%;z-index:2}
.hl-wm-pin{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:4px;user-select:none;z-index:2;transition:z-index .15s}
.hl-wm-pin:hover{z-index:30}
.hl-wm-pin-dot{width:11px;height:11px;border-radius:50%;background:#0f172a;border:2px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.28),0 0 0 3px rgba(15,23,42,.07);position:relative;flex-shrink:0}
.hl-wm-pin-dot::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:1.5px solid currentColor;opacity:.16;animation:hlwm-ping 2.4s ease-out infinite}
@keyframes hlwm-ping{0%{transform:scale(.6);opacity:.3}100%{transform:scale(1.9);opacity:0}}
.hl-wm-pin-dot.hl-wm-dot-utc{background:#2563eb;color:#2563eb}
.hl-wm-pin-dot.hl-wm-dot-home{background:#0d9488;color:#0d9488;box-shadow:0 2px 10px rgba(13,148,136,.35),0 0 0 4px rgba(13,148,136,.14)}
.hl-wm-pin-dot.hl-wm-dot-africa{background:#d97706;color:#d97706}
.hl-wm-pin-dot.hl-wm-dot-asia{background:#7c3aed;color:#7c3aed}
.hl-wm-pin-dot.hl-wm-dot-oceania{background:#ea580c;color:#ea580c}
.hl-wm-pin-dot.hl-wm-dot-na{background:#334155;color:#334155}
.hl-wm-pin-dot.hl-wm-dot-sa{background:#db2777;color:#db2777}
.hl-wm-pin-label{position:relative;background:linear-gradient(180deg,rgba(15,23,42,.90),rgba(8,13,26,.94));border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:6px 9px 5px;min-width:92px;box-shadow:0 8px 22px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.08);text-align:center;line-height:1.2;pointer-events:none;transition:transform .18s ease,border-color .18s,box-shadow .18s}
.hl-wm-pin-label::before{content:"";position:absolute;left:10px;right:10px;top:0;height:2px;border-radius:2px 2px 0 0;background:var(--hlwm-accent,#94a3b8);opacity:.9}
.hl-wm-pin:hover .hl-wm-pin-label{transform:translateY(-2px) scale(1.04);border-color:rgba(255,255,255,.28);box-shadow:0 12px 28px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.1)}
.hl-wm-pin-city{display:block;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(226,232,240,.72);font-family:Consolas,'Courier New',monospace;white-space:nowrap}
.hl-wm-pin-time{display:block;font-size:13.5px;font-weight:800;color:#fff;font-family:Consolas,'Courier New',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:3px;letter-spacing:-.02em;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.hl-wm-pin-date{display:block;font-size:9.5px;color:rgba(148,163,184,.85);font-family:Consolas,'Courier New',monospace;white-space:nowrap;margin-top:2px}
/* Farbakzente je Kontinent */
.hl-wm-dot-utc + .hl-wm-pin-label{--hlwm-accent:#3b82f6;border-color:rgba(59,130,246,.35)}
.hl-wm-dot-utc + .hl-wm-pin-label .hl-wm-pin-city{color:#93c5fd}
.hl-wm-dot-home + .hl-wm-pin-label{--hlwm-accent:#2dd4bf;border-color:rgba(45,212,191,.35)}
.hl-wm-dot-home + .hl-wm-pin-label .hl-wm-pin-city{color:#5eead4}
.hl-wm-dot-eu + .hl-wm-pin-label{--hlwm-accent:#cbd5e1}
.hl-wm-dot-eu + .hl-wm-pin-label .hl-wm-pin-city{color:#cbd5e1}
.hl-wm-dot-africa + .hl-wm-pin-label{--hlwm-accent:#f59e0b}
.hl-wm-dot-africa + .hl-wm-pin-label .hl-wm-pin-city{color:#fbbf24}
.hl-wm-dot-asia + .hl-wm-pin-label{--hlwm-accent:#a78bfa}
.hl-wm-dot-asia + .hl-wm-pin-label .hl-wm-pin-city{color:#c4b5fd}
.hl-wm-dot-oceania + .hl-wm-pin-label{--hlwm-accent:#fb923c}
.hl-wm-dot-oceania + .hl-wm-pin-label .hl-wm-pin-city{color:#fdba74}
.hl-wm-dot-na + .hl-wm-pin-label{--hlwm-accent:#94a3b8}
.hl-wm-dot-na + .hl-wm-pin-label .hl-wm-pin-city{color:#cbd5e1}
.hl-wm-dot-sa + .hl-wm-pin-label{--hlwm-accent:#f472b6}
.hl-wm-dot-sa + .hl-wm-pin-label .hl-wm-pin-city{color:#f9a8d4}
/* Versaetze Europa */
.hl-wm-pin[data-city="koeln"] .hl-wm-pin-label{transform:translateX(14px)}
.hl-wm-pin[data-city="koeln"]:hover .hl-wm-pin-label{transform:translateX(14px) translateY(-2px) scale(1.04)}
.hl-wm-pin[data-city="paris"] .hl-wm-pin-label{transform:translateX(-14px)}
.hl-wm-pin[data-city="paris"]:hover .hl-wm-pin-label{transform:translateX(-14px) translateY(-2px) scale(1.04)}
.hl-wm-pin[data-city="utc"] .hl-wm-pin-label{transform:translateX(-12px) translateY(2px)}
.hl-wm-pin[data-city="utc"]:hover .hl-wm-pin-label{transform:translateX(-12px) translateY(0) scale(1.04)}
/* Legende / Fuss */
.hl-wm-legend{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin:10px 0 4px;font-size:10.5px;color:#8fa1b8;font-family:Consolas,'Courier New',monospace}
.hl-wm-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.hl-wm-legend i{width:9px;height:9px;border-radius:50%;display:inline-block;border:1.5px solid rgba(255,255,255,.7);box-shadow:0 0 6px rgba(255,255,255,.12)}
.hl-wm-foot{margin:8px 0 0;text-align:center;font-size:11.5px;color:#5f7288}
.hl-wm-foot b{color:#8fa1b8;font-weight:600}
/* Vollbild-Button: im QRZ-iFrame -> oeffnet die Karte in neuem Tab
   (Sandbox erlaubt Popups). Top-Level -> natives Vollbild (s. Script unten). */
.wm-fs{position:absolute;right:10px;bottom:10px;z-index:6;display:inline-flex;align-items:center;gap:6px;background:rgba(13,18,32,.92);border:1px solid rgba(0,255,136,.45);color:#00ff88;border-radius:8px;padding:5px 10px;font-family:Consolas,'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.5);opacity:.6;transition:opacity .18s,transform .18s}
.wm-fs svg{display:block}
.hl-wm-map-wrap:hover .wm-fs{opacity:1}
.wm-fs:hover{opacity:1;transform:scale(1.05);text-decoration:none;box-shadow:0 0 16px rgba(0,255,136,.35)}
/* CSS-Ziffernrollen – Ticken ganz ohne JavaScript */
.wm-roll{display:inline-flex;align-items:flex-start;justify-content:center}
.wm-c{display:inline-block}
.wm-rl{display:inline-block;height:16px;width:2ch;overflow:hidden;vertical-align:top}
.wm-rl ul{list-style:none;margin:0;padding:0;display:block;animation:wm-roll var(--p) steps(var(--n)) infinite;animation-delay:var(--d);will-change:transform}
.wm-rl li{display:block;height:16px;line-height:16px;text-align:center}
@keyframes wm-roll{to{transform:translateY(calc(-16px*var(--n)))}}
@media(max-width:900px){.hl-wm-pin-label{min-width:80px;padding:5px 6px}.hl-wm-pin-city{font-size:8.2px}.hl-wm-pin-time{font-size:11.5px}.hl-wm-pin-date{font-size:8.8px}.wm-rl{height:14px}.wm-rl li{height:14px;line-height:14px}@keyframes wm-roll{to{transform:translateY(calc(-14px*var(--n)))}}}
@media(max-width:640px){.hl-wm-page{padding:14px 10px 10px}.hl-wm-head h2{font-size:18px}.hl-wm-pin-label{min-width:72px;padding:4px 5px}.hl-wm-pin-time{font-size:10.5px}.wm-rl{height:12.5px}.wm-rl li{height:12.5px;line-height:12.5px}@keyframes wm-roll{to{transform:translateY(calc(-12.5px*var(--n)))}}}
@media(max-width:480px){.hl-wm-pin-date{display:none}.hl-wm-pin-label{min-width:64px}}
`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="300">
<title>Weltzeitkarte · Grayline live · DC7WH</title>
<style>${css}</style>
</head>
<body>
<div class="hl-wm-page">
  <div class="hl-wm-head">
    <div>
      <h2>Weltzeitkarte</h2>
      <p class="hl-wm-sub">24 Metropolen weltweit über alle Kontinente verteilt</p>
    </div>
    <span class="hl-wm-live"><i></i>LIVE</span>
  </div>
  <div class="hl-wm-map-wrap" role="img" aria-label="Weltkarte mit 24 Live-Zeitzonen und Grayline">
    <div class="hl-wm-map-bg">
      <img src="https://www.darc.de/fileadmin/filemounts/distrikte/g/ortsverbaende/24/Dateien/Code/Weltzeitkarte/world-map-option3.webp" alt="" width="1200" height="800" loading="eager" decoding="async">
      ${night}
      <div class="hl-wm-pins">
${pins}
      </div>
    </div>
    <a class="wm-fs" id="wmFsBtn" href="./worldmap" target="_blank" rel="noopener" title="Vollbild in neuem Tab öffnen" aria-label="Vollbild öffnen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span>Vollbild</span></a>
  </div>
  <div class="hl-wm-legend" aria-hidden="true">
    <span><i style="background:#2563eb"></i> UTC</span>
    <span><i style="background:#0d9488"></i> Köln</span>
    <span><i style="background:#0f172a;border-color:rgba(255,255,255,.35)"></i> Europa</span>
    <span><i style="background:#d97706"></i> Afrika</span>
    <span><i style="background:#7c3aed"></i> Asien</span>
    <span><i style="background:#334155"></i> Nordamerika</span>
    <span><i style="background:#db2777"></i> Südamerika</span>
    <span><i style="background:#ea580c"></i> Ozeanien</span>
  </div>
  <div class="hl-wm-foot">Zeiten: <b>CSS-Rollen, server-seitig gerendert</b> · Sync alle 5 min · ohne JavaScript · Button unten rechts: <b>Vollbild</b> (neuer Tab)</div>
</div>
<script>
(function(){
  try{
    /* NUR ausserhalb von iFrames aktiv (im QRZ-iFrame blockiert die Sandbox
       Scripte sowieso – dort bleibt der Button einfach ein Tab-Oeffner). */
    if(window.top!==window.self){return;}
    var btn=document.getElementById('wmFsBtn');
    if(!btn){return;}
    btn.title='Vollbild umschalten (ESC verlässt)';
    btn.addEventListener('click',function(ev){
      ev.preventDefault();
      var el=document.documentElement;
      if(document.fullscreenElement||document.webkitFullscreenElement){
        if(document.exitFullscreen){document.exitFullscreen();}
        else if(document.webkitExitFullscreen){document.webkitExitFullscreen();}
      }else if(el.requestFullscreen){el.requestFullscreen();}
      else if(el.webkitRequestFullscreen){el.webkitRequestFullscreen();}
    });
  }catch(e){}
})();
</script>
</body>
</html>`;
}

exports.handler = async () => {
  const now = new Date();
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=5, must-revalidate',
      'Content-Security-Policy': "frame-ancestors *"
    },
    body: render(now)
  };
};

// Minimaler Selbsttest: node netlify/functions/worldmap.js selftest
if (process.argv[2] === 'selftest') {
  const html = render(new Date());
  const berlin = cityNow(new Date(), 'Europe/Berlin');
  const utc = cityNow(new Date(), 'Etc/UTC');
  const delays = [...html.matchAll(/--d:-(\d+)s/g)].map(m => +m[1]);
  console.log('Berlin sod:', berlin.sod, '| UTC sod:', utc.sod, '| Differenz (Erwartet CEST = 7200):', berlin.sod - utc.sod);
  console.log('HTML:', html.length, 'Bytes | Rollen gesamt (erw. 78):', (html.match(/--p:/g) || []).length,
              '| SVG-Pfade (erw. 4):', (html.match(/<path/g) || []).length,
              '| Scripts (erw. 1 = nur Top-Level-Vollbild):', (html.match(/<script/gi) || []).length,
              '| Vollbild-Button:', html.includes('id="wmFsBtn"'));
  console.log('Delay-Min/Max:', Math.min(...delays), Math.max(...delays), '(muessen 0..86399 liegen)');
  const nan = /NaN|undefined/.test(html);
  console.log('NaN/undefined im HTML:', nan);
}
