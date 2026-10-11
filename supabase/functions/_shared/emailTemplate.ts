const topoLines = [
  ['#ca9a7e', '0.28', '1.41', '-80,336 10,352 100,365 190,372 280,374 370,370 460,364 550,356 640,350 730,344 820,341 910,338 1000,334 1090,328 1180,319 1270,306 1360,292 1450,277 1540,265 1630,258 1680,256'],
  ['#ba8d7b', '0.31', '1.59', '-80,388 10,406 100,419 190,427 280,429 370,425 460,418 550,410 640,403 730,397 820,393 910,390 1000,386 1090,379 1180,370 1270,356 1360,341 1450,325 1540,312 1630,303 1680,301'],
  ['#aa8077', '0.34', '1.76', '-80,440 10,459 100,474 190,482 280,484 370,480 460,473 550,464 640,456 730,450 820,446 910,442 1000,438 1090,431 1180,420 1270,406 1360,389 1450,372 1540,358 1630,349 1680,347'],
  ['#9a7373', '0.36', '1.93', '-80,492 10,513 100,528 190,537 280,539 370,535 460,527 550,518 640,509 730,503 820,498 910,494 1000,490 1090,482 1180,471 1270,456 1360,438 1450,420 1540,405 1630,395 1680,393'],
  ['#8a666f', '0.39', '2.10', '-80,544 10,566 100,582 190,592 280,594 370,589 460,581 550,571 640,562 730,555 820,550 910,547 1000,542 1090,534 1180,522 1270,505 1360,486 1450,467 1540,451 1630,441 1680,438'],
  ['#7b596b', '0.42', '2.27', '-80,597 10,619 100,637 190,647 280,649 370,644 460,635 550,625 640,615 730,608 820,603 910,599 1000,594 1090,585 1180,572 1270,555 1360,535 1450,514 1540,497 1630,487 1680,484'],
  ['#6b4c67', '0.44', '2.44', '-80,650 10,674 100,691 190,701 280,703 370,699 460,689 550,678 640,668 730,661 820,655 910,651 1000,646 1090,637 1180,623 1270,604 1360,583 1450,561 1540,543 1630,532 1680,529'],
  ['#5b3f63', '0.47', '2.61', '-80,702 10,727 100,746 190,757 280,759 370,753 460,744 550,731 640,721 730,713 820,708 910,703 1000,698 1090,688 1180,673 1270,654 1360,631 1450,608 1540,590 1630,579 1680,576'],
  ['#4b3260', '0.50', '2.79', '-80,755 10,781 100,801 190,812 280,814 370,808 460,798 550,785 640,774 730,766 820,760 910,756 1000,750 1090,740 1180,724 1270,703 1360,680 1450,656 1540,637 1630,625 1680,622'],
] as const;

const topoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="76" viewBox="0 240 1680 430" preserveAspectRatio="none" style="display:block;width:100%;height:76px;">${topoLines.map(([color, opacity, width, points]) => `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`).join('')}</svg>`;

export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character));

function studentNodeHtml(name: string, promo: string, role: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#2b317f" style="width:100%;background:#2b317f;border-left:4px solid #fac18a;"><tr><td width="48" valign="middle" align="center" style="width:48px;padding:14px 0 14px 10px;color:#ded41f;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:26px;">◆</td><td valign="middle" style="padding:13px 16px 13px 4px;font-family:Arial,Helvetica,sans-serif;"><p style="margin:0 0 4px;color:#ded41f;font-size:10px;line-height:14px;font-weight:700;letter-spacing:1px;">${role}</p><p style="margin:0;color:#ffffff;font-size:17px;line-height:22px;font-weight:700;word-break:break-word;">${escapeEmailHtml(name)}</p>${promo ? `<p style="margin:3px 0 0;color:#fac18a;font-size:13px;line-height:18px;font-weight:700;">Promo ${escapeEmailHtml(promo)}</p>` : ''}</td></tr></table>`;
}

export function renderAccountNoticeEmail(subject: string, text: string) {
  const paragraphs = text.trim().split(/\n\s*\n/).map((paragraph) =>
    `<p style="margin:0 0 18px;color:#38235b;font-size:15px;line-height:1.65;">${escapeEmailHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`
  ).join('');
  return renderBrandedEmail({
    preheader: 'Information concernant ton compte ENSGdle.',
    heading: subject,
    content: paragraphs,
  });
}

export function renderFamilyLinkRequestEmail({
  childName,
  childPromo = '',
  parentName,
  parentPromo = '',
  message = '',
  sentAt,
  isAdditionalReport = false,
}: {
  childName: string;
  childPromo?: string;
  parentName: string;
  parentPromo?: string;
  message?: string;
  sentAt: string;
  isAdditionalReport?: boolean;
}) {
  const cleanMessage = message.trim();
  const safeChildPromo = /^[12]\d{3}$/.test(childPromo) ? childPromo : '';
  const safeParentPromo = /^[12]\d{3}$/.test(parentPromo) ? parentPromo : '';
  const requestSentence = `Lien proposé : ${parentName}${safeParentPromo ? ` (Promo ${safeParentPromo})` : ''} est le parrain ou la marraine de ${childName}${safeChildPromo ? ` (Promo ${safeChildPromo})` : ''}`;
  const text = [
    ...(isAdditionalReport ? ['Cette relation a déjà été proposée mais peut contenir des informations supplémentaires.', ''] : []),
    requestSentence,
    ...(cleanMessage ? ['', isAdditionalReport ? 'Information complémentaire :' : 'Message ajouté :', cleanMessage] : []),
    '',
    `${isAdditionalReport ? 'Signalement reçu le' : 'Reçue le'} ${sentAt}`,
  ].join('\n');
  const escapedMessage = cleanMessage ? escapeEmailHtml(cleanMessage).replace(/\r?\n/g, '<br>') : '';
  const heading = isAdditionalReport ? 'Information complémentaire sur un lien' : 'Nouvelle proposition de lien';
  const messageBlock = escapedMessage
    ? `<p style="margin:24px 0 7px;color:#8e6f55;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;">${isAdditionalReport ? 'Information complémentaire' : 'Message ajouté'}</p><div style="margin:0;padding:11px 14px;background:#f7f4ef;border-left:3px solid #d7c7b7;color:#776c65;font-size:13px;line-height:1.55;">${escapedMessage}</div>`
    : '';
  const receivedAt = `<p style="margin:16px 0 0;color:#8e6f55;font-size:13px;line-height:1.5;">${isAdditionalReport ? 'Signalement reçu le' : 'Reçue le'} <strong style="color:#38235b;">${escapeEmailHtml(sentAt)}</strong></p>`;
  const content = `${isAdditionalReport ? '<div style="margin:0 0 18px;padding:11px 14px;background:#fff9e8;border-left:3px solid #ded41f;color:#2b317f;font-size:13px;line-height:1.5;">Cette relation a déjà été proposée mais peut contenir des informations supplémentaires.</div>' : ''}<p style="margin:0 0 12px;color:#8e6f55;font-size:13px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">Lien proposé</p>${studentNodeHtml(parentName, safeParentPromo, 'PARRAIN · MARRAINE')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" height="22" style="height:22px;color:#fac18a;font-size:16px;line-height:22px;">│</td></tr></table>${studentNodeHtml(childName, safeChildPromo, 'FILLOT · FILLOTTE')}${messageBlock}${receivedAt}`;

  return {
    text,
    html: renderBrandedEmail({
      preheader: isAdditionalReport
        ? 'Une information complémentaire concerne une proposition de lien déjà reçue.'
        : 'Une nouvelle proposition de lien attend la vérification du BDE.',
      heading,
      content,
    }),
  };
}

export function renderBrandedEmail({
  preheader,
  heading,
  content,
}: {
  preheader: string;
  heading: string;
  content: string;
}) {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeEmailHtml(heading)} – ENSGdle</title>
<style>@media(max-width:620px){.email-container{width:100%!important}.email-px{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:25px!important;line-height:31px!important}}</style></head>
<body style="margin:0;padding:0;background:#eceef6;-webkit-text-size-adjust:100%;font-family:Arial,Helvetica,sans-serif;color:#38235b;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eceef6;">${escapeEmailHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eceef6" style="background:#eceef6;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
        <tr><td class="email-px" bgcolor="#2b317f" style="background:#2b317f;padding:30px 36px 20px;">
          <p style="margin:0;color:#ffffff;font-size:25px;line-height:30px;font-weight:800;letter-spacing:-.4px;">ENSGdle</p>
          <p style="margin:5px 0 0;color:#fac18a;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.8px;">JEU DE PARRAINAGE<svg xmlns="http://www.w3.org/2000/svg" width="22" height="10" viewBox="0 0 18 8" aria-hidden="true" focusable="false" style="display:inline-block;vertical-align:0;margin:0 8px;"><path d="M1 5.5 L5 4 L9 4.7 L13 2.8 L17 3.5" fill="none" stroke="#fac18a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" /></svg>GÉODATA PARIS</p>
          <h1 class="email-title" style="margin:30px 0 0;color:#ded41f;font-size:31px;line-height:38px;font-weight:700;">${escapeEmailHtml(heading)}</h1>
        </td></tr>
        <tr><td bgcolor="#2b317f" style="background:#2b317f;padding:0;">${topoSvg}</td></tr>
        <tr><td class="email-px" style="padding:26px 36px 14px;">${content}</td></tr>
        <tr><td class="email-px" style="padding:16px 36px 26px;border-top:1px solid #dfe0ee;color:#77717a;font-size:12px;line-height:1.6;">Message automatique envoyé par ENSGdle, merci de ne pas répondre à cet e-mail.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
