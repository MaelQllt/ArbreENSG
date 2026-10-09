const apiUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? '';
const SESSION_KEY = 'geodata-superadmin-session';

export function isSupabaseConfigured() {
  return Boolean(apiUrl && anonKey);
}

function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    clearSession();
    return null;
  }
}

async function request(path, { method = 'GET', token, body, prefer } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = text;
  }
  if (!response.ok) {
    const message = typeof result === 'string'
      ? result
      : result?.message ?? result?.msg ?? result?.error_description ?? result?.hint;
    throw new Error(message || `Erreur ${response.status}`);
  }
  return result;
}

async function refreshSession(session) {
  const result = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: session.refresh_token },
  });
  const refreshed = {
    ...session,
    ...result,
    user: result.user ?? session.user,
    expires_at: Math.floor(Date.now() / 1000) + result.expires_in,
  };
  saveSession(refreshed);
  return refreshed;
}

async function ensureFreshSession(session) {
  if (session.expires_at && session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  return refreshSession(session);
}

async function isSuperadmin(session) {
  const rows = await request(
    `/rest/v1/superadmins?select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}`,
    { token: session.access_token }
  );
  return Array.isArray(rows) && rows.some((row) => row.user_id === session.user.id);
}

export async function signInSuperadmin(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Configure VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY pour activer l’administration.');
  const result = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  const session = {
    ...result,
    expires_at: Math.floor(Date.now() / 1000) + result.expires_in,
  };
  saveSession(session);
  let allowed;
  try {
    allowed = await isSuperadmin(session);
  } catch (error) {
    try {
      await signOutSuperadmin(session);
    } catch {
      clearSession();
    }
    throw new Error(`Vérification du rôle impossible : ${error.message}`);
  }
  if (!allowed) {
    await signOutSuperadmin(session);
    throw new Error('Ce compte n’a pas le rôle superadmin.');
  }
  return session;
}

export async function getSuperadminSession() {
  if (!isSupabaseConfigured()) return null;
  let session = readSession();
  if (!session?.access_token || !session?.user?.id) return null;
  try {
    session = await ensureFreshSession(session);
    if (await isSuperadmin(session)) return session;
  } catch {
    // Une session expirée ou révoquée ferme simplement l'interface d'administration.
  }
  clearSession();
  return null;
}

export async function signOutSuperadmin(session = readSession()) {
  try {
    if (session?.access_token && isSupabaseConfigured()) {
      await request('/auth/v1/logout', { method: 'POST', token: session.access_token });
    }
  } finally {
    clearSession();
  }
}

export async function fetchSharedCsv() {
  if (!isSupabaseConfigured()) return null;
  const rows = await request('/rest/v1/family_data?select=csv&id=eq.true&limit=1');
  return rows?.[0]?.csv ?? null;
}

export async function saveSharedCsv(csv, session) {
  if (!isSupabaseConfigured()) throw new Error('La sauvegarde Supabase n’est pas configurée.');
  const activeSession = await ensureFreshSession(session);
  await request('/rest/v1/family_data?on_conflict=id', {
    method: 'POST',
    token: activeSession.access_token,
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: true, csv, updated_at: new Date().toISOString() },
  });
  return activeSession;
}

export async function createFamilyDataVersion(csv, session) {
  if (!isSupabaseConfigured()) throw new Error('La sauvegarde Supabase n’est pas configurée.');
  const activeSession = await ensureFreshSession(session);
  const version = await request('/rest/v1/rpc/archive_family_data_version', {
    method: 'POST',
    token: activeSession.access_token,
    body: { p_csv: csv },
  });
  const versionNumber = Number(Array.isArray(version) ? version[0] : version);
  if (!Number.isInteger(versionNumber) || versionNumber < 2) {
    throw new Error('Supabase n’a pas renvoyé le numéro de la nouvelle version. Vérifie la migration SQL des exports versionnés.');
  }
  return { session: activeSession, version: versionNumber };
}

export async function getGameChallengeArchive(mode, periodKey, promoScope) {
  if (!isSupabaseConfigured()) return null;
  return request('/rest/v1/rpc/get_game_challenge_archive', {
    method: 'POST',
    body: {
      p_mode: mode,
      p_period_key: periodKey,
      p_promo_scope: promoScope,
    },
  });
}

export async function saveGameChallengeArchive(mode, periodKey, promoYears, challenge, graph) {
  if (!isSupabaseConfigured()) return null;
  return request('/rest/v1/rpc/freeze_game_challenge_archive', {
    method: 'POST',
    body: {
      p_mode: mode,
      p_period_key: periodKey,
      p_promo_years: promoYears,
      p_challenge: challenge,
      p_graph: graph,
    },
  });
}
