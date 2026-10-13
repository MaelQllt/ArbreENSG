const apiUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? '';
const SESSION_KEY = 'geodata-superadmin-session';

export function isSupabaseConfigured() {
  return Boolean(apiUrl && anonKey);
}

let accountAuthClientPromise;
const sessionRefreshes = new Map();

export function getAccountAuthClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Les comptes ne sont pas configurés : ajoute les variables Supabase du site.');
  }
  accountAuthClientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(apiUrl, anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
  return accountAuthClientPromise;
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
      : result?.message ?? result?.msg ?? result?.error_description ?? result?.error ?? result?.hint;
    const error = new Error(message || `Erreur ${response.status}`);
    error.status = response.status;
    error.code = result?.code;
    throw error;
  }
  return result;
}

async function refreshSession(session) {
  const refreshToken = session?.refresh_token;
  if (!refreshToken) throw new Error('La session ne contient pas de jeton de renouvellement.');
  const pendingRefresh = sessionRefreshes.get(refreshToken);
  if (pendingRefresh) return pendingRefresh;

  const refreshPromise = (async () => {
    const result = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
    const refreshed = {
      ...session,
      ...result,
      user: result.user ?? session.user,
      expires_at: Math.floor(Date.now() / 1000) + result.expires_in,
    };
    // Only the manually managed superadmin session belongs in sessionStorage.
    if (readSession()?.refresh_token === refreshToken) saveSession(refreshed);
    return refreshed;
  })();
  sessionRefreshes.set(refreshToken, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    if (sessionRefreshes.get(refreshToken) === refreshPromise) sessionRefreshes.delete(refreshToken);
  }
}

async function ensureFreshSession(session) {
  const authClient = await getAccountAuthClient();
  const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
  if (sessionError) throw sessionError;
  const accountSession = sessionData?.session;
  if (accountSession?.user?.id && accountSession.user.id === session?.user?.id) {
    if (accountSession.expires_at && accountSession.expires_at > Math.floor(Date.now() / 1000) + 60) {
      return accountSession;
    }
    const { data, error } = await authClient.auth.refreshSession();
    if (error) throw error;
    if (data.session) return data.session;
  }

  // Migrate an existing pre-unification admin session if one is still around.
  const storedSession = readSession();
  if (storedSession?.user?.id === session?.user?.id
    && storedSession.refresh_token !== session.refresh_token) {
    session = storedSession;
  }
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
  let allowed;
  try {
    allowed = await isSuperadmin(session);
  } catch {
    throw new Error('La vérification des droits superadmin a échoué. Réessaie dans un instant.');
  }
  if (!allowed) {
    throw new Error('Ce compte n’a pas le rôle superadmin.');
  }

  // Keep one Supabase session for both the game account and the graph admin.
  // This also wakes GamePage's auth listener immediately after admin sign-in.
  const authClient = await getAccountAuthClient();
  const { data, error } = await authClient.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error || !data.session) {
    throw new Error('La session superadmin n’a pas pu être ouverte dans le jeu. Réessaie.');
  }
  clearSession();
  return data.session;
}

export async function getSuperadminSession() {
  if (!isSupabaseConfigured()) return null;
  const authClient = await getAccountAuthClient();
  const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
  if (sessionError) return null;
  let session = sessionData?.session ?? null;

  if (session) {
    try {
      if (await isSuperadmin(session)) return session;
    } catch {
      // Try a legacy admin session below if one exists.
    }
  }

  // Bring forward a session created by the previous admin-only storage model.
  const legacySession = readSession();
  if (!legacySession?.access_token || !legacySession?.user?.id) return null;
  try {
    const activeLegacySession = await ensureFreshSession(legacySession);
    const { data, error } = await authClient.auth.setSession({
      access_token: activeLegacySession.access_token,
      refresh_token: activeLegacySession.refresh_token,
    });
    if (error || !data.session) throw error ?? new Error('Session Supabase indisponible.');
    session = data.session;
    clearSession();
  } catch {
    clearSession();
    return null;
  }

  if (!session?.access_token || !session?.user?.id) return null;
  try {
    if (await isSuperadmin(session)) return session;
  } catch {
    // A stale or revoked session simply hides the administration controls.
  }
  return null;
}

export async function signOutSuperadmin(session = readSession()) {
  clearSession();
  if (!isSupabaseConfigured()) return;
  const authClient = await getAccountAuthClient();
  const { data } = await authClient.auth.getSession();
  const currentSession = data?.session;
  if (!currentSession) return;
  if (session?.user?.id && currentSession.user.id !== session.user.id) return;
  const { error } = await authClient.auth.signOut({ scope: 'local' });
  if (error) throw error;
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

export async function saveGameChallengeArchive(mode, periodKey, promoYears) {
  if (!isSupabaseConfigured()) return null;
  return request('/functions/v1/freeze-game-challenge-archive', {
    method: 'POST',
    body: {
      mode,
      period_key: periodKey,
      promo_years: promoYears,
    },
  });
}

export async function submitFamilyLinkRequest({ child, parent, message = '' }) {
  if (!isSupabaseConfigured()) throw new Error('L’envoi des demandes n’est pas configuré.');
  return request('/rest/v1/rpc/submit_family_link_request', {
    method: 'POST',
    body: {
      p_child_id: child.id,
      p_child_name: child.name,
      p_parent_id: parent.id,
      p_parent_name: parent.name,
      p_message: message,
    },
  });
}

export async function notifyFamilyLinkRequestByEmail(requestId, child, parent, reportId = null) {
  if (!isSupabaseConfigured()) throw new Error('L’envoi des demandes n’est pas configuré.');
  return request('/functions/v1/notify-family-link-request', {
    method: 'POST',
    body: reportId ? {
      reportId,
      childPromo: child?.promo,
      parentPromo: parent?.promo,
    } : { requestId, childPromo: child?.promo, parentPromo: parent?.promo },
  });
}

// Easter egg : le client n'envoie qu'un identifiant d'étudiant et un décompte de
// clics. Il ignore totalement qui est visé — c'est la fonction edge qui compare le
// nom à un secret. En développement, la révélation est court-circuitée pour le seul
// étudiant visé, afin de pouvoir tester le geste sans déployer ; la cible vient de
// VITE_EASTER_EGG_NAME, définie dans .env.local et donc absente du dépôt.
// L'ensemble est supprimé du build de production.
const easterEggNameKey = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Une fois le panneau ouvert, le serveur le renvoie autant de fois que nécessaire :
// le garde-fou anti-spam ne concerne que le mail. On garde donc la révélation en
// session pour que les réouvertures suivantes n'aient aucun aller-retour.
const EASTER_EGG_CACHE_KEY = 'geodata-easter-egg';

function readCachedEasterEgg() {
  try {
    const raw = window.sessionStorage.getItem(EASTER_EGG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function revealEasterEgg(studentId, studentName, clickCount) {
  if (import.meta.env.DEV) {
    if (!easterEggNameKey(import.meta.env.VITE_EASTER_EGG_NAME)
      || easterEggNameKey(studentName) !== easterEggNameKey(import.meta.env.VITE_EASTER_EGG_NAME)) {
      return { found: false };
    }
    return {
      found: true,
      photoUrl: '/7c1f4a92e6b3.jpg',
      text: 'Merci à la meilleure famille de l’ENSG, je vous aime.',
      signature: 'Maël',
    };
  }
  if (!isSupabaseConfigured()) throw new Error('L’easter egg n’est pas configuré.');

  const cached = readCachedEasterEgg();
  if (cached) return cached;

  try {
    const result = await request('/functions/v1/notify-easter-egg', {
      method: 'POST',
      body: { studentId, clickCount },
    });
    if (!result?.found) return { found: false };
    const revealed = {
      found: true,
      photoUrl: result.photoUrl,
      text: result.text,
      signature: result.signature,
    };
    try {
      window.sessionStorage.setItem(EASTER_EGG_CACHE_KEY, JSON.stringify(revealed));
    } catch {
      // sessionStorage indisponible (navigation privée) : on retentera.
    }
    return revealed;
  } catch {
    return { found: false };
  }
}

export async function fetchFamilyLinkRequests(session) {
  if (!isSupabaseConfigured()) throw new Error('La sauvegarde Supabase n’est pas configurée.');
  const activeSession = await ensureFreshSession(session);
  const rows = await request('/rest/v1/rpc/list_family_link_requests', {
    method: 'POST',
    token: activeSession.access_token,
    body: {},
  });
  return { session: activeSession, requests: Array.isArray(rows) ? rows : [] };
}

export async function fetchPendingFamilyLinkRequestCount(session) {
  const result = await fetchFamilyLinkRequests(session);
  return {
    session: result.session,
    count: result.requests.filter((request) => request.status === 'pending').length,
  };
}

export async function updateFamilyLinkRequest(requestId, status, session) {
  if (!isSupabaseConfigured()) throw new Error('La sauvegarde Supabase n’est pas configurée.');
  const activeSession = await ensureFreshSession(session);
  const result = await request('/rest/v1/rpc/update_family_link_request', {
    method: 'POST',
    token: activeSession.access_token,
    body: { p_request_id: requestId, p_status: status },
  });
  return { session: activeSession, request: Array.isArray(result) ? result[0] : result };
}

export async function deleteFamilyLinkRequest(requestId, session) {
  if (!isSupabaseConfigured()) throw new Error('La sauvegarde Supabase n’est pas configurée.');
  const activeSession = await ensureFreshSession(session);
  await request('/rest/v1/rpc/delete_family_link_request', {
    method: 'POST',
    token: activeSession.access_token,
    body: { p_request_id: requestId },
  });
  return { session: activeSession };
}

export async function managePlayerAccounts(action, payload = {}, session) {
  if (!isSupabaseConfigured()) throw new Error('La gestion des comptes n’est pas configurée.');
  const isSameUser = (candidate) => candidate?.user?.id && candidate.user.id === session?.user?.id;
  const hasTime = (candidate) => candidate?.expires_at > Math.floor(Date.now() / 1000) + 60;

  // The in-game admin entry can receive the player's Supabase JS session,
  // while the /admin page uses a separately persisted session. Let the SDK
  // refresh its own session so its rotating refresh token stays in sync.
  const getActiveSession = async (forceRefresh = false, previousSession = session) => {
    const storedAdminSession = readSession();
    if (isSameUser(storedAdminSession)) {
      // Another request may already have rotated this token. Reuse that newer
      // copy instead of racing a second refresh with the consumed token.
      if (storedAdminSession.access_token !== previousSession?.access_token && hasTime(storedAdminSession)) {
        return storedAdminSession;
      }
      if (!forceRefresh && hasTime(storedAdminSession)) return storedAdminSession;
      try {
        return await refreshSession(storedAdminSession);
      } catch (refreshError) {
        // If the separate admin refresh token was invalidated, the same user
        // may still have a healthy session managed by Supabase JS.
        try {
          const authClient = await getAccountAuthClient();
          const { data: sessionData } = await authClient.auth.getSession();
          const accountSession = sessionData?.session;
          if (isSameUser(accountSession)) {
            if (!forceRefresh && hasTime(accountSession)) return accountSession;
            const { data, error } = await authClient.auth.refreshSession();
            if (!error && data.session) return data.session;
          }
        } catch {
          // Keep the original refresh error below; it explains why recovery failed.
        }
        throw refreshError;
      }
    }

    const authClient = await getAccountAuthClient();
    const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
    if (sessionError) throw sessionError;
    const accountSession = sessionData?.session;
    if (isSameUser(accountSession)) {
      if (accountSession.access_token !== previousSession?.access_token && hasTime(accountSession)) {
        return accountSession;
      }
      if (!forceRefresh && hasTime(accountSession)) return accountSession;
      const { data, error } = await authClient.auth.refreshSession();
      if (error) throw error;
      if (data.session) return data.session;
    }

    if (!forceRefresh && hasTime(previousSession)) return previousSession;
    return refreshSession(previousSession);
  };

  const invoke = (activeSession) => request('/functions/v1/manage-player-accounts', {
    method: 'POST',
    token: activeSession.access_token,
    body: { action, ...payload },
  });

  let activeSession = await getActiveSession();
  let result;
  try {
    result = await invoke(activeSession);
  } catch (error) {
    if (Number(error?.status) !== 401) throw error;
    try {
      activeSession = await getActiveSession(true, activeSession);
      result = await invoke(activeSession);
    } catch (retryError) {
      // Leave the panel with one actionable session error instead of repeating
      // the same failed request on the stale access token.
      if (Number(retryError?.status) === 401 || /invalid refresh token|refresh token.*(?:not found|invalid)/i.test(String(retryError?.message ?? ''))) {
        const sessionError = new Error('La session superadmin n’est plus valide. Reconnecte-toi puis rouvre l’administration.');
        sessionError.status = 401;
        throw sessionError;
      }
      throw retryError;
    }
  }
  return { session: activeSession, ...result };
}
