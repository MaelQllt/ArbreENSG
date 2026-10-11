import nodemailer from 'npm:nodemailer@^9';
import { renderFamilyLinkRequestEmail } from '../_shared/emailTemplate.ts';

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

  let requestId: number | null = null;
  let reportId: number | null = null;
  let childPromo = '';
  let parentPromo = '';
  try {
    const body = await request.json();
    if (body?.reportId !== undefined && body?.reportId !== null) {
      const rawReportId = String(body.reportId);
      if (!/^\d+$/.test(rawReportId)) return jsonResponse({ error: 'Invalid report id.' }, 400);
      reportId = Number(rawReportId);
      if (!Number.isSafeInteger(reportId) || reportId <= 0) {
        return jsonResponse({ error: 'Invalid report id.' }, 400);
      }
    } else {
      const rawRequestId = String(body?.requestId ?? '');
      if (!/^\d+$/.test(rawRequestId)) return jsonResponse({ error: 'Invalid request id.' }, 400);
      requestId = Number(rawRequestId);
      if (!Number.isSafeInteger(requestId) || requestId <= 0) {
        return jsonResponse({ error: 'Invalid request id.' }, 400);
      }
    }
    childPromo = String(body?.childPromo ?? '').trim();
    parentPromo = String(body?.parentPromo ?? '').trim();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  let familyRequest: {
    id: number;
    request_id?: number;
    child_name: string;
    parent_name: string;
    message: string;
    created_at: string;
  } | null;
  try {
    familyRequest = reportId
      ? await callDatabaseRpc(
        'claim_family_link_request_report_email',
        { p_report_id: reportId },
        serviceKey,
      )
      : await callDatabaseRpc(
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
  const { html, text } = renderFamilyLinkRequestEmail({
    childName: familyRequest.child_name,
    childPromo,
    parentName: familyRequest.parent_name,
    parentPromo,
    message: familyRequest.message,
    sentAt,
    isAdditionalReport: reportId !== null,
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
      subject: reportId !== null
        ? 'Information complémentaire sur un lien proposé'
        : 'Nouvelle proposition de lien',
      text,
      html,
    });
  } catch (error) {
    const smtpError = error as { code?: string; responseCode?: number; message?: string };
    console.error('[notify-family-link-request] SMTP email failed', smtpError.code ?? 'unknown', smtpError.responseCode ?? '', smtpError.message ?? '');
    if (reportId !== null) {
      await callDatabaseRpc('release_family_link_request_report_email', { p_report_id: reportId }, serviceKey).catch(() => null);
    } else if (requestId !== null) {
      await callDatabaseRpc('release_family_link_request_email', { p_request_id: requestId }, serviceKey).catch(() => null);
    }
    return jsonResponse({ error: 'Could not send the email notification.' }, 502);
  } finally {
    transport.close();
  }

  try {
    if (reportId !== null) {
      await callDatabaseRpc('mark_family_link_request_report_email_sent', { p_report_id: reportId }, serviceKey);
    } else if (requestId !== null) {
      await callDatabaseRpc('mark_family_link_request_email_sent', { p_request_id: requestId }, serviceKey);
    }
  } catch {
    console.error(`Email sent, but ${reportId !== null ? 'report' : 'request'} ${reportId ?? requestId} could not be marked as notified.`);
  }

  return jsonResponse({ sent: true });
});
