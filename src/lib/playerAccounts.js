import { getAccountAuthClient } from './supabase';

const MIN_PASSWORD_LENGTH = 8;

export function getPlayerAccountRedirectUrl(accountState) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('account', accountState);
  url.hash = 'jeu';
  return url.toString();
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
  if (/player_profiles|is_player_pseudo_available/i.test(message) && /schema cache|does not exist|could not find/i.test(message)) {
    return 'La base des comptes n’est pas encore installée. Exécute le script supabase/player_accounts.sql dans Supabase.';
  }
  if (/invalid login credentials/i.test(message)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return 'Confirme ton adresse e-mail depuis le lien reçu avant de te connecter.';
  if (/user already registered/i.test(message)) return 'Un compte existe déjà avec cette adresse e-mail. Connecte-toi ou réinitialise ton mot de passe.';
  if (/new password should be different from the old password/i.test(message)) return 'Le nouveau mot de passe doit être différent de l’ancien.';
  if (/password should be at least|weak password/i.test(message)) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (/rate limit/i.test(message)) return 'Trop de tentatives. Attends un peu avant de réessayer.';
  if (/fetch|network/i.test(message)) return 'Connexion impossible à Supabase. Vérifie ta connexion internet et réessaie.';
  return message;
}

export { MIN_PASSWORD_LENGTH };
