# Modèles e-mail ENSGdle

Ces modèles sont à copier dans le tableau de bord Supabase : **Authentication → Emails → Email Templates**.
Choisis le modèle correspondant, colle le HTML dans son champ de contenu, règle le sujet, puis enregistre.

| Fichier | Modèle Supabase | Sujet conseillé |
| --- | --- | --- |
| `auth-confirmation.html` | Confirm signup | Confirme ton adresse e-mail – ENSGdle |
| `auth-invitation.html` | Invite user | Invitation à ENSGdle |
| `auth-magic-link.html` | Magic Link | Connexion à ENSGdle |
| `auth-email-change.html` | Change Email Address | Confirme ta nouvelle adresse e-mail – ENSGdle |
| `auth-recovery.html` | Reset password | Nouveau mot de passe – ENSGdle |
| `auth-reauthentication.html` | Reauthentication | Code de vérification – ENSGdle |

Les modèles utilisent les variables Supabase attendues : `{{ .ConfirmationURL }}` pour les liens, `{{ .Token }}` pour le code de revalidation.
Le motif SVG reprend les courbes topographiques de `TopoBackground`. Les e-mails Edge Functions partagent aussi ce motif via `supabase/functions/_shared/emailTemplate.ts`.
Ils n'utilisent pas d'image de logo externe : le nom ENSGdle reste donc visible même si le client bloque les images.

Les modèles utilisent des styles en ligne et des tableaux pour rester lisibles dans les clients e-mail. La typographie revient à Arial/Helvetica pour éviter de dépendre du chargement de polices web.
