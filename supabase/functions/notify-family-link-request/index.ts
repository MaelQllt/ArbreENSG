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

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const recipient = Deno.env.get('REQUESTS_TO_EMAIL');
  if (!resendKey || !serviceKey || !supabaseUrl || !recipient) {
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

  const sender = Deno.env.get('REQUESTS_FROM_EMAIL') ?? 'Familles ENSG <onboarding@resend.dev>';
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

  let resendResponse: Response;
  try {
    resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `family-link-request-${requestId}`,
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: 'Nouvelle proposition de lien familial',
        text,
      }),
    });
  } catch {
    await callDatabaseRpc('release_family_link_request_email', { p_request_id: requestId }, serviceKey).catch(() => null);
    return jsonResponse({ error: 'Could not contact the email provider.' }, 502);
  }

  if (!resendResponse.ok) {
    console.error(`Resend rejected the notification with ${resendResponse.status}`);
    await callDatabaseRpc('release_family_link_request_email', { p_request_id: requestId }, serviceKey).catch(() => null);
    return jsonResponse({ error: 'The email provider rejected the notification.' }, 502);
  }

  try {
    await callDatabaseRpc('mark_family_link_request_email_sent', { p_request_id: requestId }, serviceKey);
  } catch {
    // Resend's idempotency key prevents duplicate delivery if the client retries.
    console.error(`Email sent, but request ${requestId} could not be marked as notified.`);
  }

  return jsonResponse({ sent: true });
});
