import nodemailer from 'npm:nodemailer@^9';
import { renderStudentAdditionRequestEmail } from '../_shared/emailTemplate.ts';

// Prévient le BDE par e-mail d'une proposition « Une personne manque ».
// Même configuration SMTP et même limite horaire que notify-family-link-request.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

async function callDatabaseRpc<T>(name: string, args: Record<string, unknown>, serviceKey: string): Promise<T> {
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const responseText = await response.text();
  let result: unknown = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch {
    result = responseText;
  }
  if (!response.ok) {
    console.error(`Database RPC ${name} failed with ${response.status}`);
    throw new Error(`Database RPC ${name} failed`);
  }
  return result as T;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const recipient = Deno.env.get('REQUESTS_TO_EMAIL');
  const host = Deno.env.get('ACCOUNT_ADMIN_SMTP_HOST')?.trim() || 'smtp.gmail.com';
  const port = Number(Deno.env.get('ACCOUNT_ADMIN_SMTP_PORT') || '465');
  const secureValue = Deno.env.get('ACCOUNT_ADMIN_SMTP_SECURE')?.trim().toLowerCase();
  const secure = secureValue ? secureValue !== 'false' : port === 465;
  const user = Deno.env.get('ACCOUNT_ADMIN_SMTP_USER')?.trim();
  const password = Deno.env.get('ACCOUNT_ADMIN_SMTP_PASSWORD');
  const sender = Deno.env.get('ACCOUNT_ADMIN_SMTP_FROM')?.trim() || user;
  if (!serviceKey || !supabaseUrl || !recipient || !user || !password || !sender
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Missing email or Supabase server configuration.');
    return jsonResponse({ error: 'Email service is not configured.' }, 503);
  }

  let requestId: number;
  try {
    const body = await request.json();
    const rawRequestId = String(body?.requestId ?? '');
    if (!/^\d+$/.test(rawRequestId)) return jsonResponse({ error: 'Invalid request id.' }, 400);
    requestId = Number(rawRequestId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      return jsonResponse({ error: 'Invalid request id.' }, 400);
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  // Tout le contenu de l'e-mail vient de la base, jamais du navigateur.
  let additionRequest: {
    id: number;
    first_name: string;
    last_name: string;
    promo: number;
    code: string;
    parent_name: string | null;
    message: string;
    created_at: string;
  } | null;
  try {
    additionRequest = await callDatabaseRpc(
      'claim_student_addition_request_email',
      { p_request_id: requestId },
      serviceKey,
    );
  } catch {
    return jsonResponse({ error: 'Could not prepare the email notification.' }, 503);
  }

  if (!additionRequest) {
    return jsonResponse({ sent: false, reason: 'already-sent-or-not-found' });
  }

  const sentAt = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(additionRequest.created_at));
  const { html, text } = renderStudentAdditionRequestEmail({
    name: `${additionRequest.first_name} ${additionRequest.last_name}`,
    promo: String(additionRequest.promo),
    code: additionRequest.code,
    parentName: additionRequest.parent_name ?? '',
    message: additionRequest.message,
    sentAt,
  });

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
    await transport.sendMail({
      from: sender,
      to: recipient,
      subject: 'Une personne manque dans l’arbre',
      text,
      html,
    });
  } catch (error) {
    const smtpError = error as { code?: string; responseCode?: number; message?: string };
    console.error('[notify-student-addition-request] SMTP email failed', smtpError.code ?? 'unknown', smtpError.responseCode ?? '', smtpError.message ?? '');
    await callDatabaseRpc('release_student_addition_request_email', { p_request_id: requestId }, serviceKey).catch(() => null);
    return jsonResponse({ error: 'Could not send the email notification.' }, 502);
  } finally {
    transport.close();
  }

  try {
    await callDatabaseRpc('mark_student_addition_request_email_sent', { p_request_id: requestId }, serviceKey);
  } catch {
    console.error(`Email sent, but request ${requestId} could not be marked as notified.`);
  }

  return jsonResponse({ sent: true });
});
