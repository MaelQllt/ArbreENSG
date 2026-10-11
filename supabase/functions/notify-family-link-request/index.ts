import nodemailer from 'npm:nodemailer@^9';
import { escapeEmailHtml, renderBrandedEmail } from '../_shared/emailTemplate.ts';

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
    const rawId = String(body?.requestId ?? '');
    if (!/^\d+$/.test(rawId)) return jsonResponse({ error: 'Invalid request id.' }, 400);
    requestId = Number(rawId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      return jsonResponse({ error: 'Invalid request id.' }, 400);
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  let familyRequest: {
    id: number;
    child_name: string;
    parent_name: string;
    message: string;
    created_at: string;
  } | null;
  try {
    familyRequest = await callDatabaseRpc(
      'claim_family_link_request_email',
      { p_request_id: requestId },
      serviceKey,
    );
  } catch {
    return jsonResponse({ error: 'Could not prepare the email notification.' }, 503);
  }

  if (!familyRequest) {
    return jsonResponse({ sent: false, reason: 'already-sent-or-not-found' });
  }

  const sentAt = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(familyRequest.created_at));
  const text = [
    ...(familyRequest.message?.trim() ? [familyRequest.message.trim()] : []),
    `Nouvelle proposition de lien familial : ${familyRequest.child_name} est le fillot ou la fillotte de ${familyRequest.parent_name}`,
    '',
    `Reçue le ${sentAt}`,
  ].join('\n');
  const requestSentence = `Nouvelle proposition de lien familial : ${familyRequest.child_name} est le fillot ou la fillotte de ${familyRequest.parent_name}`;
  const escapedMessage = familyRequest.message?.trim()
    ? escapeEmailHtml(familyRequest.message.trim()).replace(/\r?\n/g, '<br>')
    : '';
  const html = renderBrandedEmail({
    preheader: 'Une nouvelle proposition de lien familial attend la vérification du BDE.',
    heading: 'Nouvelle proposition de lien familial',
    content: `${escapedMessage ? `<p style="margin:0 0 8px;color:#8e6f55;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Message ajouté</p><div style="margin:0 0 24px;padding:15px 18px;background:#fff9e8;border-left:4px solid #fac18a;color:#38235b;font-size:15px;line-height:1.6;">${escapedMessage}</div>` : ''}<p style="margin:0 0 10px;color:#8e6f55;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Lien proposé</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f2bc" style="background:#f4f2bc;border-left:5px solid #ded41f;"><tr><td style="padding:19px 20px;color:#2b317f;font-size:17px;line-height:1.55;">${escapeEmailHtml(requestSentence)}</td></tr></table><p style="margin:20px 0 0;color:#8e6f55;font-size:14px;line-height:1.5;">Reçue le <strong style="color:#38235b;">${escapeEmailHtml(sentAt)}</strong></p>`,
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
      subject: 'Nouvelle proposition de lien familial',
      text,
      html,
    });
  } catch (error) {
    const smtpError = error as { code?: string; responseCode?: number; message?: string };
    console.error('[notify-family-link-request] SMTP email failed', smtpError.code ?? 'unknown', smtpError.responseCode ?? '', smtpError.message ?? '');
    await callDatabaseRpc('release_family_link_request_email', { p_request_id: requestId }, serviceKey).catch(() => null);
    return jsonResponse({ error: 'Could not send the email notification.' }, 502);
  } finally {
    transport.close();
  }

  try {
    await callDatabaseRpc('mark_family_link_request_email_sent', { p_request_id: requestId }, serviceKey);
  } catch {
    console.error(`Email sent, but request ${requestId} could not be marked as notified.`);
  }

  return jsonResponse({ sent: true });
});
