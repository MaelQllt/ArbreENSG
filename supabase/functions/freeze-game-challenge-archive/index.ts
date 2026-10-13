import { createClient } from 'npm:@supabase/supabase-js@2';
// @ts-ignore Shared source is plain JavaScript used by both Vite and Deno.
import { buildGameGraph, getChallenge } from '../_shared/gameChallengeCore.js';
import { parseCanonicalCsv } from '../_shared/canonicalCsv.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

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
