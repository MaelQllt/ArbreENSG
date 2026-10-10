import { createClient, type User } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@^9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

type EditableProfile = {
  firstName: string;
  lastName: string;
  pseudo: string;
  arrivalYear: number;
  programCode: string;
  filiere: string;
  bio: string;
};

function parseProfile(value: unknown): EditableProfile | string {
  if (!value || typeof value !== 'object') return 'Les informations du profil sont manquantes.';
  const input = value as Record<string, unknown>;
  const firstName = String(input.firstName ?? '').trim();
  const lastName = String(input.lastName ?? '').trim();
  const pseudo = String(input.pseudo ?? '').trim();
  const arrivalYear = Number(input.arrivalYear);
  const programCode = String(input.programCode ?? '').trim().toUpperCase();
  const filiere = String(input.filiere ?? '').trim();
  const bio = String(input.bio ?? '').trim();
  const maxYear = new Date().getFullYear() + 1;

  if (!firstName || firstName.length > 80) return 'Le prénom doit contenir entre 1 et 80 caractères.';
  if (!lastName || lastName.length > 80) return 'Le nom doit contenir entre 1 et 80 caractères.';
  if (pseudo.length < 2 || pseudo.length > 32 || !/^[\p{L}\p{N} _.-]+$/u.test(pseudo)) {
    return 'Le pseudo doit contenir entre 2 et 32 caractères et utiliser des lettres, chiffres, espaces, points ou tirets.';
  }
  if (!Number.isInteger(arrivalYear) || arrivalYear < 1950 || arrivalYear > maxYear) {
    return `L’année d’arrivée doit être comprise entre 1950 et ${maxYear}.`;
  }
  if (!['ING', 'LG', 'M'].includes(programCode)) return 'Choisis un code parmi ING, LG ou M.';
  if (filiere.length > 100) return 'La filière ne peut pas dépasser 100 caractères.';
  if (bio.length > 280) return 'La bio ne peut pas dépasser 280 caractères.';
  return { firstName, lastName, pseudo, arrivalYear, programCode, filiere, bio };
}

type AccountEmailResult = {
  sent: boolean;
  issue?: 'missing_configuration' | 'smtp_authentication' | 'smtp_connection' | 'smtp_rejected';
};

async function sendAccountNotice(to: string, subject: string, text: string): Promise<AccountEmailResult> {
  const host = Deno.env.get('ACCOUNT_ADMIN_SMTP_HOST')?.trim() || 'smtp.orange.fr';
  const port = Number(Deno.env.get('ACCOUNT_ADMIN_SMTP_PORT') || '465');
  const secureValue = Deno.env.get('ACCOUNT_ADMIN_SMTP_SECURE')?.trim().toLowerCase();
  const secure = secureValue ? secureValue !== 'false' : port === 465;
  const user = Deno.env.get('ACCOUNT_ADMIN_SMTP_USER')?.trim();
  const password = Deno.env.get('ACCOUNT_ADMIN_SMTP_PASSWORD');
  const sender = Deno.env.get('ACCOUNT_ADMIN_SMTP_FROM')?.trim() || user;
  if (!user || !password || !sender || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { sent: false, issue: 'missing_configuration' };
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transport.sendMail({ from: sender, to, subject, text });
    return { sent: true };
  } catch (error) {
    const smtpError = error as { code?: string; responseCode?: number; message?: string };
    const issue: AccountEmailResult['issue'] = smtpError.code === 'EAUTH'
      ? 'smtp_authentication'
      : ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(smtpError.code ?? '')
        ? 'smtp_connection'
        : 'smtp_rejected';
    console.error('[manage-player-accounts] SMTP email failed', smtpError.code ?? 'unknown', smtpError.responseCode ?? '', smtpError.message ?? '');
    return { sent: false, issue };
  } finally {
    transport.close();
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Méthode non autorisée.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'La fonction de gestion des comptes n’est pas configurée.' }, 503);
  }

  const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: 'Connecte-toi comme superadmin pour continuer.' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  const adminUser = authData.user;
  if (authError || !adminUser) return jsonResponse({ error: 'Ta session a expiré. Reconnecte-toi comme superadmin.' }, 401);

  const { data: role, error: roleError } = await service
    .from('superadmins')
    .select('user_id')
    .eq('user_id', adminUser.id)
    .maybeSingle();
  if (roleError) return jsonResponse({ error: 'Impossible de vérifier tes droits superadmin.' }, 503);
  if (!role) return jsonResponse({ error: 'Cette action est réservée aux superadmins.' }, 403);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'La requête est invalide.' }, 400);
  }

  if (body.action === 'list') {
    try {
      const users: User[] = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const { data: profiles, error: profileError } = await service
        .from('player_profiles')
        .select('user_id, first_name, last_name, pseudo, arrival_year, program_code, filiere, bio');
      if (profileError) throw profileError;
      const { data: superadminRows, error: superadminError } = await service
        .from('superadmins')
        .select('user_id');
      if (superadminError) throw superadminError;
      const profileByUserId = new Map();
      for (const profile of profiles ?? []) profileByUserId.set(profile.user_id, profile);
      const superadminIds = new Set((superadminRows ?? []).map((row) => row.user_id));
      const accounts = users.map((user) => {
        const profile = profileByUserId.get(user.id);
        const metadata = user.user_metadata ?? {};
        return {
          userId: user.id,
          email: user.email ?? '',
          emailConfirmed: Boolean(user.email_confirmed_at),
          createdAt: user.created_at,
          isSuperadmin: superadminIds.has(user.id),
          profile: profile ? {
            firstName: profile.first_name,
            lastName: profile.last_name,
            pseudo: profile.pseudo,
            arrivalYear: profile.arrival_year,
            programCode: profile.program_code,
            filiere: profile.filiere ?? '',
            bio: profile.bio ?? '',
          } : {
            firstName: String(metadata.first_name ?? ''),
            lastName: String(metadata.last_name ?? ''),
            pseudo: String(metadata.pseudo ?? ''),
            arrivalYear: Number(metadata.arrival_year) || '',
            programCode: String(metadata.program_code ?? ''),
            filiere: String(metadata.filiere ?? ''),
            bio: String(metadata.bio ?? ''),
          },
          hasProfile: Boolean(profile),
        };
      });
      accounts.sort((a, b) => `${a.profile.pseudo} ${a.email}`.localeCompare(`${b.profile.pseudo} ${b.email}`, 'fr'));
      return jsonResponse({ accounts });
    } catch {
      return jsonResponse({ error: 'Impossible de charger les comptes joueurs.' }, 503);
    }
  }

  const userId = String(body.userId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return jsonResponse({ error: 'Le compte sélectionné est invalide.' }, 400);
  }
  if (userId === adminUser.id && body.action === 'delete') {
    return jsonResponse({ error: 'Tu ne peux pas supprimer le compte superadmin actuellement connecté.' }, 400);
  }

  if (body.action === 'update') {
    const parsedProfile = parseProfile(body.profile);
    if (typeof parsedProfile === 'string') return jsonResponse({ error: parsedProfile }, 400);
    const { data: target, error: targetError } = await service.auth.admin.getUserById(userId);
    if (targetError || !target.user?.email) return jsonResponse({ error: 'Ce compte est introuvable.' }, 404);

    const { error: updateError } = await service.from('player_profiles').upsert({
      user_id: userId,
      first_name: parsedProfile.firstName,
      last_name: parsedProfile.lastName,
      pseudo: parsedProfile.pseudo,
      arrival_year: parsedProfile.arrivalYear,
      program_code: parsedProfile.programCode,
      filiere: parsedProfile.filiere || null,
      bio: parsedProfile.bio || null,
    });
    if (updateError?.code === '23505') return jsonResponse({ error: 'Ce pseudo est déjà utilisé. Choisis-en un autre.' }, 409);
    if (updateError?.code === '23503') {
      return jsonResponse({ error: 'Ce compte joueur n’existe plus dans Supabase Auth. Actualise la liste des comptes puis réessaie.' }, 409);
    }
    if (updateError) return jsonResponse({ error: 'Le profil n’a pas pu être enregistré.' }, 503);

    const emailResult = await sendAccountNotice(
      target.user.email,
      'Ton profil ENSGdle a été mis à jour',
      `Bonjour ${parsedProfile.firstName},\n\nLe profil de ton compte ENSGdle a été mis à jour par un administrateur. Tu peux consulter les informations en te connectant au site.\n\nL’équipe BDE Géodata`,
    );
    return jsonResponse({ updated: true, emailSent: emailResult.sent, emailIssue: emailResult.issue });
  }

  if (body.action === 'delete') {
    const { data: targetRole, error: targetRoleError } = await service
      .from('superadmins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (targetRoleError) return jsonResponse({ error: 'Impossible de vérifier les droits de ce compte.' }, 503);
    if (targetRole) return jsonResponse({ error: 'Les comptes superadmin ne peuvent pas être supprimés depuis ce panneau.' }, 403);
    const { data: target, error: targetError } = await service.auth.admin.getUserById(userId);
    if (targetError || !target.user?.email) return jsonResponse({ error: 'Ce compte est introuvable.' }, 404);
    const { error: deleteError } = await service.auth.admin.deleteUser(userId);
    if (deleteError) return jsonResponse({ error: 'Le compte n’a pas pu être supprimé.' }, 503);
    const emailResult = await sendAccountNotice(
      target.user.email,
      'Ton compte ENSGdle a été supprimé',
      'Bonjour,\n\nTon compte ENSGdle a été supprimé par un administrateur. Les données et statistiques associées à ce compte ont également été supprimées.\n\nSi tu penses qu’il s’agit d’une erreur, contacte le BDE Géodata.',
    );
    return jsonResponse({ deleted: true, emailSent: emailResult.sent, emailIssue: emailResult.issue });
  }

  return jsonResponse({ error: 'Cette action n’est pas reconnue.' }, 400);
});
