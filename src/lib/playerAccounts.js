import { getAccountAuthClient } from './supabase';

const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_RECOVERY_KEY = 'geodata-password-recovery';
const PASSWORD_RECOVERY_TTL = 60 * 60 * 1000;

export function getPlayerAccountRedirectUrl(accountState) {
  const publicSiteUrl = String(import.meta.env.VITE_PUBLIC_SITE_URL ?? '').trim();
  const url = new URL(publicSiteUrl || window.location.href, window.location.origin);
  url.search = '';
  url.searchParams.set('account', accountState);
  url.hash = 'jeu';
  return url.toString();
}

export function hasSupabaseAuthCallback() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('code')
    || params.has('error_description')
    || params.has('error_code')
    || /(?:^|[&#])access_token=/.test(window.location.hash);
}

export function markPasswordRecoveryPending() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PASSWORD_RECOVERY_KEY, String(Date.now()));
}

export function hasPendingPasswordRecovery() {
  if (typeof window === 'undefined') return false;
  const value = Number(window.localStorage.getItem(PASSWORD_RECOVERY_KEY));
  if (!Number.isFinite(value) || value <= 0) return false;
  if (Date.now() - value > PASSWORD_RECOVERY_TTL) {
    window.localStorage.removeItem(PASSWORD_RECOVERY_KEY);
    return false;
  }
  return true;
}

export function clearPendingPasswordRecovery() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

export function validatePlayerProfile(profile) {
  const firstName = String(profile.firstName ?? '').trim();
  const lastName = String(profile.lastName ?? '').trim();
  const pseudo = String(profile.pseudo ?? '').trim();
  const arrivalYear = Number(profile.arrivalYear);
  const programCode = String(profile.programCode ?? '').trim().toUpperCase();
  const filiere = String(profile.filiere ?? '').trim();
  const bio = String(profile.bio ?? '').trim();
  const currentYear = new Date().getFullYear();

  if (!firstName || firstName.length > 80) return 'Le prénom doit contenir entre 1 et 80 caractères.';
  if (!lastName || lastName.length > 80) return 'Le nom doit contenir entre 1 et 80 caractères.';
  if (pseudo.length < 2 || pseudo.length > 32) return 'Le pseudo doit contenir entre 2 et 32 caractères.';
  if (!/^[\p{L}\p{N} _.-]+$/u.test(pseudo)) return 'Le pseudo peut contenir des lettres, chiffres, espaces, points, tirets et tirets bas.';
  if (!Number.isInteger(arrivalYear) || arrivalYear < 1950 || arrivalYear > currentYear + 1) {
    return `L’année d’arrivée doit être comprise entre 1950 et ${currentYear + 1}.`;
  }
  if (!['ING', 'LG', 'M'].includes(programCode)) return 'Choisis un code parmi ING, LG ou M.';
  if (filiere.length > 100) return 'La filière ne peut pas dépasser 100 caractères.';
  if (bio.length > 280) return 'La bio ne peut pas dépasser 280 caractères.';

  return null;
}

export async function checkPlayerPseudoAvailability(pseudo) {
  const client = await getAccountAuthClient();
  const { data, error } = await client.rpc('is_player_pseudo_available', {
    p_pseudo: String(pseudo ?? '').trim(),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function savePlayerProfile(userId, profile) {
  const validationError = validatePlayerProfile(profile);
  if (validationError) throw new Error(validationError);

  const client = await getAccountAuthClient();
  const { data: { user: authenticatedUser } = {}, error: authError } = await client.auth.getUser();
  if (authError || !authenticatedUser) {
    throw new Error('Ta session ne correspond plus à un compte actif. Déconnecte-toi puis reconnecte-toi.');
  }
  if (authenticatedUser.id !== userId) {
    throw new Error('Cette session ne correspond pas au compte à enregistrer. Déconnecte-toi puis reconnecte-toi.');
  }

  const { data, error } = await client
    .from('player_profiles')
    .upsert({
      user_id: userId,
      first_name: String(profile.firstName).trim(),
      last_name: String(profile.lastName).trim(),
      pseudo: String(profile.pseudo).trim(),
      arrival_year: Number(profile.arrivalYear),
      program_code: String(profile.programCode).trim().toUpperCase(),
      filiere: String(profile.filiere ?? '').trim() || null,
      bio: String(profile.bio ?? '').trim() || null,
    }, { onConflict: 'user_id' })
    .select('user_id, first_name, last_name, pseudo, arrival_year, program_code, filiere, bio')
    .single();

  if (error?.code === '23505') throw new Error('Ce pseudo est déjà utilisé. Choisis-en un autre.');
  if (error) throw error;
  return data;
}

export async function getPlayerChallengeStats() {
  const client = await getAccountAuthClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.user) return { daily: 0, weekly: 0, points: 0 };

  const { data, error } = await client
    .from('player_challenge_completions')
    .select('mode, points')
    .eq('user_id', session.user.id);
  if (error) throw error;

  const completions = data ?? [];
  const daily = completions.filter(({ mode }) => mode === 'daily').length;
  const weekly = completions.filter(({ mode }) => mode === 'weekly').length;
  const points = completions.reduce((total, completion) => total + Number(completion.points ?? 0), 0);
  return { daily, weekly, points };
}

export async function recordPlayerChallengeCompletion(mode, periodKey, points) {
  if (!['daily', 'weekly'].includes(mode) || !/^\d{4}-\d{2}-\d{2}$/.test(String(periodKey))) return null;
  const basePointOptions = mode === 'daily' ? [5, 10] : [10, 20];
  const hintPenalties = [0, 1, 2, 4];
  if (!basePointOptions.some((basePoints) => hintPenalties.includes(basePoints - points))) return null;
  const client = await getAccountAuthClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.user) return null;

  const { error } = await client.from('player_challenge_completions').insert({
    user_id: session.user.id,
    mode,
    period_key: periodKey,
    points,
  });
  if (error && error.code !== '23505') throw error;
  return getPlayerChallengeStats();
}

export function profileFromAuthMetadata(metadata = {}) {
  return {
    firstName: metadata.first_name ?? '',
    lastName: metadata.last_name ?? '',
    pseudo: metadata.pseudo ?? '',
    arrivalYear: metadata.arrival_year ?? '',
    programCode: metadata.program_code ?? '',
    filiere: metadata.filiere ?? '',
    bio: metadata.bio ?? '',
  };
}

export function accountErrorMessage(error) {
  const message = String(error?.message ?? 'Une erreur est survenue.');
  const secureRetryDelay = message.match(/for security purposes[^.]*?after\s+(\d+)\s+seconds?/i);
  if (secureRetryDelay) {
    const seconds = Number(secureRetryDelay[1]);
    return `Pour des raisons de sécurité, réessaie dans ${seconds} seconde${seconds > 1 ? 's' : ''}.`;
  }
  if (/for security purposes/i.test(message)) return 'Pour des raisons de sécurité, attends un peu avant de réessayer.';
  if (/player_profiles|is_player_pseudo_available/i.test(message) && /schema cache|does not exist|could not find/i.test(message)) {
    return 'La base des comptes n’est pas encore installée. Exécute le script supabase/player_accounts.sql dans Supabase.';
  }
  if (/player_profiles_user_id_fkey|violates foreign key constraint/i.test(message)) {
    return 'Le compte lié à ce profil n’existe plus dans ce projet Supabase. Déconnecte-toi puis reconnecte-toi. Si le problème continue, vérifie que le site utilise le même projet Supabase que l’authentification.';
  }
  if (/invalid login credentials/i.test(message)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return 'Confirme ton adresse e-mail depuis le lien reçu avant de te connecter.';
  if (/user already registered/i.test(message)) return 'Un compte existe déjà avec cette adresse e-mail. Connecte-toi ou réinitialise ton mot de passe.';
  if (/new password should be different from the old password/i.test(message)) return 'Le nouveau mot de passe doit être différent de l’ancien.';
  if (/password should be at least|weak password/i.test(message)) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (/password cannot be empty|password is required/i.test(message)) return 'Saisis un mot de passe.';
  if (/email link is invalid or has expired|token has expired or is invalid|invalid token/i.test(message)) return 'Ce lien a expiré ou n’est plus valide. Demande un nouveau lien par e-mail.';
  if (/pkce code verifier not found|code verifier could not be found/i.test(message)) return 'Ce lien ne peut pas être utilisé depuis cette session. Ouvre-le à nouveau depuis le même navigateur.';
  if (/email rate limit exceeded|over_email_send_rate_limit/i.test(message)) return 'Trop d’e-mails ont été envoyés. Attends un peu avant de réessayer.';
  if (/too many requests|rate limit/i.test(message)) return 'Trop de tentatives. Attends un peu avant de réessayer.';
  if (/unable to validate email address|invalid email/i.test(message)) return 'Cette adresse e-mail n’est pas valide.';
  if (/email address not authorized/i.test(message)) return 'Cette adresse ne peut pas encore recevoir d’e-mails de Supabase.';
  if (/signup is disabled/i.test(message)) return 'La création de compte est momentanément désactivée.';
  if (/error sending (?:the )?(?:confirmation|recovery|password reset) email|failed to send (?:the )?email/i.test(message)) return 'L’e-mail n’a pas pu être envoyé. Vérifie la configuration e-mail puis réessaie.';
  if (/database error saving new user/i.test(message)) return 'Le compte n’a pas pu être créé. Vérifie que le profil est correctement configuré dans Supabase.';
  if (/fetch|network/i.test(message)) return 'Connexion impossible à Supabase. Vérifie ta connexion internet et réessaie.';
  // The auth provider can return new English messages over time. Keep known
  // French application errors intact, and never expose an untranslated
  // provider message to the player.
  if (/[àâçéèêëîïôùûüÿœæ]/i.test(message)
    || /^(?:le\b|la\b|les\b|l['’]|un\b|une\b|ce\b|cette\b|ces\b|ton\b|ta\b|tes\b|tu\b|pour\b|trop\b|impossible\b|choisis\b|saisis\b|compte\b|profil\b|adresse\b|mot de passe\b|erreur\b|configure\b|connecte-toi\b|sélectionne\b)/i.test(message)) {
    return message;
  }
  return 'Une erreur est survenue. Réessaie dans un instant.';
}

export { MIN_PASSWORD_LENGTH };
