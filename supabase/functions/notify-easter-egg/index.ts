import nodemailer from 'npm:nodemailer@^9';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { escapeEmailHtml, renderBrandedEmail } from '../_shared/emailTemplate.ts';
import { nameKey, parseCanonicalCsv } from '../_shared/canonicalCsv.ts';

// Easter egg ENSGdle.
//
// Le front n'embarque que la règle « trois clics consécutifs sur un nœud déjà
// sélectionné, je demande au serveur ». Il ne sait pas *qui* on cherche : la
// comparaison de nom vit dans le secret EASTER_EGG_NAME_KEY. Un lecteur de code
// doit donc tester tous les étudiants pour trouver celui qui répond.
//
// Réponses volontairement indiscernables : `{found:false}` aussi bien pour un
// mauvais décompte que pour un mauvais étudiant, et pour un visiteur déjà servi.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REQUIRED_CLICKS = 3;
const PER_IP_WINDOW = '6 hours';
const PER_IP_MAX = 1;
const GLOBAL_DAILY_MAX = 20;
const RETENTION_DAYS = 180;

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const notFound = () => jsonResponse({ found: false });

const parisDate = (date = new Date()) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'long',
}).format(date);

// Empreinte de l'adresse IP : seule donnée permettant de reconnaître un visiteur
// déjà servi. Jamais stockée en clair, jamais envoyée dans un e-mail.
async function fingerprintIp(request: Request, salt: string) {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const raw = (forwarded.split(',')[0] ?? '').trim() || request.headers.get('cf-connecting-ip') || '';
  if (!raw) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${raw}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isTemporarySmtpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNECTION|ETIMEDOUT|ESOCKET|ECONNRESET|535|450|451|452/.test(message);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Méthode non autorisée.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expectedNameKey = Deno.env.get('EASTER_EGG_NAME_KEY')?.trim().toLowerCase();
  const recipient = Deno.env.get('EASTER_EGG_TO_EMAIL')?.trim();
  const photoUrl = Deno.env.get('EASTER_EGG_PHOTO_URL')?.trim();
  const message = Deno.env.get('EASTER_EGG_TEXT')?.trim();
  const signature = Deno.env.get('EASTER_EGG_SIGNATURE')?.trim();
  const salt = Deno.env.get('EASTER_EGG_IP_SALT')?.trim();
  const host = Deno.env.get('ACCOUNT_ADMIN_SMTP_HOST')?.trim() || 'smtp.gmail.com';
  const port = Number(Deno.env.get('ACCOUNT_ADMIN_SMTP_PORT') || '465');
  const secureValue = Deno.env.get('ACCOUNT_ADMIN_SMTP_SECURE')?.trim().toLowerCase();
  const secure = secureValue ? secureValue !== 'false' : port === 465;
  const user = Deno.env.get('ACCOUNT_ADMIN_SMTP_USER')?.trim();
  const password = Deno.env.get('ACCOUNT_ADMIN_SMTP_PASSWORD');
  const sender = Deno.env.get('ACCOUNT_ADMIN_SMTP_FROM')?.trim() || user;

  if (!supabaseUrl || !serviceKey || !expectedNameKey || !recipient || !photoUrl || !message
    || !signature || !salt || !user || !password || !sender || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Missing Easter egg or email server configuration.');
    return jsonResponse({ error: 'Le service n’est pas configuré.' }, 503);
  }

  let admin: ReturnType<typeof createClient>;
  let ipHash: string | null = null;
  let findingId: number | null = null;
  try {
    const body = await request.json();
    const studentId = typeof body?.studentId === 'string' ? body.studentId : '';
    const clickCount = Number(body?.clickCount);
    if (!studentId || !Number.isInteger(clickCount) || clickCount !== REQUIRED_CLICKS) {
      return jsonResponse({ error: 'Requête invalide.' }, 400);
    }

    admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    ipHash = await fingerprintIp(request, salt);
    if (ipHash) {
      const { count: recentForIp, error: recentError } = await admin
        .from('easter_egg_findings')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
      if (recentError) throw recentError;
      if ((recentForIp ?? 0) >= PER_IP_MAX) return notFound();
    }

    const { count: todayTotal, error: todayError } = await admin
      .from('easter_egg_findings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (todayError) throw todayError;
    if ((todayTotal ?? 0) >= GLOBAL_DAILY_MAX) return notFound();

    const { data: familyData, error: familyError } = await admin
      .from('family_data').select('csv').eq('id', true).single();
    if (familyError) throw familyError;
    const student = parseCanonicalCsv(String(familyData.csv)).nodes
      .find((node) => node.id === studentId);
    if (!student || nameKey(String(student.name)) !== expectedNameKey) return notFound();

    // Journal d'abord : une découverte qui rate l'envoi reste comptée, et le
    // garde-fou anti-spam s'applique même quand le SMTP est en panne.
    const { data: finding, error: insertError } = await admin
      .from('easter_egg_findings')
      .insert({ ip_hash: ipHash ?? 'inconnue' })
      .select('id')
      .single();
    if (insertError) throw insertError;
    findingId = finding.id;

    // Ménage opportuniste : aucun cron n'est requis pour purger les empreintes.
    admin.from('easter_egg_findings')
      .delete()
      .lt('created_at', new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString())
      .then(({ error: purgeError }) => {
        if (purgeError) console.error('[notify-easter-egg] purge failed', purgeError.message);
      });

    const { count: discoveries, error: countError } = await admin
      .from('easter_egg_findings')
      .select('id', { count: 'exact', head: true });
    if (countError) throw countError;
    const total = discoveries ?? 1;
    const ordinal = total === 1 ? 'Première découverte.' : `${total}e découverte.`;

    const transport = nodemailer.createTransport({
      host, port, secure,
      auth: { user, pass: password },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await transport.sendMail({
            from: sender,
            to: recipient,
            subject: 'Quelqu’un a trouvé l’easter egg ENSGdle',
            text: `${ordinal}\n\nTrouvé le ${parisDate()}.`,
            html: renderBrandedEmail({
              preheader: 'Quelqu’un a trouvé l’easter egg ENSGdle.',
              heading: 'Easter egg trouvé',
              content: `<p style="margin:0 0 16px;font-size:17px;line-height:1.6;">Quelqu’un vient de trouver l’easter egg.</p>
                <p style="margin:0 0 16px;font-size:17px;line-height:1.6;">${escapeEmailHtml(ordinal)}</p>
                <p style="margin:0;font-size:17px;line-height:1.6;">Trouvé le ${escapeEmailHtml(parisDate())}.</p>`,
            }),
          });
          break;
        } catch (error) {
          if (attempt === 3 || !isTemporarySmtpError(error)) throw error;
          console.warn(`[notify-easter-egg] SMTP attempt ${attempt} failed, retrying`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    } catch (error) {
      // Le visiteur a gagné : on lui montre quand même son panneau. Seule la
      // notification est perdue, et elle reste journalisée pour être comptée.
      console.error('[notify-easter-egg] send failed', error);
      return jsonResponse({ found: true, photoUrl, text: message, signature, emailed: false });
    } finally {
      transport.close();
    }

    await admin.from('easter_egg_findings')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', findingId);

    return jsonResponse({ found: true, photoUrl, text: message, signature });
  } catch (error) {
    console.error('[notify-easter-egg]', error);
    return jsonResponse({ error: 'Erreur interne.' }, 500);
  }
});
