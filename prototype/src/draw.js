/* =====================================================================
   Tegninger (simulerede stillframes)
   ===================================================================== */
const PAL = {
  sander: { skin: '#e2b08f', top: '#23324f', bottom: '#1c1c1f', hair: '#8c8883', cap: '#40444b', beard: '#a19b93' },
  holm: { skin: '#efc6a8', top: '#9d86bd', bottom: '#565266', hair: '#d9d4cd', glasses: '#b8923a' },
  per: { skin: '#e6b995', top: '#4d7a52', bottom: '#384658', hair: '#6d4e33' },
};
function figure(who, cx, foot, h, opt = {}) {
  const c = PAL[who]; if (!c) return '';
  const hr = h * 0.09, headY = foot - h + hr;
  const shoulderW = h * (who === 'holm' ? 0.24 : 0.28), torsoTop = headY + hr * 1.05, torsoH = h * 0.36, legTop = torsoTop + torsoH;
  let g = '';
  g += `<rect x="${cx - shoulderW * 0.36}" y="${legTop}" width="${shoulderW * 0.3}" height="${foot - legTop}" rx="${h * 0.02}" fill="${c.bottom}"/>`;
  g += `<rect x="${cx + shoulderW * 0.06}" y="${legTop}" width="${shoulderW * 0.3}" height="${foot - legTop}" rx="${h * 0.02}" fill="${c.bottom}"/>`;
  g += `<rect x="${cx - shoulderW / 2}" y="${torsoTop}" width="${shoulderW}" height="${torsoH + h * 0.03}" rx="${h * 0.05}" fill="${c.top}"/>`;
  const armY = torsoTop + h * 0.02;
  g += `<rect x="${cx - shoulderW / 2 - h * 0.06}" y="${armY}" width="${h * 0.075}" height="${torsoH * 0.95}" rx="${h * 0.035}" fill="${c.top}"/>`;
  g += `<rect x="${cx + shoulderW / 2 - h * 0.015}" y="${armY}" width="${h * 0.075}" height="${torsoH * 0.95}" rx="${h * 0.035}" fill="${c.top}"/>`;
  if (who === 'sander') g += `<rect x="${cx - h * 0.012}" y="${torsoTop + h * 0.02}" width="${h * 0.024}" height="${torsoH * 0.9}" fill="#16213a"/>`;
  g += `<rect x="${cx - hr * 0.45}" y="${headY + hr * 0.7}" width="${hr * 0.9}" height="${hr * 0.6}" fill="${c.skin}"/>`;
  g += `<circle cx="${cx}" cy="${headY}" r="${hr}" fill="${c.skin}"/>`;
  if (who === 'sander') {
    g += `<path d="M ${cx - hr * 0.95} ${headY + hr * 0.05} Q ${cx} ${headY + hr * 1.55} ${cx + hr * 0.95} ${headY + hr * 0.05} L ${cx + hr * 0.7} ${headY + hr * 0.35} Q ${cx} ${headY + hr * 0.75} ${cx - hr * 0.7} ${headY + hr * 0.35} Z" fill="${c.beard}"/>`;
    const capCol = opt.capOverride || c.cap;
    g += `<path d="M ${cx - hr * 1.02} ${headY - hr * 0.2} Q ${cx - hr * 0.9} ${headY - hr * 1.15} ${cx + hr * 0.2} ${headY - hr * 1.02} Q ${cx + hr * 1.1} ${headY - hr * 0.9} ${cx + hr * 1.35} ${headY - hr * 0.25} Z" fill="${capCol}"/>`;
    g += `<rect x="${cx + hr * 0.62}" y="${headY - hr * 0.1}" width="${hr * 0.12}" height="${hr * 0.55}" transform="rotate(-25 ${cx + hr * 0.68} ${headY})" fill="#d9a441"/>`;
  } else if (who === 'holm') {
    g += `<path d="M ${cx - hr * 1.02} ${headY} Q ${cx - hr} ${headY - hr * 1.1} ${cx} ${headY - hr * 1.05} Q ${cx + hr} ${headY - hr * 1.1} ${cx + hr * 1.02} ${headY} Q ${cx + hr * 0.6} ${headY - hr * 0.55} ${cx} ${headY - hr * 0.6} Q ${cx - hr * 0.6} ${headY - hr * 0.55} ${cx - hr * 1.02} ${headY} Z" fill="${c.hair}"/>`;
    g += `<circle cx="${cx}" cy="${headY - hr * 1.15}" r="${hr * 0.42}" fill="${c.hair}"/>`;
    g += `<g fill="none" stroke="${c.glasses}" stroke-width="${Math.max(0.6, hr * 0.07)}"><circle cx="${cx - hr * 0.38}" cy="${headY + hr * 0.02}" r="${hr * 0.26}"/><circle cx="${cx + hr * 0.38}" cy="${headY + hr * 0.02}" r="${hr * 0.26}"/></g>`;
  } else {
    g += `<path d="M ${cx - hr} ${headY - hr * 0.1} Q ${cx} ${headY - hr * 1.3} ${cx + hr} ${headY - hr * 0.1} Q ${cx} ${headY - hr * 0.65} ${cx - hr} ${headY - hr * 0.1} Z" fill="${c.hair}"/>`;
  }
  const eyeR = Math.max(0.5, hr * 0.08);
  g += `<circle cx="${cx - hr * 0.36}" cy="${headY + hr * 0.02}" r="${eyeR}" fill="#23201e"/><circle cx="${cx + hr * 0.36}" cy="${headY + hr * 0.02}" r="${eyeR}" fill="#23201e"/>`;
  if (opt.wave) g += `<rect x="${cx + shoulderW / 2}" y="${armY - h * 0.28}" width="${h * 0.07}" height="${h * 0.3}" rx="${h * 0.035}" fill="${c.top}"/>`;
  return g;
}
function van(x, y, w, v2, label = '') {
  const h = w * 0.5;
  let g = `<rect x="${x}" y="${y}" width="${w * 0.72}" height="${h}" rx="${w * 0.03}" fill="#f1f1ee" stroke="#c9c9c3"/>`;
  g += `<path d="M ${x + w * 0.72} ${y + h * 0.18} L ${x + w * 0.9} ${y + h * 0.3} Q ${x + w} ${y + h * 0.45} ${x + w} ${y + h * 0.7} L ${x + w} ${y + h} L ${x + w * 0.72} ${y + h} Z" fill="#ecece8" stroke="#c9c9c3"/>`;
  g += `<path d="M ${x + w * 0.74} ${y + h * 0.26} L ${x + w * 0.88} ${y + h * 0.34} Q ${x + w * 0.95} ${y + h * 0.44} ${x + w * 0.96} ${y + h * 0.52} L ${x + w * 0.74} ${y + h * 0.52} Z" fill="#97aac0"/>`;
  if (v2) g += `<rect x="${x}" y="${y + h * 0.62}" width="${w * 0.72}" height="${h * 0.1}" fill="#e8742c"/>`;
  g += `<text x="${x + w * 0.36}" y="${y + h * 0.42}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${w * 0.055}" fill="${v2 ? '#b8541a' : '#1f4e8c'}">${esc(label)}</text>`;
  for (const wx of [x + w * 0.17, x + w * 0.82]) g += `<circle cx="${wx}" cy="${y + h}" r="${w * 0.08}" fill="#222"/><circle cx="${wx}" cy="${y + h}" r="${w * 0.035}" fill="#8a8a8a"/>`;
  return g;
}
function bg(look, seed = 0, tone = 0) {
  const j = (seed % 5) * 3;
  if (look === 'villavej') {
    let g = `<defs><linearGradient id="sky${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3ccd7"/><stop offset="1" stop-color="#e9ecef"/></linearGradient></defs>`;
    g += `<rect width="320" height="180" fill="url(#sky${seed})"/>`;
    for (let i = 0; i < 5; i++) {
      const x = -20 + i * 72 + j;
      g += `<rect x="${x}" y="58" width="66" height="72" fill="${i % 2 ? '#d7b36a' : '#cfa95e'}"/><path d="M ${x - 4} 60 L ${x + 33} 34 L ${x + 70} 60 Z" fill="#5a4944"/>`;
      g += `<rect x="${x + 8}" y="74" width="16" height="16" fill="#eef1f3"/><rect x="${x + 40}" y="74" width="16" height="16" fill="#eef1f3"/><rect x="${x + 26}" y="100" width="14" height="30" fill="#6b5143"/>`;
    }
    g += `<rect x="0" y="118" width="320" height="16" fill="#355e3b"/><rect x="0" y="134" width="320" height="12" fill="#b9bbbd"/><rect x="0" y="146" width="320" height="34" fill="#6d7177"/>`;
    g += `<rect x="236" y="112" width="10" height="22" fill="#f4f4f4"/>`;
    if (tone) g += `<rect width="320" height="180" fill="#1b2340" opacity="0.18"/>`;
    return g;
  }
  if (look === 'koekken') {
    let g = `<rect width="320" height="180" fill="#e8dfcb"/>`;
    g += `<rect x="30" y="22" width="84" height="64" fill="#fff4cf"/><rect x="30" y="22" width="84" height="64" fill="none" stroke="#8a6a4a" stroke-width="4"/><line x1="72" y1="22" x2="72" y2="86" stroke="#8a6a4a" stroke-width="3"/>`;
    for (let x = 0; x < 320; x += 12) for (let y = 92; y < 118; y += 12) g += `<rect x="${x + 1}" y="${y + 1}" width="10" height="10" fill="#bfe0d2"/>`;
    g += `<rect x="0" y="118" width="250" height="8" fill="#efe9dd"/><rect x="0" y="126" width="250" height="54" fill="#8b6848"/>`;
    for (let x = 10; x < 250; x += 60) g += `<rect x="${x}" y="134" width="50" height="40" fill="none" stroke="#6e5037" stroke-width="2"/>`;
    g += `<rect x="256" y="30" width="58" height="150" rx="4" fill="#f6f6f2" stroke="#d6d6cf"/><rect x="262" y="80" width="46" height="2" fill="#d6d6cf"/>`;
    g += `<rect x="272" y="46" width="22" height="26" fill="#f6dd62" transform="rotate(4 283 59)"/>`;
    g += `<polygon points="0,0 140,0 60,180 0,180" fill="#fff6d0" opacity="0.18"/>`;
    return g;
  }
  if (look === 'varevogn') {
    let g = `<rect width="320" height="180" fill="#23262d"/>`;
    g += `<path d="M 30 20 L 290 20 L 270 100 L 50 100 Z" fill="#2f3a52"/>`;
    for (let i = 0; i < 4; i++) g += `<rect x="${70 + i * 50}" y="${56 - (i % 2) * 6}" width="34" height="${44 + (i % 2) * 6}" fill="#3b3f4a"/><rect x="${78 + i * 50}" y="64" width="8" height="8" fill="#f2c96b"/>`;
    g += `<circle cx="250" cy="34" r="6" fill="#f7d58a" opacity="0.9"/>`;
    g += `<rect x="0" y="100" width="320" height="80" fill="#17191d"/><rect x="0" y="100" width="320" height="6" fill="#2b2e35"/>`;
    g += `<circle cx="96" cy="150" r="34" fill="none" stroke="#0e0f12" stroke-width="9"/>`;
    g += `<rect width="320" height="180" fill="#f2b84b" opacity="0.06"/>`;
    return g;
  }
  return `<rect width="320" height="180" fill="#e9ebef"/>`;
}
function propArt(look) {
  if (look === 'phone') return `<rect x="104" y="18" width="112" height="170" rx="16" fill="#18191c"/><rect x="112" y="30" width="96" height="150" rx="8" fill="#2c6bd8"/><path d="M 180 30 L 208 60 L 204 30 Z" fill="#dfe8f7" opacity=".7"/><path d="M 186 36 L 200 52" stroke="#fff" stroke-width="1.2"/><text x="160" y="92" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#fff">Fru Holm</text><text x="160" y="110" text-anchor="middle" font-family="Arial" font-size="10" fill="#dbe6fb">ringer …</text><circle cx="138" cy="150" r="11" fill="#e0443e"/><circle cx="182" cy="150" r="11" fill="#39b25d"/>`;
  if (look === 'note') return `<rect x="84" y="16" width="152" height="156" fill="#f6dd62" transform="rotate(3 160 94)"/><g transform="rotate(3 160 94)" font-family="'Segoe Print','Bradley Hand',cursive" font-size="17" fill="#26304a"><text x="104" y="54">hængsel</text><text x="104" y="84">lampe</text><text x="104" y="114">vandhane</text><text x="104" y="144">maling!</text></g>`;
  return '';
}

const FRAMING = { extreme_wide: { h: 40, head: null }, wide: { h: 64, head: null }, medium: { h: 190, head: 55 }, medium_closeup: { h: 280, head: 60 }, closeup: { h: 430, head: 82 } };
const logoOf = (a, v) => (((a.versions.find((x) => x.v === v) || a.versions[0]).attrs['Logo'] || '').split(',')[0]).trim();
function sceneSVG(p, s, seed = 1, opt = {}) {
  const refs = s.assets.map((r) => ({ ...r, a: p.assets[r.id] })).filter((r) => r.a);
  const loc = refs.find((r) => r.a.kind === 'location');
  const chars = refs.filter((r) => r.a.kind === 'character');
  const veh = refs.find((r) => r.a.kind === 'vehicle');
  const prop = refs.find((r) => r.a.kind === 'prop');
  let g = bg(loc ? loc.a.look : '', seed, s.lighting.includes('eftermiddag') && loc && loc.a.look === 'villavej' ? 1 : 0);
  if (s.camera.type === 'insert' && prop) {
    g += `<rect width="320" height="180" fill="#000" opacity="0.25"/>` + propArt(prop.a.look);
  } else {
    const fr = FRAMING[s.camera.type] || FRAMING.medium;
    if (veh && (s.camera.type === 'wide' || s.camera.type === 'extreme_wide')) g += van(150 + (seed % 3) * 6, 92, 150, veh.v >= 2, logoOf(veh.a, veh.v));
    else if (veh && s.camera.type === 'medium') g += van(170, 40, 260, veh.v >= 2, logoOf(veh.a, veh.v));
    else if (veh && s.camera.type === 'medium_closeup') g += `<rect x="236" y="30" width="120" height="150" fill="#f1f1ee"/>${veh.v >= 2 ? '<rect x="236" y="120" width="120" height="16" fill="#e8742c"/>' : ''}`;
    const capOverride = opt.capOverride;
    const n = chars.length;
    chars.forEach((c, i) => {
      const cx = n === 1 ? (s.camera.type === 'wide' ? 110 + (seed % 3) * 8 : 150 + (seed % 3) * 5) : 90 + i * (140 / Math.max(1, n - 1)) + (seed % 3) * 4;
      const h = fr.h;
      const foot = fr.head == null ? 150 : fr.head + h - h * 0.09;
      g += figure(c.a.look, cx, foot, h, { capOverride: c.a.look === 'sander' ? capOverride : null, wave: c.a.look === 'per' });
    });
    if (s.lighting.includes('eftermiddag') && loc && loc.a.look === 'koekken') g += `<rect width="320" height="180" fill="#ffcc66" opacity="0.07"/>`;
  }
  return `<svg class="scene" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(s.code)}">${g}</svg>`;
}
function assetSVG(a, role, seed = 1, v = 1) {
  const look = a.look;
  if (a.kind === 'character') {
    const ratio = '0 0 200 250';
    const bgc = role === 'clothing' ? '#e6e8ec' : '#eceef1';
    let g = `<rect width="200" height="250" fill="${bgc}"/>`;
    if (role === 'full_body') g += figure(look, 100, 236, 210);
    else if (role === 'clothing') g += figure(look, 100, 330, 330);
    else if (role === 'profile') g += `<g transform="translate(200 0) scale(-1 1)">${figure(look, 112, 470, 470)}</g>`;
    else g += figure(look, 100, 470, 470);
    return `<svg viewBox="${ratio}" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
  }
  if (a.kind === 'vehicle') {
    let g = `<rect width="320" height="180" fill="#e3e6ea"/><rect y="140" width="320" height="40" fill="#b9bcc1"/>`;
    g += role === 'logo' ? van(-60, 20, 380, v >= 2, logoOf(a, v)) : van(40 + (seed % 3) * 4, 60, 240, v >= 2, logoOf(a, v));
    return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
  }
  if (a.kind === 'prop') return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><rect width="320" height="180" fill="#dfe2e7"/><g transform="${role === 'detail' ? 'translate(-160 -60) scale(2)' : ''}">${propArt(look)}</g></svg>`;
  return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">${bg(look, seed + (role === 'detail' ? 2 : 0), role === 'light' ? 1 : 0)}</svg>`;
}

