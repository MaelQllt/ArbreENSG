// Import d'un CSV (export Google Sheets / Google Forms / Excel) vers { nodes, links }.
//
// Colonnes reconnues (ordre libre, accents et majuscules ignorés) :
//   prenom + nom   (ou une seule colonne "nom complet")
//   promo          année d'entrée, ex. 2024
//   code           optionnel, ex. ING ou LG
//   filiere        optionnel, distincte du code (ex. Carthagéo)
//   parrains       optionnel : un ou plusieurs "Prénom Nom", séparés par , ; | ou retour à la ligne
//   bio            optionnel
// Les fillots se déduisent automatiquement des colonnes "parrains".

const strip = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Clé de rapprochement : mots triés, donc "Dupont Jean", "jean dupont" et "Jean-Dupont" sont équivalents
const nameKey = (s) => strip(s).split(' ').filter(Boolean).sort().join(' ');
const LEGACY_CODES = new Set(['ING', 'LG', 'M']);

function detectDelimiter(text) {
  const header = text.split(/\r?\n/, 1)[0];
  const counts = [',', ';', '\t'].map((d) => [d, header.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else cell += ch;
  }
  pushRow();
  return rows;
}

export function parseStudentsCsv(rawText) {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows = parseRows(text, detectDelimiter(text));
  if (rows.length < 2) throw new Error('Le fichier CSV est vide ou ne contient que l\'en-tête.');

  const headers = rows[0].map(strip);
  const find = (test) => headers.findIndex(test);
  const col = {
    prenom: find((h) => ['prenom', 'first name', 'firstname'].includes(h)),
    nom: find((h) => ['nom', 'nom de famille', 'last name', 'lastname'].includes(h)),
    full: find((h) => ['nom complet', 'nom prenom', 'prenom nom', 'name', 'etudiant', 'eleve'].includes(h)),
    promo: find((h) => h.includes('promo') || h.includes('annee')),
    code: find((h) => h === 'code'),
    filiere: find((h) => h.includes('filiere')),
    parrains: find((h) => h.includes('parrain') || h.includes('marraine')),
    bio: find((h) => h.includes('bio') || h.includes('description')),
  };
  if (col.promo < 0) throw new Error('Colonne "promo" introuvable dans le CSV.');
  if (col.full < 0 && (col.prenom < 0 || col.nom < 0)) {
    throw new Error('Colonnes "prenom" et "nom" (ou "nom complet") introuvables dans le CSV.');
  }

  const cell = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const warnings = [];
  const nodes = [];
  const pending = [];
  const keyToId = new Map();

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = cell(r, col.full) || `${cell(r, col.prenom)} ${cell(r, col.nom)}`.trim();
    const promo = parseInt(cell(r, col.promo).match(/\d{4}/)?.[0], 10);
    if (!name) return warnings.push(`Ligne ${line} : nom manquant, ligne ignorée.`);
    if (!Number.isFinite(promo)) return warnings.push(`Ligne ${line} : promo illisible pour "${name}", ligne ignorée.`);
    const key = nameKey(name);
    if (keyToId.has(key)) return warnings.push(`Ligne ${line} : "${name}" apparaît déjà, doublon ignoré.`);

    const id = `s-${nodes.length}`;
    keyToId.set(key, id);
    const rawCode = cell(r, col.code);
    const rawFiliere = cell(r, col.filiere);
    // Compatibilité avec les anciens CSV qui plaçaient ING/LG/M dans la colonne filiere.
    const legacyCode = col.code < 0 && LEGACY_CODES.has(rawFiliere.toLocaleUpperCase('fr'));
    nodes.push({
      id,
      name,
      promo,
      code: rawCode || (legacyCode ? rawFiliere : undefined),
      filiere: legacyCode ? undefined : rawFiliere || undefined,
      bio: cell(r, col.bio) || undefined,
    });
  pending.push({ id, name, line, parrains: cell(r, col.parrains) });
  });

  const links = [];
  const seen = new Set();
  pending.forEach(({ id, name, line, parrains }) => {
    parrains
      .split(/[|;,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => {
        const pid = keyToId.get(nameKey(p));
        if (!pid) return warnings.push(`Ligne ${line} : "${p}" (parrain/marraine de ${name}) est introuvable.`);
        if (pid === id) return warnings.push(`Ligne ${line} : ${name} est son propre parrain, lien ignoré.`);
        const k = `${pid}>${id}`;
        if (seen.has(k)) return;
        seen.add(k);
        // Une passerelle entre filières peut relier des étudiants arrivés des années différentes.
        links.push({ source: pid, target: id });
      });
  });

  return { data: { nodes, links }, warnings };
}

// Combine la sauvegarde Supabase avec le CSV de référence : les ajouts admin restent,
// tandis que les métadonnées et relations corrigées dans le CSV sont reprises.
export function mergeStudentData(primary, reference) {
  const nodes = primary.nodes.map((node) => ({ ...node }));
  const byName = new Map(nodes.map((node) => [nameKey(node.name), node]));
  let extraIndex = 0;

  reference.nodes.forEach((referenceNode) => {
    const key = nameKey(referenceNode.name);
    const existing = byName.get(key);
    if (existing) {
      ['code', 'filiere', 'bio'].forEach((field) => {
        if (referenceNode[field]) existing[field] = referenceNode[field];
      });
      return;
    }

    const added = { ...referenceNode, id: `reference-${extraIndex++}` };
    nodes.push(added);
    byName.set(key, added);
  });

  const mergedIdFor = (sourceNodes, id) => {
    const original = sourceNodes.find((node) => node.id === id);
    return original ? byName.get(nameKey(original.name))?.id : undefined;
  };
  const seen = new Set();
  const links = [];
  [primary, reference].forEach((dataset) => {
    dataset.links.forEach(({ source, target }) => {
      const sourceId = typeof source === 'object' ? source.id : source;
      const targetId = typeof target === 'object' ? target.id : target;
      const mergedSource = mergedIdFor(dataset.nodes, sourceId);
      const mergedTarget = mergedIdFor(dataset.nodes, targetId);
      if (!mergedSource || !mergedTarget || mergedSource === mergedTarget) return;
      const key = `${mergedSource}>${mergedTarget}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ source: mergedSource, target: mergedTarget });
    });
  });

  return { nodes, links };
}

export function serializeStudentsCsv(data) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const parentsByChild = new Map(data.nodes.map((node) => [node.id, []]));
  data.links.forEach(({ source, target }) => {
    const sourceId = typeof source === 'object' ? source.id : source;
    const targetId = typeof target === 'object' ? target.id : target;
    const parent = byId.get(sourceId);
    const parents = parentsByChild.get(targetId);
    if (parent && parents) parents.push(parent.name);
  });

  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['etudiant', 'promo', 'code', 'filiere', 'parrains'],
    ...data.nodes.map((node) => [
      node.name,
      node.promo,
      node.code ?? '',
      node.filiere ?? '',
      (parentsByChild.get(node.id) ?? []).join('; '),
    ]),
  ];
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}
