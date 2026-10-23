/* =====================================================
   DJK Déménagement – Devis & Factures
   Tout fonctionne dans le navigateur, sans serveur.
   ===================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- Données ---------- */
const DB_KEY = 'djk_gestion_v1';
const DEFAULTS = {
  settings: {
    company: 'DJK DEMENAGEMENT', address1: '55 RUE DES LILAS', address2: '95150 TAVERNY', city: 'TAVERNY',
    siret: '93948728600014', tva: 'FR91939487286', tel: '06 65 61 64 20', email: 'djkdemenagement@gmail.com',
    iban: 'FR29 3000 2006 2600 0000 6923 U32',
    tagline: "NATIONAL & INTERNATIONAL – PARTICULIERS – TRANSFERTS D'ENTREPRISES",
    legal: 'S.A.S.U au capital de 15 000 € - RCS PONTOISE 939 487 286 - APE 4942Z - TVA FR91939487286',
    nextDevis: 1, nextFacture: 68, nextLettre: 466, tvaRate: 20, acompte: 30, acompteEntreprise: true, taux: '0,3',
    garantieText: "GARANTIE DOMMAGE SANS FRANCHISE\nValeur globale entre 30 € et 30 000 €",
    logo: '', signature: '', stamp: ''
  },
  clients: [], devis: [], factures: [], lettres: [], events: []
};
let db = loadDB();
function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d) return migrate({ ...structuredClone(DEFAULTS), ...d, settings: { ...DEFAULTS.settings, ...d.settings } });
  } catch (e) { /* première utilisation */ }
  return structuredClone(DEFAULTS);
}
// Corrige les anciennes données enregistrées dans le navigateur (ex : texte de garantie avec « HELVETIA »)
function migrate(d) {
  if (/helvetia/i.test(d.settings.garantieText || '')) d.settings.garantieText = DEFAULTS.settings.garantieText;
  d.lettres ||= [];
  return d;
}
function saveDB() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch (e) { toast("Enregistrement impossible : le navigateur refuse (mode privé ?)"); }
}

/* ---------- Outils ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const frDate = s => s ? s.split('-').reverse().join('/') : '';
const frDay = s => s ? `${frDate(s)} (${new Date(s + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long' })})` : '';
const money = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
// Paiement sans TVA : taux 0 -> le prix saisi est le prix à payer (TTC = HT)
const rateOf = o => (o && o.sansTva) ? 0 : db.settings.tvaRate;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const logoSrc = () => db.settings.logo || window.LOGO_DATA || 'assets/logo.png';
const cityOf = a => { const m = /\b\d{5}\s+([^,]+)/.exec(a || ''); return m ? m[1].trim() : (a || '').split(',').pop().trim(); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }
const year = d => (d || iso(new Date())).slice(0, 4);
const frNum = v => String(v ?? '').replace('.', ',');
const frLong = s => { if (!s) return ''; const t = new Date(s + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const fmtSiret = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 14 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : (s || ''); };

/* ---------- Recherche d'entreprise par SIRET (API publique de l'État, gratuite, sans clé) ---------- */
// Contrôle de Luhn : détecte une faute de frappe dans les 14 chiffres avant même d'appeler l'API
function luhn(n) {
  let sum = 0;
  [...n].reverse().forEach((c, i) => { let d = +c; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return sum % 10 === 0;
}
async function lookupSiret(siret) {
  const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&per_page=1`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const e = j.results && j.results[0]; if (!e) return null;
  const et = [e.siege, ...(e.matching_etablissements || [])].filter(Boolean).find(x => x.siret === siret);
  if (!et) return null;
  let a = et.adresse || '';
  const tail = `${et.code_postal || ''} ${et.libelle_commune || ''}`.trim();
  if (tail && a.endsWith(tail)) a = a.slice(0, -tail.length).trim().replace(/,$/, '') + ', ' + tail;
  return { name: e.nom_raison_sociale || e.nom_complet || '', address: a, closed: et.etat_administratif === 'F' };
}
// Branche la recherche sur un formulaire : dès que le SIRET fait 14 chiffres (ou clic sur « Rechercher »)
function bindSiret(form, map) {
  const inp = form.elements[map.siret], btn = form.querySelector('[data-siret]'); let last = '';
  async function run(manual) {
    const s = inp.value.replace(/\D/g, '');
    if (s.length !== 14) { if (manual) toast('Le SIRET doit contenir 14 chiffres'); return; }
    if (!manual && s === last) return; last = s;
    if (!luhn(s)) { toast('SIRET invalide : vérifie les chiffres'); return; }
    toast("Recherche de l'entreprise…");
    try {
      const e = await lookupSiret(s);
      if (!e) { toast('Aucune entreprise trouvée pour ce SIRET'); return; }
      const n = form.elements[map.name];
      if (n && (!n.value.trim() || n.dataset.auto === n.value)) { n.value = e.name; n.dataset.auto = e.name; }
      const a = form.elements[map.address]; if (a && e.address) a.value = e.address;
      toast(e.closed ? `Attention : cet établissement est fermé (${e.name})` : `Entreprise trouvée : ${e.name}`);
    } catch (x) { toast('Recherche impossible (pas de connexion ?) : saisis les coordonnées à la main'); }
  }
  inp.addEventListener('input', () => run(false));
  if (btn) btn.onclick = () => run(true);
}

function get(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function set(o, p, v) { const ks = p.split('.'); ks.slice(0, -1).forEach(k => { o = o[k] ??= {}; }); o[ks.at(-1)] = v; }
function fillForm(f, o) {
  [...f.elements].forEach(e => {
    if (!e.name) return;
    const v = get(o, e.name);
    if (e.type === 'checkbox') e.checked = !!v;
    else if (e.type === 'radio') e.checked = (v ?? 'N/C') === e.value;
    else e.value = v ?? '';
  });
}
function readForm(f) {
  const o = {};
  [...f.elements].forEach(e => {
    if (!e.name) return;
    if (e.type === 'radio') { if (e.checked) set(o, e.name, e.value); }
    else if (e.type === 'checkbox') set(o, e.name, e.checked);
    else set(o, e.name, e.value);
  });
  return o;
}

/* ---------- Navigation ---------- */
function show(v) {
  $$('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'view-' + v));
  const parent = v.replace('Edit', '');
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === parent));
  ({ devis: renderDevis, factures: renderFactures, clients: renderClients, agenda: renderAgenda, settings: renderSettings, lettres: renderLettres }[parent] || (() => { }))();
  window.scrollTo(0, 0);
}
$$('nav button').forEach(b => b.onclick = () => show(b.dataset.view));
$$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));

/* ---------- Clients ---------- */
function upsertClient(c) {
  if (!c.name) return;
  const k = c.name.trim().toLowerCase();
  let ex = db.clients.find(x => x.name.trim().toLowerCase() === k);
  if (!ex) { ex = { id: uid(), name: c.name.trim() }; db.clients.push(ex); }
  ['civ', 'tel', 'email', 'address', 'siret', 'type'].forEach(f => { if (c[f]) ex[f] = c[f]; });
}
const findClient = n => db.clients.find(x => x.name.trim().toLowerCase() === (n || '').trim().toLowerCase());
function refreshClientList() {
  $('#clientList').innerHTML = db.clients.map(c => `<option value="${esc(c.name)}">`).join('');
}
// Quand on tape un nom connu, le reste se remplit tout seul
function autoFillClient(form, map) {
  const nameEl = form.elements[map.name];
  nameEl.addEventListener('change', () => {
    const c = findClient(nameEl.value); if (!c) return;
    Object.entries(map).forEach(([k, field]) => {
      if (k === 'name') return;
      const el = form.elements[field]; if (el && c[k]) el.value = c[k];
    });
    form.dispatchEvent(new CustomEvent('autofilled'));
  });
}

/* =====================================================
   DEVIS
   ===================================================== */
const TRI = ['N/C', 'OUI', 'NON'];
const seg = n => `<div class="seg">${TRI.map(v => `<label><input type="radio" name="${n}" value="${v}"><span>${v}</span></label>`).join('')}</div>`;
function accHTML(p) {
  const row = (label, name, note) => `<div class="acc-row">${label}${seg(p + '.' + name)}${note ? `<input name="${p}.${name}Note" placeholder="${note}">` : ''}</div>`;
  return `
  <label>Date<input type="date" name="${p}.periode"></label>
  <label>Type de logement<select name="${p}.type"><option>Appartement</option><option>Maison</option><option>Bureau / Local</option><option>Garde-meuble</option><option>Autre</option></select></label>
  <label class="wide" style="position:relative">Adresse<input class="addr" name="${p}.adresse" placeholder="Tape l'adresse, choisis dans la liste"></label>
  <input type="hidden" name="${p}.lat"><input type="hidden" name="${p}.lon">
  <label>Étage<input name="${p}.etage" placeholder="ex : 3, RDC"></label>
  <label>Portage (m)<input name="${p}.portage" placeholder="N/C"></label>
  ${row('Ascenseur', 'ascenseur', 'précision (taille non connue…)')}
  ${row('Monte-meubles', 'monte')}
  ${row('Passage fenêtre', 'fenetre')}
  ${row('Transbordement', 'transbordement')}
  ${row('Autorisation de stationnement', 'stationnement', 'précision (obtenue par le client…)')}`;
}
function mmHTML() {
  const row = (label, name, note) => `<div class="acc-row">${label}${seg('mm.' + name)}${note ? `<input name="mm.${name}Note" placeholder="${note}">` : ''}</div>`;
  return `
  <label>Date de l'intervention<input type="date" name="mm.date"></label>
  <label>Heure<input type="time" name="mm.heure"></label>
  <label>Durée prévue<input name="mm.duree" placeholder="ex : 2 h"></label>
  <label>Nature<select name="mm.nature"><option>Montée de meubles</option><option>Descente de meubles</option><option>Montée et descente</option><option>Autre</option></select></label>
  <label class="wide" style="position:relative">Adresse de l'intervention<input class="addr" name="mm.adresse" placeholder="Tape l'adresse, choisis dans la liste"></label>
  <input type="hidden" name="mm.lat"><input type="hidden" name="mm.lon">
  <label>Type de logement<select name="mm.type"><option>Appartement</option><option>Maison</option><option>Bureau / Local</option><option>Autre</option></select></label>
  <label>Étage<input name="mm.etage" placeholder="ex : 5"></label>
  <label class="w2">De quoi il s'agit<textarea name="mm.objet" rows="3" placeholder="ex : montée d'un canapé 3 places et d'un frigo par la fenêtre"></textarea></label>
  ${row('Passage fenêtre / balcon', 'fenetre')}
  ${row('Autorisation de stationnement', 'stationnement', 'précision (obtenue par le client…)')}
  <label class="w2">Remarques<input name="mm.remarque" placeholder="facultatif"></label>`;
}
$('#mmBox').innerHTML = mmHTML();
$('#accFrom').innerHTML = accHTML('from');
$('#accTo').innerHTML = accHTML('to');

const emptyMm = () => ({ date: '', heure: '', duree: '', nature: 'Montée de meubles', adresse: '', lat: '', lon: '', type: 'Appartement', etage: '', objet: '', fenetre: 'N/C', stationnement: 'N/C', stationnementNote: '', remarque: '' });
const emptyAcc = () => ({ periode: '', adresse: '', lat: '', lon: '', type: 'Appartement', etage: '', portage: '', ascenseur: 'N/C', ascenseurNote: '', monte: 'N/C', fenetre: 'N/C', transbordement: 'N/C', stationnement: 'N/C', stationnementNote: '' });
function devisNumber() { return `DEV-${year()}-${String(db.settings.nextDevis).padStart(3, '0')}`; }
function newDevis(p = {}) {
  const today = new Date();
  return {
    id: uid(), isNew: true, kind: 'demenagement', mm: emptyMm(), number: devisNumber(), date: iso(today), valid: iso(addDays(today, 30)),
    civ: 'M.', clientName: '', clientTel: '', clientEmail: '', clientAddress: '', clientSiret: '', paiement: 'acompte', sansTva: false,
    visited: false, visitedBy: '', visitedDate: iso(today),
    categorie: 'ÉCONOMIQUE', volume: '', voyage: 'NATIONAL', distance: '',
    from: emptyAcc(), to: emptyAcc(), mobilier: '', particularite: '', prixHT: '', garantie: true, statut: 'En attente', ...p
  };
}
let curDevis = null;
function openDevis(id, prefill) {
  curDevis = id ? structuredClone(db.devis.find(x => x.id === id)) : newDevis(prefill);
  curDevis.kind ||= 'demenagement'; curDevis.paiement ||= 'acompte'; curDevis.mm = { ...emptyMm(), ...curDevis.mm };
  fillForm($('#devisForm'), curDevis); toggleKind(); toggleCiv(false);
  $('#devisTitle').textContent = id ? `Devis ${curDevis.number}` : (curDevis.kind === 'mm' ? 'Nouveau devis monte-meuble' : 'Nouveau devis');
  refreshClientList(); updateDevisTotals(); show('devisEdit');
}
function toggleKind() { const k = $('#devisForm').elements.kind.value; $$('#devisForm [data-kind]').forEach(e => e.classList.toggle('hidden', e.dataset.kind !== k)); }
$('#devisForm').elements.kind.onchange = toggleKind;
function calcTotals(ht, rate, acomptePct) {
  ht = r2(ht); const tva = r2(ht * rate / 100), ttc = r2(ht + tva), ac = r2(ttc * acomptePct / 100);
  return { ht, tva, ttc, ac, solde: r2(ttc - ac) };
}
// Entreprise : on peut ne pas demander d'acompte (règlement en une fois le jour de la prestation)
const payMode = d => (d.civ === 'Société' && d.paiement === 'unique') ? 'unique' : 'acompte';
const acomptePct = d => payMode(d) === 'unique' ? 0 : db.settings.acompte;
function toggleCiv(changed) {
  const f = $('#devisForm'), soc = f.elements.civ.value === 'Société';
  $('#dSiretWrap').classList.toggle('hidden', !soc); $('#dPayWrap').classList.toggle('hidden', !soc);
  if (changed) f.elements.paiement.value = soc && db.settings.acompteEntreprise === false ? 'unique' : 'acompte';
  updateDevisTotals();
}
$('#devisForm').elements.civ.onchange = () => toggleCiv(true);
$('#devisForm').addEventListener('autofilled', () => toggleCiv(true));
function updateDevisTotals() {
  const f = $('#devisForm'); const d = readForm(f);
  const t = calcTotals(d.prixHT, rateOf(d), acomptePct(d));
  $('#dTotals').innerHTML = (d.sansTva
    ? `<div class="big"><span>Prix net à payer (sans TVA)</span><span>${money(t.ttc)}</span></div>`
    : `<div><span>Prix HT</span><span>${money(t.ht)}</span></div>
    <div><span>TVA ${db.settings.tvaRate} %</span><span>${money(t.tva)}</span></div>
    <div class="big"><span>Prix TTC</span><span>${money(t.ttc)}</span></div>`) + `
    ${payMode(d) === 'unique'
      ? `<div><span>Aucun acompte : règlement en une fois le jour de la prestation</span><span>${money(t.ttc)}</span></div>`
      : `<div><span>${db.settings.acompte} % à la commande</span><span>${money(t.ac)}</span></div>
    <div><span>Solde à la livraison</span><span>${money(t.solde)}</span></div>`}`;
}
['input', 'change'].forEach(ev => $('#devisForm').addEventListener(ev, e => { if (['prixHT', 'paiement', 'sansTva'].includes(e.target.name)) updateDevisTotals(); }));
autoFillClient($('#devisForm'), { name: 'clientName', civ: 'civ', tel: 'clientTel', email: 'clientEmail', address: 'clientAddress', siret: 'clientSiret' });

function collectDevis() {
  const d = { ...curDevis, ...readForm($('#devisForm')) };
  d.from = { ...emptyAcc(), ...d.from }; d.to = { ...emptyAcc(), ...d.to }; d.mm = { ...emptyMm(), ...d.mm };
  return d;
}
function saveDevis(silent) {
  const d = collectDevis();
  if (!d.clientName.trim()) { toast('Indique le nom du client'); return null; }
  const wasNew = d.isNew; delete d.isNew;
  const prev = db.devis.find(x => x.id === d.id);
  if (wasNew) { db.devis.push(d); db.settings.nextDevis++; }
  else db.devis[db.devis.indexOf(prev)] = d;
  upsertClient({ name: d.clientName, civ: d.civ, tel: d.clientTel, email: d.clientEmail, address: d.clientAddress, siret: d.clientSiret, type: d.civ === 'Société' ? 'entreprise' : '' });
  if (d.statut === 'Accepté' && (!prev || prev.statut !== 'Accepté')) addEventsFromDevis(d);
  saveDB(); curDevis = d; $('#devisTitle').textContent = `Devis ${d.number}`;
  if (!silent) toast('Devis enregistré');
  return d;
}
$('#dSave').onclick = () => saveDevis();
$('#newDevis').onclick = () => openDevis();
$('#newDevisMm').onclick = () => openDevis(null, { kind: 'mm' });
const isMm = d => d.kind === 'mm';
const route = d => isMm(d) ? `Monte-meuble – ${cityOf(d.mm?.adresse)}` : `${cityOf(d.from.adresse)} → ${cityOf(d.to.adresse)}`;

/* Liste des devis */
function renderDevis() {
  const q = $('#qDevis').value.trim().toLowerCase();
  const rows = db.devis.filter(d => (d.clientName + d.number).toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  $('#devisTable').innerHTML = rows.length ? `
    <tr><th>N°</th><th>Date</th><th>Client</th><th>Prestation</th><th class="r">TTC</th><th>Statut</th><th></th></tr>
    ${rows.map(d => `<tr>
      <td>${esc(d.number)}</td><td>${frDate(d.date)}</td><td>${esc(d.clientName)}</td>
      <td>${esc(route(d))}</td>
      <td class="r">${money(calcTotals(d.prixHT, rateOf(d), 0).ttc)}</td>
      <td><select data-st="${d.id}">${['En attente', 'Accepté', 'Refusé'].map(s => `<option ${s === d.statut ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="r"><button class="btn small" data-o="${d.id}">Ouvrir</button><button class="btn small" data-p="${d.id}">PDF</button>${isMm(d) ? '' : `<button class="btn small" data-l="${d.id}">Lettre de voiture</button>`}<button class="btn small" data-f="${d.id}">Facturer</button><button class="btn small danger" data-x="${d.id}">Suppr.</button></td>
    </tr>`).join('')}` : `<tr><td class="empty">Aucun devis pour l'instant. Clique sur « Nouveau devis ».</td></tr>`;
  $$('[data-o]', $('#devisTable')).forEach(b => b.onclick = () => openDevis(b.dataset.o));
  $$('[data-p]', $('#devisTable')).forEach(b => b.onclick = () => pdf('devis', db.devis.find(x => x.id === b.dataset.p)));
  $$('[data-l]', $('#devisTable')).forEach(b => b.onclick = () => lettreFromDevis(db.devis.find(x => x.id === b.dataset.l)));
  $$('[data-f]', $('#devisTable')).forEach(b => b.onclick = () => factureFromDevis(db.devis.find(x => x.id === b.dataset.f)));
  $$('[data-x]', $('#devisTable')).forEach(b => b.onclick = () => { if (confirm('Supprimer ce devis ?')) { db.devis = db.devis.filter(x => x.id !== b.dataset.x); saveDB(); renderDevis(); } });
  $$('[data-st]', $('#devisTable')).forEach(s => s.onchange = () => {
    const d = db.devis.find(x => x.id === s.dataset.st); const was = d.statut; d.statut = s.value;
    if (s.value === 'Accepté' && was !== 'Accepté') addEventsFromDevis(d);
    saveDB(); toast(`Devis ${d.number} : ${d.statut}`);
  });
}
$('#qDevis').oninput = renderDevis;

/* ---------- Adresses (autocomplétion) et kilométrage ---------- */
async function geocode(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`);
  const j = await r.json(); return j[0] ? { lat: j[0].lat, lon: j[0].lon } : null;
}
async function calcDistance(f, silent) {
  const g = n => f.elements[n]; const pts = [];
  try {
    for (const p of ['from', 'to']) {
      let la = g(p + '.lat').value, lo = g(p + '.lon').value;
      if (!la) {
        const a = g(p + '.adresse').value.trim();
        if (!a) { if (!silent) toast('Renseigne les adresses de chargement et de livraison'); return; }
        const c = await geocode(a);
        if (!c) { if (!silent) toast('Adresse introuvable : ' + a); return; }
        la = c.lat; lo = c.lon; g(p + '.lat').value = la; g(p + '.lon').value = lo;
      }
      pts.push(lo + ',' + la);
    }
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${pts.join(';')}?overview=false`);
    const j = await r.json();
    if (j.routes && j.routes[0]) { const km = j.routes[0].distance / 1000; g('distance').value = km < 10 ? Math.round(km * 10) / 10 : Math.round(km); if (!silent) toast('Distance calculée'); }
    else if (!silent) toast('Itinéraire introuvable');
  } catch (e) { if (!silent) toast('Pas de connexion : saisis la distance à la main'); }
}
$('#btnKm').onclick = () => calcDistance($('#devisForm'), false);

function attachAddr(input) {
  const wrap = input.parentElement; wrap.style.position = 'relative';
  const box = document.createElement('div'); box.className = 'ac hidden'; wrap.appendChild(box);
  const base = input.name.replace(/adresse$/, '');
  const latEl = input.form.elements[base + 'lat'], lonEl = input.form.elements[base + 'lon'];
  let t;
  input.addEventListener('input', () => {
    if (latEl) { latEl.value = ''; lonEl.value = ''; }
    clearTimeout(t);
    const q = input.value.trim(); if (q.length < 4) { box.classList.add('hidden'); return; }
    t = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        box.innerHTML = '';
        j.forEach(x => {
          const a = x.address || {};
          const rue = [a.house_number, a.road].filter(Boolean).join(' ');
          const ville = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
          const label = (rue && ville) ? `${rue}, ${ville}` : x.display_name;
          const d = document.createElement('div'); d.textContent = label;
          d.onclick = () => {
            input.value = label; box.classList.add('hidden');
            if (latEl) { latEl.value = x.lat; lonEl.value = x.lon; }
            if (base === 'from.' || base === 'to.') { const f = input.form; if (f.elements['from.adresse'].value && f.elements['to.adresse'].value) calcDistance(f, true); }
          };
          box.appendChild(d);
        });
        box.classList.toggle('hidden', !j.length);
      } catch (e) { box.classList.add('hidden'); }
    }, 500);
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 200));
}
$$('input.addr').forEach(attachAddr);

/* ---------- Agenda auto depuis un devis accepté ---------- */
function eventTitle(d, side) {
  const vol = d.volume ? ` – ${d.volume} m³` : '';
  return `${side === 'from' ? 'Chargement' : 'Livraison'} : ${d.clientName}${vol} – ${cityOf(d.from.adresse)} → ${cityOf(d.to.adresse)}`;
}
function addEventsFromDevis(d) {
  db.events = db.events.filter(e => !(e.devisId === d.id && e.auto));
  if (isMm(d)) {
    const m = d.mm;
    if (m.date) {
      db.events.push({ id: uid(), date: m.date, devisId: d.id, auto: true,
        title: `Monte-meuble${m.heure ? ' ' + m.heure : ''} : ${d.clientName} – ${m.nature}${m.etage ? ' – étage ' + m.etage : ''} – ${cityOf(m.adresse)}` });
      toast("Date ajoutée à l'agenda");
    } else toast("Devis accepté : renseigne la date pour l'agenda");
    return;
  }
  const ds = [['from', d.from.periode], ['to', d.to.periode]].filter(x => x[1]);
  if (ds.length === 2 && ds[0][1] === ds[1][1]) ds.pop();
  ds.forEach(([side, date]) => db.events.push({ id: uid(), date, title: eventTitle(d, side), devisId: d.id, auto: true }));
  if (ds.length) toast('Dates ajoutées à l\'agenda'); else toast('Devis accepté : renseigne les dates pour l\'agenda');
}

/* =====================================================
   FACTURES
   ===================================================== */
let curFact = null;
const factNum = f => parseInt(String(f.number), 10) || 0;
// Numéro suivant = plus grand numéro de facture existant + 1 (ou le n° de départ des Réglages s'il n'y a aucune facture).
// Ouvrir « Nouvelle facture » ne consomme rien : le numéro ne bouge que quand on enregistre, et un numéro supprimé redevient libre.
const nextFactNum = () => db.factures.length ? Math.max(...db.factures.map(factNum)) + 1 : db.settings.nextFacture;
const factNumber = () => `${nextFactNum()}-${year()}`;
const kindLabel = f => ({ complete: 'complète', acompte: 'acompte', solde: 'solde' }[f.kind || 'complete'] || 'complète');
const normName = s => String(s || '').trim().toLowerCase();

// Factures déjà faites pour ce client : même devis, ou même nom si la facture n'est liée à aucun devis (la facture en cours est exclue)
function factsFor(name, devisId, exceptId) {
  const n = normName(name);
  return db.factures.filter(f => f.id !== exceptId && (devisId
    ? (f.devisId === devisId || (!f.devisId && n && normName(f.clientName) === n))
    : (n && normName(f.clientName) === n))).sort((a, b) => factNum(a) - factNum(b));
}
const devisFor = (name, devisId) => db.devis.find(x => x.id === devisId)
  || db.devis.filter(x => normName(x.clientName) === normName(name)).sort((a, b) => b.date.localeCompare(a.date))[0];
const prestaDesc = d => (isMm(d)
  ? `LOCATION DE MONTE-MEUBLE – ${d.mm.nature} – ${cityOf(d.mm.adresse)}`
  : `DÉMÉNAGEMENT ${cityOf(d.from.adresse)} → ${cityOf(d.to.adresse)}`).toUpperCase();
// Reste à facturer (HT) = prix HT du devis - HT déjà facturé (le HT d'une facture sans TVA = le montant net)
const resteHT = (d, prev) => r2(Number(d.prixHT) - prev.reduce((t, f) => t + factTotals(f).ht, 0));
// Ligne de prestation selon le type de facture (complète, acompte, solde)
function kindLine(kind, d, prev) {
  const base = prestaDesc(d);
  if (kind === 'acompte') return { desc: `ACOMPTE ${db.settings.acompte} % – ${base}`, pu: r2(Number(d.prixHT) * db.settings.acompte / 100) };
  if (kind === 'solde') {
    const refs = prev.map(f => f.number).join(', ');
    return { desc: `SOLDE – ${base}${refs ? ` (déjà facturé : n° ${refs})` : ''}`, pu: Math.max(0, resteHT(d, prev)) };
  }
  return { desc: base, pu: d.prixHT };
}

function newFact(p = {}) {
  return { id: uid(), isNew: true, kind: 'complete', number: factNumber(), date: iso(new Date()), statut: 'À payer', type: 'particulier', sansTva: false, clientName: '', clientAddress: '', clientSiret: '', lines: [{ title: 'LISTE DES PRESTATIONS', desc: '', qty: 1, pu: '' }], ...p };
}

// Petite fenêtre : « une facture existe déjà, faire une facture de solde ? » -> 'esp' | 'tva' | 'other' | 'cancel'
function askSolde({ name, prev, reste, hasDevis, fromDevis }) {
  return new Promise(resolve => {
    const el = document.createElement('div'); el.className = 'dlg';
    const lst = prev.map(f => `<li><b>${esc(f.number)}</b> · ${esc(kindLabel(f))} · ${money(factTotals(f).ttc)}${f.sansTva ? ' (sans TVA)' : ' TTC'} · ${esc(f.statut)}</li>`).join('');
    const full = hasDevis && reste <= 0;
    el.innerHTML = `<div class="dlg-box"><h3>Facture déjà faite pour ${esc(name)}</h3><ul>${lst}</ul>`
      + (full ? '<p>Ce devis est <b>déjà entièrement facturé</b>.</p>'
        : hasDevis ? `<p>Reste à facturer : <b>${money(reste)}</b> HT.</p><p>Faire une facture de solde ?</p>`
        : '<p>Faire une facture de solde ? (le montant sera à saisir)</p>')
      + `<div class="dlg-btns">${full ? '' : '<button class="btn primary" data-c="esp">Solde en espèces (sans TVA)</button><button class="btn primary" data-c="tva">Solde par virement (avec TVA)</button>'}`
      + `<button class="btn" data-c="other">${fromDevis ? 'Ouvrir la dernière facture' : 'Non, continuer cette facture'}</button></div></div>`;
    el.onclick = e => { const c = e.target.dataset.c || (e.target === el ? 'cancel' : null); if (!c) return; el.remove(); resolve(c); };
    document.body.appendChild(el);
  });
}
// Ouvre une facture de solde préremplie (cash = espèces = sans TVA ; sinon virement avec TVA)
function openSolde(d, name, prev, cash) {
  const last = prev[prev.length - 1] || {}, rel = d ? prev.filter(f => !f.devisId || f.devisId === d.id) : prev;
  const l = d ? kindLine('solde', d, rel) : { desc: 'SOLDE', pu: '' };
  openFact(null, {
    kind: 'solde', devisId: d?.id, sansTva: !!cash, clientName: d?.clientName || name,
    clientAddress: d?.clientAddress ?? last.clientAddress ?? '', clientSiret: d?.clientSiret ?? last.clientSiret ?? '',
    type: last.type || (d && d.civ === 'Société' ? 'entreprise' : 'particulier'),
    lines: [{ title: 'LISTE DES PRESTATIONS', desc: l.desc, qty: 1, pu: l.pu }]
  });
}
async function factureFromDevis(d) {
  const prev = factsFor(d.clientName, d.id);
  if (prev.length) {
    const c = await askSolde({ name: d.clientName, prev, reste: resteHT(d, prev.filter(f => !f.devisId || f.devisId === d.id)), hasDevis: true, fromDevis: true });
    if (c === 'esp' || c === 'tva') openSolde(d, d.clientName, prev, c === 'esp');
    else if (c === 'other') openFact(prev[prev.length - 1].id);
    return;
  }
  openFact(null, { clientName: d.clientName, clientAddress: d.clientAddress, devisId: d.id, sansTva: !!d.sansTva,
    lines: [{ title: 'LISTE DES PRESTATIONS', desc: prestaDesc(d), qty: 1, pu: d.prixHT }] });
}
function lineHTML(l) {
  return `<div class="line">
    <label>Prestation<input data-k="title" value="${esc(l.title)}"></label>
    <label>Description<input data-k="desc" value="${esc(l.desc)}"></label>
    <label>Qté<input data-k="qty" type="number" step="any" value="${esc(l.qty)}"></label>
    <label>Prix unitaire HT<input data-k="pu" type="number" step="0.01" value="${esc(l.pu)}"></label>
    <button type="button" class="btn small danger" data-del title="Supprimer la ligne">✕</button></div>`;
}
function readLines() {
  return $$('#lines .line').map(r => ({ title: $('[data-k=title]', r).value, desc: $('[data-k=desc]', r).value, qty: $('[data-k=qty]', r).value, pu: $('[data-k=pu]', r).value }));
}
function bindLines() {
  $$('#lines [data-del]').forEach(b => b.onclick = () => { b.closest('.line').remove(); updateFactTotals(); });
}
const factTotals = f => {
  const t = calcTotals(f.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.pu) || 0), 0), rateOf(f), 0);
  t.acompte = Math.max(0, r2(f.acompte)); t.reste = r2(t.ttc - t.acompte); return t;
};
function updateFactTotals() {
  const F = $('#factForm').elements, sans = F.sansTva.checked;
  const t = factTotals({ lines: readLines(), acompte: F.acompte.value, sansTva: sans });
  $('#fTotals').innerHTML = (sans
    ? `<div class="big"><span>Total net à payer (sans TVA)</span><span>${money(t.ttc)}</span></div>`
    : `<div><span>Total HT</span><span>${money(t.ht)}</span></div><div><span>TVA ${db.settings.tvaRate} %</span><span>${money(t.tva)}</span></div><div class="big"><span>Total TTC</span><span>${money(t.ttc)}</span></div>`)
    + (t.acompte > 0 ? `<div><span>Acompte déjà réglé</span><span>- ${money(t.acompte)}</span></div><div class="big"><span>Reste à payer</span><span>${money(t.reste)}</span></div>` : '');
}
let askedKey = '';
function openFact(id, prefill) {
  curFact = id ? structuredClone(db.factures.find(x => x.id === id)) : newFact(prefill);
  curFact.kind ||= 'complete'; askedKey = normName(curFact.clientName);
  fillForm($('#factForm'), curFact);
  $('#lines').innerHTML = curFact.lines.map(lineHTML).join(''); bindLines();
  $('#factTitle').textContent = id ? `Facture ${curFact.number}` : 'Nouvelle facture';
  toggleSiret(); refreshClientList(); updateFactTotals(); updateFactInfo(); show('facturesEdit');
}
function toggleSiret() { $('#siretWrap').classList.toggle('hidden', $('#factForm').elements.type.value !== 'entreprise'); }
$('#factForm').elements.type.onchange = toggleSiret;
$('#addLine').onclick = () => { $('#lines').insertAdjacentHTML('beforeend', lineHTML({ title: '', desc: '', qty: 1, pu: '' })); bindLines(); };
$('#factForm').addEventListener('input', updateFactTotals);
autoFillClient($('#factForm'), { name: 'clientName', address: 'clientAddress', siret: 'clientSiret', type: 'type' });
$('#factForm').addEventListener('autofilled', toggleSiret);
$('#factForm').elements.clientName.addEventListener('change', toggleSiret);

// Bandeau « déjà facturé pour ce client » + question « facture de solde ? » quand on choisit un client qui a déjà une facture
function updateFactInfo() {
  const el = $('#factInfo'), name = $('#factForm').elements.clientName.value;
  const prev = curFact ? factsFor(name, curFact.devisId, curFact.id) : [];
  if (!prev.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const d = devisFor(name, curFact.devisId), rel = d ? prev.filter(f => !f.devisId || f.devisId === d.id) : prev;
  el.innerHTML = '<b>Déjà facturé pour ce client :</b> ' + prev.map(f => `${esc(f.number)} (${esc(kindLabel(f))}, ${money(factTotals(f).ttc)}${f.sansTva ? ' sans TVA' : ' TTC'}, ${esc(f.statut)})`).join(' · ')
    + (d && rel.length ? ` — reste à facturer : <b>${money(resteHT(d, rel))}</b> HT` : '');
  el.classList.remove('hidden');
}
async function checkClient() {
  updateFactInfo();
  const name = $('#factForm').elements.clientName.value.trim(), key = normName(name);
  if (!curFact?.isNew || !key || key === askedKey) return;
  askedKey = key;
  const prev = factsFor(name, curFact.devisId, curFact.id);
  if (!prev.length) return;
  const d = devisFor(name, curFact.devisId), rel = d ? prev.filter(f => !f.devisId || f.devisId === d.id) : prev;
  const c = await askSolde({ name, prev, reste: d ? resteHT(d, rel) : 0, hasDevis: !!d });
  if (c === 'esp' || c === 'tva') openSolde(d, name, prev, c === 'esp');
}
$('#factForm').elements.clientName.addEventListener('change', checkClient);
$('#factForm').addEventListener('autofilled', checkClient);
// Changer le « Type de facture » remplit la 1re ligne (acompte = % du devis, solde = reste à facturer)
$('#factForm').elements.kind.onchange = () => {
  const F = $('#factForm').elements, d = devisFor(F.clientName.value, curFact.devisId), row = $$('#lines .line')[0];
  if (!d) { toast('Aucun devis trouvé pour ce client : saisis le montant à la main'); return; }
  if (!row) return;
  const prev = factsFor(F.clientName.value, d.id, curFact.id).filter(f => !f.devisId || f.devisId === d.id);
  const l = kindLine(F.kind.value, d, prev);
  $('[data-k=desc]', row).value = l.desc; $('[data-k=pu]', row).value = l.pu;
  curFact.devisId ||= d.id; updateFactTotals(); updateFactInfo();
};

function collectFact() { const f = { ...curFact, ...readForm($('#factForm')) }; f.lines = readLines(); return f; }
function saveFact(silent) {
  const f = collectFact();
  if (!f.clientName.trim()) { toast('Indique le client à facturer'); return null; }
  const wasNew = f.isNew; delete f.isNew;
  // Sécurité : jamais deux factures avec le même numéro
  if (db.factures.some(x => x.id !== f.id && x.number === f.number)) {
    if (!wasNew) { toast(`Le numéro ${f.number} existe déjà : change-le`); return null; }
    f.number = factNumber(); $('#factForm').elements.number.value = f.number;
    toast(`Numéro déjà pris : cette facture devient la n° ${f.number}`);
  }
  if (wasNew) db.factures.push(f);
  else db.factures[db.factures.findIndex(x => x.id === f.id)] = f;
  upsertClient({ name: f.clientName, address: f.clientAddress, siret: f.clientSiret, type: f.type });
  saveDB(); curFact = f; $('#factTitle').textContent = `Facture ${f.number}`; updateFactInfo();
  if (!silent) toast('Facture enregistrée');
  return f;
}
$('#fSave').onclick = () => saveFact();
$('#newFact').onclick = () => openFact();

function renderFactures() {
  const q = $('#qFact').value.trim().toLowerCase();
  const rows = db.factures.filter(f => (f.clientName + f.number).toLowerCase().includes(q)).sort((a, b) => {
    // numéro de type "81-2026" : on compare l'année puis le numéro, en nombres (pas en texte, sinon 100 passe avant 99)
    const [na, ya] = String(a.number).split('-').map(Number), [nb, yb] = String(b.number).split('-').map(Number);
    return (ya || 0) - (yb || 0) || (na || 0) - (nb || 0);
  });
  $('#factTable').innerHTML = rows.length ? `
    <tr><th>N°</th><th>Date</th><th>Client</th><th class="r">TTC</th><th>Statut</th><th></th></tr>
    ${rows.map(f => `<tr><td>${esc(f.number)}</td><td>${frDate(f.date)}</td><td>${esc(f.clientName)}${f.kind && f.kind !== 'complete' ? ` <span class="hint">(${esc(kindLabel(f))})</span>` : ''}</td>
      <td class="r">${money(factTotals(f).ttc)}</td>
      <td><select data-st="${f.id}">${['À payer', 'Payée'].map(s => `<option ${s === f.statut ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="r"><button class="btn small" data-o="${f.id}">Ouvrir</button><button class="btn small" data-p="${f.id}">PDF</button><button class="btn small danger" data-x="${f.id}">Suppr.</button></td></tr>`).join('')}`
    : `<tr><td class="empty">Aucune facture. Clique sur « Nouvelle facture », ou sur « Facturer » depuis un devis.</td></tr>`;
  const T = $('#factTable');
  $$('[data-o]', T).forEach(b => b.onclick = () => openFact(b.dataset.o));
  $$('[data-p]', T).forEach(b => b.onclick = () => pdf('facture', db.factures.find(x => x.id === b.dataset.p)));
  $$('[data-x]', T).forEach(b => b.onclick = () => { if (confirm('Supprimer cette facture ?')) { db.factures = db.factures.filter(x => x.id !== b.dataset.x); saveDB(); renderFactures(); } });
  $$('[data-st]', T).forEach(s => s.onchange = () => { db.factures.find(x => x.id === s.dataset.st).statut = s.value; saveDB(); });
}
$('#qFact').oninput = renderFactures;

/* =====================================================
   LETTRES DE VOITURE
   ===================================================== */
let curLettre = null;
const lettreNumber = () => `${db.settings.nextLettre}-${year()}`;
const emptyPoint = () => ({ periode: '', adresse: '', etage: '', lat: '', lon: '' });
function newLettre(p = {}) {
  return {
    id: uid(), isNew: true, number: lettreNumber(), date: iso(new Date()),
    civ: 'M.', clientName: '', clientTel: '', clientAddress: '', clientSiret: '',
    categorie: 'ÉCONOMIQUE', volume: '', voyage: 'NATIONAL', mode: 'ROUTE', distance: '',
    from: emptyPoint(), to: emptyPoint(), prixHT: '', paiement: 'acompte', reglement: 'facture', sansTva: false, acompteVerse: '', garantie: true,
    vehicules: '', obsChef: '', remarques: '', ...p
  };
}
// Depuis un devis : tout est repris (client, adresses, dates, prix). Si la lettre existe déjà, on l'ouvre.
function lettreFromDevis(d) {
  const ex = db.lettres.find(l => l.devisId === d.id);
  if (ex) { openLettre(ex.id); toast('Une lettre de voiture existe déjà pour ce devis'); return; }
  const pt = a => ({ periode: a.periode || '', adresse: a.adresse || '', etage: a.etage || '', lat: a.lat || '', lon: a.lon || '' });
  openLettre(null, {
    devisId: d.id, civ: d.civ, clientName: d.clientName, clientTel: d.clientTel, clientAddress: d.clientAddress, clientSiret: d.clientSiret || '',
    categorie: d.categorie, volume: d.volume, voyage: d.voyage, distance: d.distance,
    from: pt(d.from), to: pt(d.to), prixHT: d.prixHT, paiement: d.paiement || 'acompte', sansTva: !!d.sansTva, garantie: d.garantie
  });
}
// Acompte : calculé d'après le prix, sauf si on saisit un montant à la main.
// Paiement en espèces (pas de facture) : aucun acompte automatique, seulement celui qu'on saisit.
function lettreTotals(l) {
  const cash = l.reglement === 'especes';
  const unique = payMode(l) === 'unique';
  const noTva = cash || !!l.sansTva;   // espèces = TVA non applicable : on reste sur le HT
  const t = calcTotals(l.prixHT, noTva ? 0 : db.settings.tvaRate, (unique || cash) ? 0 : db.settings.acompte);
  const over = String(l.acompteVerse ?? '').trim();
  t.custom = false;
  if (over !== '' && !isNaN(Number(over))) { t.ac = r2(over); t.solde = r2(t.ttc - t.ac); t.custom = true; }
  t.unique = unique; t.cash = cash; t.sansTva = noTva; return t;
}
function openLettre(id, prefill) {
  curLettre = id ? structuredClone(db.lettres.find(x => x.id === id)) : newLettre(prefill);
  curLettre.paiement ||= 'acompte'; curLettre.reglement ||= 'facture';
  fillForm($('#lettreForm'), curLettre); toggleLettreCiv(false);
  $('#lettreTitle').textContent = id ? `Lettre de voiture ${curLettre.number}` : 'Nouvelle lettre de voiture';
  refreshClientList(); updateLettreTotals(); show('lettresEdit');
}
function toggleLettreCiv(changed) {
  const f = $('#lettreForm'), soc = f.elements.civ.value === 'Société';
  $('#lSiretWrap').classList.toggle('hidden', !soc); $('#lPayWrap').classList.toggle('hidden', !soc);
  if (changed) f.elements.paiement.value = soc && db.settings.acompteEntreprise === false ? 'unique' : 'acompte';
  updateLettreTotals();
}
function collectLettre() {
  const l = { ...curLettre, ...readForm($('#lettreForm')) };
  l.from = { ...emptyPoint(), ...l.from }; l.to = { ...emptyPoint(), ...l.to };
  return l;
}
function updateLettreTotals() {
  if (!curLettre) return;
  const t = lettreTotals(collectLettre());
  $('#lTotals').innerHTML = (t.sansTva
    ? `<div><span>Prix HT</span><span>${money(t.ht)}</span></div>
    <div><span>TVA non applicable${t.cash ? ' (espèces)' : ''}</span><span>${money(0)}</span></div>
    <div class="big"><span>Total à payer</span><span>${money(t.ttc)}</span></div>`
    : `<div><span>Prix HT</span><span>${money(t.ht)}</span></div>
    <div><span>TVA ${db.settings.tvaRate} %</span><span>${money(t.tva)}</span></div>
    <div class="big"><span>Prix TTC</span><span>${money(t.ttc)}</span></div>`) + `
    <div><span>${t.cash ? (t.ac > 0 ? 'Acompte versé en espèces' : 'Aucun acompte') : t.unique ? 'Acompte (aucun : règlement en une fois)' : 'Acompte versé'}</span><span>${money(t.ac)}</span></div>
    <div><span>Solde restant dû</span><span>${money(t.solde)}</span></div>`;
}
$('#lettreForm').elements.civ.onchange = () => toggleLettreCiv(true);
$('#lettreForm').addEventListener('autofilled', () => toggleLettreCiv(true));
['input', 'change'].forEach(ev => $('#lettreForm').addEventListener(ev, updateLettreTotals));
autoFillClient($('#lettreForm'), { name: 'clientName', civ: 'civ', tel: 'clientTel', address: 'clientAddress', siret: 'clientSiret' });
$('#btnKmL').onclick = () => calcDistance($('#lettreForm'), false);

function saveLettre(silent) {
  const l = collectLettre();
  if (!l.clientName.trim()) { toast('Indique le nom du client'); return null; }
  const wasNew = l.isNew; delete l.isNew;
  if (wasNew) { db.lettres.push(l); db.settings.nextLettre++; }
  else db.lettres[db.lettres.findIndex(x => x.id === l.id)] = l;
  upsertClient({ name: l.clientName, civ: l.civ, tel: l.clientTel, address: l.clientAddress, siret: l.clientSiret, type: l.civ === 'Société' ? 'entreprise' : '' });
  saveDB(); curLettre = l; $('#lettreTitle').textContent = `Lettre de voiture ${l.number}`;
  if (!silent) toast('Lettre de voiture enregistrée');
  return l;
}
$('#lSave').onclick = () => saveLettre();
$('#newLettre').onclick = () => openLettre();

function renderLettres() {
  const q = $('#qLettre').value.trim().toLowerCase();
  const rows = db.lettres.filter(l => (l.clientName + l.number).toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  $('#lettreTable').innerHTML = rows.length ? `
    <tr><th>N°</th><th>Date</th><th>Client</th><th>Trajet</th><th class="r">Solde dû</th><th></th></tr>
    ${rows.map(l => `<tr><td>${esc(l.number)}</td><td>${frDate(l.date)}</td><td>${esc(l.clientName)}</td>
      <td>${esc(cityOf(l.from.adresse))} → ${esc(cityOf(l.to.adresse))}</td><td class="r">${money(lettreTotals(l).solde)}</td>
      <td class="r"><button class="btn small" data-o="${l.id}">Ouvrir</button><button class="btn small" data-p="${l.id}">PDF</button><button class="btn small danger" data-x="${l.id}">Suppr.</button></td></tr>`).join('')}`
    : `<tr><td class="empty">Aucune lettre de voiture. Clique sur « Lettre de voiture » depuis un devis, ou sur « Nouvelle lettre de voiture ».</td></tr>`;
  const T = $('#lettreTable');
  $$('[data-o]', T).forEach(b => b.onclick = () => openLettre(b.dataset.o));
  $$('[data-p]', T).forEach(b => b.onclick = () => pdf('lettre', db.lettres.find(x => x.id === b.dataset.p)));
  $$('[data-x]', T).forEach(b => b.onclick = () => { if (confirm('Supprimer cette lettre de voiture ?')) { db.lettres = db.lettres.filter(x => x.id !== b.dataset.x); saveDB(); renderLettres(); } });
}
$('#qLettre').oninput = renderLettres;

/* =====================================================
   CLIENTS
   ===================================================== */
function renderClients() {
  const q = $('#qCli').value.trim().toLowerCase();
  const rows = db.clients.filter(c => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('#cliTable').innerHTML = rows.length ? `
    <tr><th>Client</th><th>Téléphone</th><th>Email</th><th>Adresse</th><th>Devis</th><th>Factures</th><th></th></tr>
    ${rows.map(c => {
    const nd = db.devis.filter(d => d.clientName.toLowerCase() === c.name.toLowerCase()).length;
    const nf = db.factures.filter(d => d.clientName.toLowerCase() === c.name.toLowerCase()).length;
    return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.tel)}</td><td>${esc(c.email)}</td><td>${esc(c.address)}</td><td>${nd}</td><td>${nf}</td>
      <td class="r"><button class="btn small" data-d="${c.id}">Nouveau devis</button><button class="btn small" data-e="${c.id}">Modifier</button><button class="btn small danger" data-x="${c.id}">Suppr.</button></td></tr>`;
  }).join('')}` : `<tr><td class="empty">Les clients s'ajoutent tout seuls quand tu enregistres un devis ou une facture.</td></tr>`;
  const T = $('#cliTable');
  $$('[data-d]', T).forEach(b => b.onclick = () => { const c = db.clients.find(x => x.id === b.dataset.d); openDevis(null, { clientName: c.name, civ: c.civ || 'M.', clientTel: c.tel || '', clientEmail: c.email || '', clientAddress: c.address || '' }); });
  $$('[data-e]', T).forEach(b => b.onclick = () => editClient(db.clients.find(x => x.id === b.dataset.e)));
  $$('[data-x]', T).forEach(b => b.onclick = () => { if (confirm('Supprimer ce client ? (ses devis et factures sont conservés)')) { db.clients = db.clients.filter(x => x.id !== b.dataset.x); saveDB(); renderClients(); } });
}
function editClient(c) {
  const n = prompt('Nom', c.name); if (n === null) return;
  c.name = n.trim() || c.name;
  const t = prompt('Téléphone', c.tel || ''); if (t !== null) c.tel = t;
  const m = prompt('Email', c.email || ''); if (m !== null) c.email = m;
  const a = prompt('Adresse', c.address || ''); if (a !== null) c.address = a;
  saveDB(); renderClients();
}
$('#newClient').onclick = () => { const n = prompt('Nom du client'); if (!n) return; upsertClient({ name: n }); saveDB(); renderClients(); };
$('#qCli').oninput = renderClients;

/* =====================================================
   AGENDA
   ===================================================== */
let cal = new Date(); cal.setDate(1);
function renderAgenda() {
  refreshClientList();
  const y = cal.getFullYear(), m = cal.getMonth();
  $('#mLabel').textContent = cal.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const offset = (new Date(y, m, 1).getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate(), today = iso(new Date());
  let h = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) h += '<div class="day off"></div>';
  for (let d = 1; d <= n; d++) {
    const ds = iso(new Date(y, m, d));
    const ev = db.events.filter(e => e.date === ds).map(e => `<div class="chip"><span data-ev="${e.id}" title="${esc(e.title)}">${esc(e.title)}</span><button data-del="${e.id}" title="Retirer">✕</button></div>`).join('');
    h += `<div class="day ${ds === today ? 'today' : ''}"><b>${d}</b>${ev}</div>`;
  }
  $('#cal').innerHTML = h;
  $$('#cal [data-del]').forEach(b => b.onclick = () => { db.events = db.events.filter(e => e.id !== b.dataset.del); saveDB(); renderAgenda(); });
  $$('#cal [data-ev]').forEach(s => s.onclick = () => { const e = db.events.find(x => x.id === s.dataset.ev); if (e.devisId && db.devis.some(d => d.id === e.devisId)) openDevis(e.devisId); });
}
$('#mPrev').onclick = () => { cal.setMonth(cal.getMonth() - 1); renderAgenda(); };
$('#mNext').onclick = () => { cal.setMonth(cal.getMonth() + 1); renderAgenda(); };
$('#mToday').onclick = () => { cal = new Date(); cal.setDate(1); renderAgenda(); };
$('#evAdd').onclick = () => {
  const f = $('#evForm'), name = f.elements.client.value.trim(), date = f.elements.date.value;
  if (!name || !date) { toast('Indique le client et la date'); return; }
  const dv = db.devis.filter(d => d.clientName.toLowerCase() === name.toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))[0];
  const note = f.elements.note.value.trim();
  const title = dv && isMm(dv) ? `${dv.clientName} – monte-meuble – ${cityOf(dv.mm.adresse)}${dv.clientTel ? ' – ' + dv.clientTel : ''}` : dv ? `${dv.clientName}${dv.volume ? ' – ' + dv.volume + ' m³' : ''} – ${cityOf(dv.from.adresse)} → ${cityOf(dv.to.adresse)}${dv.clientTel ? ' – ' + dv.clientTel : ''}` : name;
  db.events.push({ id: uid(), date, title: title + (note ? ' – ' + note : ''), devisId: dv?.id });
  saveDB(); cal = new Date(date + 'T12:00'); cal.setDate(1); f.reset(); renderAgenda(); toast('Ajouté à l\'agenda');
};

/* =====================================================
   RÉGLAGES
   ===================================================== */
function renderSettings() {
  fillForm($('#setForm'), db.settings);
  const sp = $('#signPrev'); sp.src = db.settings.signature || ''; sp.classList.toggle('hidden', !db.settings.signature);
}
$('#sSave').onclick = () => {
  const v = readForm($('#setForm'));
  ['nextDevis', 'nextFacture', 'nextLettre', 'tvaRate', 'acompte'].forEach(k => v[k] = Number(v[k]) || DEFAULTS.settings[k]);
  db.settings = { ...db.settings, ...v }; saveDB(); applyBrand(); toast('Réglages enregistrés');
};
function readImage(file, key) {
  if (!file) return; const r = new FileReader();
  r.onload = () => { db.settings[key] = r.result; saveDB(); renderSettings(); applyBrand(); toast('Image enregistrée'); };
  r.readAsDataURL(file);
}
$('#upLogo').onchange = e => readImage(e.target.files[0], 'logo');
$('#upSign').onchange = e => readImage(e.target.files[0], 'signature');
$('#exp').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = `sauvegarde-djk-${iso(new Date())}.json`; a.click();
};
$('#imp').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(t => { try { db = { ...structuredClone(DEFAULTS), ...JSON.parse(t) }; db.settings = { ...DEFAULTS.settings, ...db.settings }; migrate(db); saveDB(); toast('Sauvegarde restaurée'); renderSettings(); applyBrand(); } catch (x) { toast('Fichier invalide'); } });
};
function applyBrand() { $('#brandLogo').src = logoSrc(); }

/* =====================================================
   MODÈLES PDF
   ===================================================== */
const footer = s => `<div class="foot"><b>${esc(s.tagline)}</b>${esc(s.company)}<br>${esc(s.address1)} - ${esc(s.address2)} - tél : ${esc(s.tel)}<br>${esc(s.legal)}</div>`;
const tri = (v, note) => esc(v || 'N/C') + (note ? ` (${esc(note)})` : '');
function accLines(a) {
  return [`Type de logement : ${esc(a.type)}`,
  `Étage : ${esc(a.etage || 'N/C')} – Portage : ${esc(a.portage || 'N/C')} m`,
  `Ascenseur : ${tri(a.ascenseur, a.ascenseurNote)}`, `Monte-meubles : ${tri(a.monte)}`, `Passage fenêtre : ${tri(a.fenetre)}`,
  `Transbordement : ${tri(a.transbordement)}`, `Autorisation de stationnement : ${tri(a.stationnement, a.stationnementNote)}`].join('<br>');
}
function devisHTML(d) {
  const s = db.settings, t = calcTotals(d.prixHT, rateOf(d), acomptePct(d));
  const sal = d.civ === 'Mme' ? 'Madame' : d.civ === 'Société' ? 'Madame, Monsieur' : 'Monsieur';
  const civTxt = d.civ === 'Société' ? '' : d.civ + ' ';
  const head = `<div class="head"><img class="logo" src="${logoSrc()}" alt=""><div class="ref">
      <div class="big"><b>${esc(s.city)} LE : ${frDate(d.date)}</b></div>
      <div><b>Devis n° ${esc(d.number)}</b></div>
      <div><b>Nom du client :</b> ${civTxt}${esc(d.clientName)}</div>
      <div style="max-width:470px;margin-left:auto"><b>Adresse :</b> ${esc([d.clientAddress, d.clientTel && 'Tél : ' + d.clientTel, d.clientEmail && 'Email : ' + d.clientEmail].filter(Boolean).join(' — '))}</div></div></div>`;
  if (isMm(d)) return mmDevisHTML(d, head, s, t, sal);
  const mob = (d.mobilier || '').split('\n').map(x => x.trim()).filter(Boolean);
  const garantie = d.garantie ? `<tr><td colspan="2"><b>${esc(s.garantieText.split('\n')[0])}</b><br>${esc(s.garantieText.split('\n').slice(1).join(' '))} (taux d'assurance : ${esc(s.taux)} %)</td><td class="n">Incluse</td></tr>` : '';
  return `
  <div class="page devis">${head}<hr>
    <p class="mail">${esc(s.email)}</p>
    <h3 style="font-size:15px">${sal},</h3>
    <p>Nous vous remercions pour l'accueil que vous avez bien voulu nous réserver lors de nos échanges.</p>
    <p>Conformément à votre demande, nous avons le plaisir de vous adresser notre devis personnalisé pour votre projet de déménagement.</p>
    <p>Nous espérons que notre proposition retiendra favorablement votre attention et restons à votre entière disposition pour toute information complémentaire.</p>
    <p>Si notre offre correspond à vos attentes, nous vous invitons à nous retourner le devis daté et signé afin de confirmer votre déménagement.</p>
    <p>Nous vous remercions de votre confiance et serons ravis de vous accompagner dans la réalisation de votre projet.</p>
    <div class="sign-dir">La direction,</div>
    ${footer(s)}</div>

  <div class="page devis brk">${head}<hr>
    <p class="mail" style="margin-bottom:6px">${esc(s.email)}</p>
    <div class="visit">${d.visited ? `<b>Visité par :</b> ${esc(d.visitedBy)} <b>le :</b> ${frDate(d.visitedDate)}` : `<b>Visite :</b> non effectuée`}</div>
    <table><tr><td class="k">Catégorie</td><td>${esc(d.categorie)}</td><td class="k">Volume</td><td>${esc(d.volume)} m³</td></tr>
    <tr><td class="k">Voyage</td><td>${esc(d.voyage)}</td><td class="k">Distance</td><td>${esc(frNum(d.distance))} km</td></tr></table>
    <table><tr><th style="width:12%"></th><th>CHARGEMENT</th><th>LIVRAISON</th></tr>
      <tr><td class="k">Date</td><td>${frDay(d.from.periode)}</td><td>${frDay(d.to.periode)}</td></tr>
      <tr><td class="k">Adresse</td><td>${esc(d.from.adresse)}</td><td>${esc(d.to.adresse)}</td></tr>
      <tr><td class="k">Accès</td><td class="acc">${accLines(d.from)}</td><td class="acc">${accLines(d.to)}</td></tr></table>
    ${mob.length ? `<h3>MOBILIER ET ÉLÉMENTS À TRANSPORTER</h3><ul>${mob.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${d.particularite ? `<p><b>Particularité :</b> ${nl(d.particularite)}</p>` : ''}
    <h3>DÉTAIL DU PRIX</h3>
    ${priceTable(d, s, t, garantie)}
    ${payRow(d, t, 'à la livraison')}
    <div class="sigs">
      <div><b>Pour ${esc(s.company)}</b><br>Date : ${frDate(d.date)}${sealHTML()}</div>
      <div><b>Le client</b><br>Date : ____/____/________<br>Mention manuscrite « Bon pour accord » :<br>Signature</div></div>
    <p style="text-align:center;margin:0 0 8px">Merci de votre confiance — DJK Déménagement</p>
    ${footer(s)}</div>`;
}
// Tableau « détail du prix » : avec TVA, ou sans TVA (prix net)
function priceTable(d, s, t, garantie) {
  if (d.sansTva) return `<table class="price">${garantie}
      <tr class="ttc"><td colspan="2">PRIX NET À PAYER – TVA non applicable (Valable jusqu'au ${frDate(d.valid)})</td><td class="n">${money(t.ttc)}</td></tr></table>`;
  return `<table class="price"><tr><td colspan="2"><b>PRIX H.T.</b></td><td class="n">${money(t.ht)}</td></tr>
      ${garantie}
      <tr><td colspan="2">TVA ${s.tvaRate} % SUR (${money(t.ht)} en H.T.)</td><td class="n">${money(t.tva)}</td></tr>
      <tr class="ttc"><td colspan="2">PRIX T.T.C (Valable jusqu'au ${frDate(d.valid)})</td><td class="n">${money(t.ttc)}</td></tr></table>`;
}
function mmDevisHTML(d, head, s, t, sal) {
  const m = d.mm;
  return `<div class="page devis">${head}<hr>
    <p class="mail">${esc(s.email)}</p>
    <h3 style="font-size:15px">${sal},</h3>
    <p>Conformément à votre demande, nous avons le plaisir de vous adresser notre devis pour votre intervention avec monte-meuble. Si notre offre vous convient, merci de nous le retourner daté et signé.</p>
    <h3>DEVIS MONTE-MEUBLE</h3>
    <table>
      <tr><td class="k">Nature</td><td>${esc(m.nature)}</td><td class="k">Date</td><td>${frDay(m.date)}${m.heure ? ' à ' + esc(m.heure) : ''}</td></tr>
      <tr><td class="k">Adresse</td><td colspan="3">${esc(m.adresse)}</td></tr>
      <tr><td class="k">Durée prévue</td><td>${esc(m.duree || 'N/C')}</td><td class="k">Logement</td><td>${esc(m.type)} – étage ${esc(m.etage || 'N/C')}</td></tr>
      <tr><td class="k">Accès</td><td colspan="3" class="acc">Passage fenêtre / balcon : ${tri(m.fenetre)}<br>Autorisation de stationnement : ${tri(m.stationnement, m.stationnementNote)}</td></tr>
      <tr><td class="k">Objet</td><td colspan="3">${nl(m.objet)}</td></tr>
      ${m.remarque ? `<tr><td class="k">Remarques</td><td colspan="3">${esc(m.remarque)}</td></tr>` : ''}
    </table>
    <h3>DÉTAIL DU PRIX</h3>
    ${priceTable(d, s, t, '')}
    ${payRow(d, t, 'le jour de la prestation')}
    <div class="sigs">
      <div><b>Pour ${esc(s.company)}</b><br>Date : ${frDate(d.date)}${sealHTML()}</div>
      <div><b>Le client</b><br>Date : ____/____/________<br>Mention manuscrite « Bon pour accord » :<br>Signature</div></div>
    <p style="text-align:center;margin:0 0 8px">Merci de votre confiance — DJK Déménagement</p>
    ${footer(s)}</div>`;
}
/* ---------- « Bon pour accord » + signature au stylo (devis uniquement, pas de tampon) ---------- */
// Si une image de signature est enregistrée dans les Réglages, on l'utilise ; sinon une signature manuscrite « DJK » est dessinée.
const penSign = () => {
  const first = esc(String(db.settings.company || 'DJK').split(' ')[0]);
  return db.settings.signature
    ? `<img class="sig" src="${db.settings.signature}" alt="">`
    : `<span class="pen">${first}</span><svg class="penline" viewBox="0 0 130 22" width="130" height="22"><path d="M3 15 C 22 1, 42 21, 66 9 S 108 5, 126 13" fill="none" stroke="#1b2f86" stroke-width="2.3" stroke-linecap="round"/></svg>`;
};
const sealHTML = () => `<div class="seal"><span class="bpa">Bon pour accord</span>${penSign()}</div>`;

// Ligne « paiement » du devis : avec acompte, ou règlement en une fois (entreprises)
const payRow = (d, t, when) => payMode(d) === 'unique'
  ? `<table class="pay"><tr><td>Aucun acompte : règlement en une seule fois le jour de la prestation</td>
      <td style="width:18%"><b>${money(0)}</b></td><td style="width:18%"><b>${money(t.ttc)}</b></td></tr></table>`
  : `<table class="pay"><tr><td>${db.settings.acompte} % à la commande, le solde ${when}<br><small>(Pour les entreprises : bon de commande, règlement à réception de facture)</small></td>
      <td style="width:18%"><b>${money(t.ac)}</b></td><td style="width:18%"><b>${money(t.solde)}</b></td></tr></table>`;

// Ligne de prix de la lettre : toujours HT et TTC. Sans TVA (ou espèces) : TVA non applicable, on reste sur le HT.
function lettrePrice(t) {
  return t.sansTva
    ? `<p><b>Prix HT :</b> ${money(t.ht)} &emsp; <b>TVA :</b> non applicable &emsp; <b>Prix à payer :</b> ${money(t.ttc)}</p>`
    : `<p><b>Prix HT :</b> ${money(t.ht)} &emsp; <b>TVA ${db.settings.tvaRate} % :</b> ${money(t.tva)} &emsp; <b>Prix TTC :</b> ${money(t.ttc)}</p>`;
}
// Paiement en espèces (pas de facture) : règlement, acompte s'il y en a un, solde
function lettrePayCash(t) {
  const ligne1 = `<p><b>Règlement :</b> en espèces (sans facture)</p>`;
  const ligne2 = t.ac > 0
    ? `<p><b>Acompte versé :</b> ${money(t.ac)} &emsp; <b>Solde restant dû :</b> <span class="red">${money(t.solde)}</span></p>`
    : `<p><b>Acompte versé :</b> aucun &emsp; <b>Solde restant dû :</b> <span class="red">${money(t.solde)}</span> (règlement en une fois)</p>`;
  return ligne1 + ligne2;
}
// Trajet hors Île-de-France ? Détecté d'après le code postal des adresses (départements 75, 77, 78, 91, 92, 93, 94, 95).
// Le champ « horsIdf » du formulaire permet de forcer : '' = automatique, 'oui', 'non'.
const IDF_DEPTS = ['75', '77', '78', '91', '92', '93', '94', '95'];
const deptOf = a => { const m = String(a || '').match(/\b(\d{5})\b/); return m ? m[1].slice(0, 2) : null; };
function lettreHorsIdf(l) {
  if (l.horsIdf === 'oui') return true;
  if (l.horsIdf === 'non') return false;
  return [l.from?.adresse, l.to?.adresse].some(a => { const d = deptOf(a); return d && !IDF_DEPTS.includes(d); });
}
// Hors IDF : 2 exemplaires (client + entreprise), 3 cases de signature. Sinon : 1 exemplaire, 2 cases.
function lettreHTML(l) {
  if (!lettreHorsIdf(l)) return lettrePage(l, 'CHARGEMENT ET LIVRAISON', false);
  return lettrePage(l, 'CLIENT', true) + lettrePage(l, 'ENTREPRISE', true);
}
function lettrePage(l, exemplaire, horsIdf) {
  const s = db.settings, t = lettreTotals(l);
  const civTxt = l.civ === 'Société' ? '' : (l.civ || '') + ' ';
  const g = (s.garantieText || '').split('\n').map(x => x.trim()).filter(Boolean);
  const gTitle = g[0] ? g[0].charAt(0).toUpperCase() + g[0].slice(1).toLowerCase() : '';
  const garantie = l.garantie && g.length ? `<p><b>Garantie :</b> ${esc(gTitle)}${g.length > 1 ? ' — ' + esc(g.slice(1).join(' ')) : ''} (taux d'assurance : ${esc(s.taux)} %)</p>` : '';
  const pay = t.cash ? lettrePayCash(t) : t.unique
    ? `<p><b>Acompte versé :</b> ${money(0)} (aucun acompte demandé) &emsp; <b>Solde restant dû :</b> <span class="red">${money(t.solde)}</span> (règlement en une fois le jour de la prestation)</p>`
    : `<p><b>Acompte versé :</b> ${money(t.ac)}${t.custom ? '' : ` (${s.acompte} % de ${money(t.ttc)} TTC)`} &emsp; <b>Solde restant dû :</b> <span class="red">${money(t.solde)}</span></p>`;
  return `<div class="page lv">
    <div class="head">
      <div><img class="logo" src="${logoSrc()}" alt=""><div class="me">${esc(s.address1)} - ${esc(s.address2)}<br>Siret : ${esc(fmtSiret(s.siret))}<br>Tél : ${esc(s.tel)}<br><i>${esc(s.email)}</i></div></div>
      <div class="rt"><span class="t">LETTRE DE VOITURE N° ${esc(l.number)}</span>
        <div class="small">Document obligatoire par arrêté du 09/11/1999</div>
        <div class="b">Exemplaire ${exemplaire}${horsIdf ? ` (${exemplaire === 'CLIENT' ? 1 : 2}/2)` : ''}</div>
        <div class="b">Client : ${civTxt}${esc(l.clientName)}</div>
        ${l.clientSiret ? `<div class="b">Siret client : ${esc(fmtSiret(l.clientSiret))}</div>` : ''}
        <div class="b">Dossier n° : ${esc(l.number)}</div></div>
    </div>
    <hr>
    <div class="info">
      <div>Catégorie : ${esc(l.categorie)}</div><div>Volume (m3) : ${l.volume ? esc(frNum(l.volume)) : '___'}</div><div>Voyage : ${esc(l.voyage)}</div>
      <div>Mode d'exécution : ${esc(l.mode)}</div><div>Distance (km) : ${l.distance !== '' && l.distance != null ? esc(frNum(l.distance)) : '___'}</div><div></div>
    </div>
    <div class="exe"><b>Entreprise exécutante : ${esc(s.company)}</b> &nbsp; Siret : ${esc(fmtSiret(s.siret))}</div>
    <table><tr><th>CHARGEMENT</th><th>LIVRAISON</th></tr>
      <tr><td>Date :<br>${esc(frLong(l.from.periode))}</td><td>Date :<br>${esc(frLong(l.to.periode))}</td></tr>
      <tr><td>Adresse :<br>${esc(l.from.adresse)}</td><td>Adresse :<br>${esc(l.to.adresse)}</td></tr>
      <tr><td>Étage :  ${esc(l.from.etage || 'N/C')}</td><td>Étage :  ${esc(l.to.etage || 'N/C')}</td></tr></table>
    ${garantie}${lettrePrice(t)}${pay}
    <p><b>Véhicule(s) :</b> ${esc(l.vehicules)}</p>
    <p class="lbl">Observations du chef d'équipe au chargement :</p><div class="box">${esc(l.obsChef)}</div>
    <p class="lbl">Remarques du client (réserves, dommages constatés...) :</p><div class="box">${esc(l.remarques)}</div>
    ${horsIdf ? `<div class="sigs3">
      <div><b>SIGNATURE CHARGEMENT</b><br><small><i>Client, à l'enlèvement</i></small></div>
      <div><b>SIGNATURE DÉCHARGEMENT</b><br><small><i>Client, à la livraison</i></small></div>
      <div><b>SIGNATURE DU CHEF D'ÉQUIPE</b><br>${esc(s.company)}<br><small><i>À la fin des travaux</i></small></div>
    </div>` : `<div class="sigs2">
      <div><b>SIGNATURE DU CLIENT</b><br><small><i>Mention manuscrite « bon pour accord »</i></small></div>
      <div><b>SIGNATURE DE L'ENTREPRISE</b><br>${esc(s.company)}<br><small><i>Signature du chef de chantier, à la fin des travaux</i></small></div>
    </div>`}
    ${footer(s)}</div>`;
}

function factureHTML(f) {
  const s = db.settings, t = factTotals(f), sans = !!f.sansTva;
  const rows = f.lines.filter(l => l.title || l.desc || l.pu).map(l => {
    const tot = (Number(l.qty) || 0) * (Number(l.pu) || 0);
    return `<tr><td><b>${esc(l.title)}</b><br><span class="sub">${esc(l.desc)}</span></td><td class="c">${esc(l.qty)}</td><td class="c">${money(l.pu)}</td><td class="c">${money(tot)}</td></tr>`;
  }).join('');
  return `<div class="page fact">
    <div class="top2"><img class="logo" src="${logoSrc()}" alt=""><div class="title">Facture N°${esc(f.number)}</div></div>
    <div class="me"><b>${esc(s.company)}</b><br>${esc(s.address1)}<br>${esc(s.address2)}<br><b>Siret</b> : ${esc(s.siret)}<br><b>N° TVA</b> : ${esc(s.tva)}<br><b>Tél</b> : ${esc(s.tel.replace(/\s/g, ''))}</div>
    <div class="cli"><b>${esc(f.clientName)}</b><br>${esc(f.clientAddress)}${f.type === 'entreprise' && f.clientSiret ? `<br><b>Siret</b> : ${esc(f.clientSiret)}` : ''}</div>
    <div class="box date"><div class="row"><div class="gray">Date de facture</div><div>${frDate(f.date)}</div></div></div>
    <table><tr><th>Description</th><th style="width:15%">Quantité</th><th style="width:22%">Prix unitaire${sans ? '' : ' HT'}</th><th style="width:22%">Prix total${sans ? '' : ' HT'}</th></tr>${rows}</table>
    <div class="bottom">
      <div class="iban">${esc(s.iban)}${s.signature ? `<img src="${s.signature}" alt="">` : ''}</div>
      <div class="box tot">
        ${sans
          ? `<div class="row"><div>TVA</div><div>non applicable</div></div><div class="row b"><div>Total net à payer</div><div>${money(t.ttc)}</div></div>`
          : `<div class="row"><div>Total HT</div><div>${money(t.ht)}</div></div>
        <div class="row"><div>TVA (${Number(s.tvaRate).toFixed(2).replace('.', ',')} %)</div><div>${money(t.tva)}</div></div>
        <div class="row b"><div>Total TTC</div><div>${money(t.ttc)}</div></div>`}${t.acompte > 0 ? `<div class="row"><div>Acompte réglé</div><div>- ${money(t.acompte)}</div></div><div class="row b"><div>Reste à payer</div><div>${money(t.reste)}</div></div>` : ''}</div></div>
    <div class="foot">Merci de votre confiance — DJK Déménagement<br>${esc(s.tagline)}<br>${esc(s.company)}<br>${esc(s.address1)} - ${esc(s.address2)} - tél : ${esc(s.tel)}<br>${esc(s.legal)}</div>
  </div>`;
}

/* =====================================================
   APERÇU ET TÉLÉCHARGEMENT PDF
   ===================================================== */
const fileName = (kind, doc) => {
  const who = (doc.clientName || 'client').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_');
  return `${{ devis: 'Devis', facture: 'Facture', lettre: 'Lettre_de_voiture' }[kind]}_${doc.number.replace(/[^\w-]+/g, '_')}_${who}.pdf`;
};
const buildHTML = (kind, doc) => ({ devis: devisHTML, facture: factureHTML, lettre: lettreHTML }[kind])(doc);
async function pdf(kind, doc) {
  const root = $('#pdfRoot'); root.innerHTML = buildHTML(kind, doc);
  try {
    if (!window.html2canvas || !window.jspdf) throw new Error('libs');
    await Promise.all($$('img', root).map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
    try { await document.fonts.load('600 24px Caveat'); await document.fonts.ready; } catch (e) { /* police manuscrite : on continue sans */ }
    const { jsPDF } = window.jspdf;
    const out = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pages = $$('.page', root);
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, windowWidth: 794,
        onclone: d => { const h = d.getElementById('pdfHide'); if (h) { h.style.left = '0'; h.style.position = 'absolute'; } }
      });
      let w = 210, h = canvas.height / canvas.width * 210;
      if (h > 297) { const f = 297 / h; w *= f; h = 297; }
      if (i > 0) out.addPage();
      out.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', (210 - w) / 2, 0, w, h);
    }
    out.save(fileName(kind, doc));
    toast('PDF téléchargé');
  } catch (e) { console.error(e); toast('Erreur PDF : vérifie ta connexion internet puis recharge la page'); }
  root.innerHTML = '';
}
let modalCtx = null;
function preview(kind, doc) {
  modalCtx = [kind, doc];
  const m = $('#modalDoc'); m.innerHTML = buildHTML(kind, doc);
  m.style.zoom = Math.min(1, (innerWidth - 40) / 794);
  $('#modal').classList.remove('hidden');
}
$('#mClose').onclick = () => $('#modal').classList.add('hidden');
$('#mPdf').onclick = () => pdf(...modalCtx);
$('#dPreview').onclick = () => preview('devis', collectDevis());
$('#fPreview').onclick = () => preview('facture', collectFact());
$('#lPreview').onclick = () => preview('lettre', collectLettre());
$('#lPdf').onclick = () => { const l = saveLettre(true); if (l) pdf('lettre', l); };
$('#dPdf').onclick = () => { const d = saveDevis(true); if (d) pdf('devis', d); };
$('#fPdf').onclick = () => { const f = saveFact(true); if (f) pdf('facture', f); };

/* ---------- Démarrage ---------- */
bindSiret($('#devisForm'), { siret: 'clientSiret', name: 'clientName', address: 'clientAddress' });
bindSiret($('#factForm'), { siret: 'clientSiret', name: 'clientName', address: 'clientAddress' });
bindSiret($('#lettreForm'), { siret: 'clientSiret', name: 'clientName', address: 'clientAddress' });
applyBrand(); refreshClientList(); show('devis');
