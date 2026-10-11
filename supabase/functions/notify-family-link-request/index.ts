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

function studentNodeHtml(name: string, promo: string, role: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#2b317f" style="width:100%;background:#2b317f;border-left:4px solid #fac18a;"><tr><td width="48" valign="middle" align="center" style="width:48px;padding:14px 0 14px 10px;color:#ded41f;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:26px;">◆</td><td valign="middle" style="padding:13px 16px 13px 4px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 4px;color:#ded41f;font-size:10px;line-height:14px;font-weight:700;letter-spacing:1px;">${role}</p><p style="margin:0;color:#ffffff;font-size:17px;line-height:22px;font-weight:700;word-break:break-word;">${escapeEmailHtml(name)}</p>${promo ? `<p style="margin:3px 0 0;color:#fac18a;font-size:13px;line-height:18px;font-weight:700;">Promo ${escapeEmailHtml(promo)}</p>` : ''}</td></tr></table>`;
}

const emailPromo = (value: unknown) => {
  const promo = String(value ?? '').trim();
  return /^[12]\d{3}$/.test(promo) ? promo : '';
};

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
  let childPromo = '';
  let parentPromo = '';
  try {
    const body = await request.json();
    const rawId = String(body?.requestId ?? '');
    if (!/^\d+$/.test(rawId)) return jsonResponse({ error: 'Invalid request id.' }, 400);
    requestId = Number(rawId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      return jsonResponse({ error: 'Invalid request id.' }, 400);
    }
    childPromo = emailPromo(body?.childPromo);
    parentPromo = emailPromo(body?.parentPromo);
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
  const requestSentence = `Lien proposé : ${familyRequest.child_name}${childPromo ? ` (Promo ${childPromo})` : ''} est le fillot ou la fillotte de ${familyRequest.parent_name}${parentPromo ? ` (Promo ${parentPromo})` : ''}`;
  const text = [
    requestSentence,
    ...(familyRequest.message?.trim() ? ['', 'Message ajouté :', familyRequest.message.trim()] : []),
    '',
    `Reçue le ${sentAt}`,
  ].join('\n');
  const escapedMessage = familyRequest.message?.trim()
    ? escapeEmailHtml(familyRequest.message.trim()).replace(/\r?\n/g, '<br>')
    : '';
  const html = renderBrandedEmail({
    preheader: 'Une nouvelle proposition de lien familial attend la vérification du BDE.',
    heading: 'Nouvelle proposition de lien familial',
    content: `<p style="margin:0 0 12px;color:#8e6f55;font-size:13px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">Lien proposé</p>${studentNodeHtml(familyRequest.child_name, childPromo, 'FILLOT · FILLOTTE')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" height="22" style="height:22px;color:#fac18a;font-size:16px;line-height:22px;">│</td></tr></table>${studentNodeHtml(familyRequest.parent_name, parentPromo, 'PARRAIN · MARRAINE')}<p style="margin:16px 0 0;color:#8e6f55;font-size:13px;line-height:1.5;">Reçue le <strong style="color:#38235b;">${escapeEmailHtml(sentAt)}</strong></p>${escapedMessage ? `<p style="margin:24px 0 7px;color:#8e6f55;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;">Message ajouté</p><div style="margin:0;padding:11px 14px;background:#f7f4ef;border-left:3px solid #d7c7b7;color:#776c65;font-size:13px;line-height:1.55;">${escapedMessage}</div>` : ''}`,
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
