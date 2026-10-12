import { createClient } from 'npm:@supabase/supabase-js@2';
// @ts-ignore Shared source is plain JavaScript used by both Vite and Deno.
import { buildGameGraph, getChallenge } from '../_shared/gameChallengeCore.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const strip = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameKey = (value: string) => strip(value).split(' ').filter(Boolean).sort().join(' ');
const legacyCodes = new Set(['ING', 'LG', 'M']);

function detectDelimiter(text: string) {
  const header = text.split(/\r?\n/, 1)[0];
  const counts = [',', ';', '\t'].map((delimiter) => [delimiter, header.split(delimiter).length - 1] as const);
  counts.sort((left, right) => right[1] - left[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function parseRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; } else inQuotes = false;
      } else cell += character;
    } else if (character === '"') inQuotes = true;
    else if (character === delimiter) { row.push(cell); cell = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
    } else cell += character;
  }
  pushRow();
  return rows;
}

function parseAffiliations(value: string) {
  const seen = new Set<string>();
  return value.split(/[|;,\n]+/).map((label) => label.trim().toLocaleUpperCase('fr')).filter(Boolean)
    .flatMap((label) => {
      const match = label.match(/^([A-Z][A-Z0-9-]*?)(\d{4}|\d{2})$/);
      if (!match) return [];
      const promo = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
      const key = `${match[1]}-${promo}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ code: match[1], promo }];
    });
}

function parseCanonicalCsv(rawText: string) {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows = parseRows(text, detectDelimiter(text));
  if (rows.length < 2) throw new Error('La base de familles est vide.');
  const headers = rows[0].map(strip);
  const find = (test: (header: string) => boolean) => headers.findIndex(test);
  const columns = {
    first: find((header) => ['prenom', 'first name', 'firstname'].includes(header)),
    last: find((header) => ['nom', 'nom de famille', 'last name', 'lastname'].includes(header)),
    full: find((header) => ['nom complet', 'nom prenom', 'prenom nom', 'name', 'etudiant', 'eleve'].includes(header)),
    promo: find((header) => header.includes('promo') || header.includes('annee')),
    code: find((header) => header === 'code'),
    affiliations: find((header) => header.includes('appartenance') || header.includes('additional affiliation')),
    filiere: find((header) => header.includes('filiere')),
    parents: find((header) => header.includes('parrain') || header.includes('marraine')),
    bio: find((header) => header.includes('bio') || header.includes('description')),
  };
  if (columns.promo < 0 || (columns.full < 0 && (columns.first < 0 || columns.last < 0))) {
    throw new Error('Les colonnes de noms et de promo de la base ne sont pas reconnues.');
  }
  const cell = (row: string[], index: number) => index >= 0 ? (row[index] ?? '').trim() : '';
  const nodes: Record<string, unknown>[] = [];
  const pending: { id: string; name: string; parents: string }[] = [];
  const keyToId = new Map<string, string>();
  rows.slice(1).forEach((row) => {
    const name = cell(row, columns.full) || `${cell(row, columns.first)} ${cell(row, columns.last)}`.trim();
    const promo = Number(cell(row, columns.promo).match(/\d{4}/)?.[0]);
    if (!name || !Number.isFinite(promo)) return;
    const key = nameKey(name);
    if (keyToId.has(key)) return;
    const id = `s-${nodes.length}`;
    keyToId.set(key, id);
    const rawCode = cell(row, columns.code);
    const rawFiliere = cell(row, columns.filiere);
    const legacyCode = columns.code < 0 && legacyCodes.has(rawFiliere.toLocaleUpperCase('fr'));
    const node: Record<string, unknown> = { id, name, promo };
    if (rawCode || legacyCode) node.code = rawCode || rawFiliere;
    if (columns.affiliations >= 0) node.additionalAffiliations = parseAffiliations(cell(row, columns.affiliations));
    if (!legacyCode && rawFiliere) node.filiere = rawFiliere;
    if (cell(row, columns.bio)) node.bio = cell(row, columns.bio);
    nodes.push(node);
    pending.push({ id, name, parents: cell(row, columns.parents) });
  });
  const links: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  pending.forEach(({ id, parents }) => parents.split(/[|;,\n]+/).map((parent) => parent.trim()).filter(Boolean).forEach((parent) => {
    const parentId = keyToId.get(nameKey(parent));
    if (!parentId || parentId === id) return;
    const key = `${parentId}>${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source: parentId, target: id });
  }));
  return { nodes, links };
}

function parisDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Méthode non autorisée.' }, 405);
  try {
    const input = await request.json();
    const mode = input?.mode;
    const periodKey = String(input?.period_key ?? '');
    const requestedYears = input?.promo_years;
    if (!['daily', 'weekly'].includes(mode) || !/^\d{4}-\d{2}-\d{2}$/.test(periodKey)
      || !Array.isArray(requestedYears) || requestedYears.length < 3 || requestedYears.length > 30) {
      return jsonResponse({ error: 'Paramètres de défi invalides.' }, 400);
    }
    const date = new Date(`${periodKey}T12:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== periodKey
      || periodKey < '2026-09-01' || periodKey > parisDateKey()
      || (mode === 'weekly' && date.getUTCDay() !== 1)) {
      return jsonResponse({ error: 'Période de défi invalide.' }, 400);
    }
    const promoYears = [...new Set(requestedYears.map(Number))].sort((left, right) => left - right);
    if (promoYears.length < 3 || promoYears.some((year) => !Number.isInteger(year) || year < 1900 || year > 2200)) {
      return jsonResponse({ error: 'Sélection de promos invalide.' }, 400);
    }
    const promoScope = promoYears.join(',');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Configuration Supabase incomplète.');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: existing, error: lookupError } = await admin.rpc('get_game_challenge_archive', {
      p_mode: mode, p_period_key: periodKey, p_promo_scope: promoScope,
    });
    if (lookupError) throw lookupError;
    if (existing) return jsonResponse(existing);

    const { data: familyData, error: familyError } = await admin.from('family_data').select('csv').eq('id', true).single();
    if (familyError) throw familyError;
    const graph = parseCanonicalCsv(String(familyData.csv));
    const selected = new Set(promoYears);
    const selectedNodes = graph.nodes.filter((node) => selected.has(Number(node.promo)));
    if (selectedNodes.length < 3 || promoYears.some((year) => !graph.nodes.some((node) => Number(node.promo) === year))) {
      return jsonResponse({ error: 'Les promos sélectionnées ne sont plus disponibles.' }, 400);
    }
    const challenge = getChallenge(buildGameGraph(selectedNodes, graph.links), mode, 0, 0, periodKey);
    if (!challenge) return jsonResponse({ error: 'Aucun défi jouable pour ces promos.' }, 422);
    const { data: archived, error: archiveError } = await admin.rpc('freeze_game_challenge_archive', {
      p_mode: mode,
      p_period_key: periodKey,
      p_promo_years: promoYears,
      p_challenge: challenge,
      p_graph: graph,
    });
    if (archiveError) throw archiveError;
    return jsonResponse(archived);
  } catch (error) {
    console.error('[freeze-game-challenge-archive]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Erreur interne.' }, 500);
  }
});
