# Administration superadmin

L'application publique reste consultable par tout le monde. L'accès à l'édition
demande une connexion Supabase, puis la base vérifie le rôle superadmin avec RLS.
La clé publique (`publishable`) utilisée par le navigateur ne peut pas modifier
les données sans ce rôle.

## Mise en service

1. Crée un projet Supabase et active le fournisseur **Email** avec mot de passe.
2. Dans **Authentication > Users**, ajoute ton utilisateur avec ton e-mail et un
   mot de passe, puis copie son UUID.
3. Dans **SQL Editor**, exécute le contenu de `supabase/schema.sql`.
4. Dans le même SQL Editor, exécute la dernière commande du fichier après avoir
   remplacé `REMPLACER_PAR_UUID` par l'UUID copié à l'étape 2.
   Pour un projet qui avait déjà reçu l'ancien `schema.sql`, exécute aussi
   `supabase/versioned_exports.sql` une seule fois afin d'activer les exports versionnés,
   puis `supabase/game_challenge_archives.sql` une seule fois pour figer les défis
   archivés. Sans ce dernier script, l'application fonctionne mais les anciens défis
   sont recalculés à partir du graphe courant au lieu d'être conservés.
5. Depuis **Project Settings > API Keys** (ou le bouton **Connect** du projet),
   copie l'URL du projet et sa clé `publishable`.
6. Dans le dossier du projet, copie `.env.example` en `.env.local`, décommente
   ces deux lignes et colle les valeurs :

   ```env
   VITE_SUPABASE_URL=https://ton-projet.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

7. Redémarre le serveur de développement. En production, ajoute les mêmes
   variables aux paramètres de déploiement puis redéploie.

N'utilise pas une clé `secret` ou `service_role` dans `.env.local` : elle
contournerait les règles d'accès de la base.

## Comptes joueurs

Le menu **Compte** permet à chaque personne de créer son compte avec son adresse
e-mail, son mot de passe, son nom, son prénom, son pseudo, son année d'arrivée et
son code (`ING`, `LG` ou `M`). La bio est facultative. Le pseudo est unique.
La table des profils reste privée ; le classement public ne renvoie que le pseudo,
le prénom, le nom, la promo, la filière et les statistiques affichées dans le profil.
L'adresse e-mail et la bio ne sont jamais exposées dans le classement.
Créer un compte joueur ne donne aucun accès à l'administration ; les droits
superadmin restent attribués séparément dans `public.superadmins`.

Pour activer les comptes sur le projet Supabase :

1. Dans **SQL Editor**, exécute la dernière version de `supabase/player_accounts.sql`.
   Tu peux le relancer après une mise à jour : il crée les tables privées, le
   contrôle d'unicité des pseudos et la fonction sécurisée du classement.
   Si le compte renvoie `permission denied for table player_profiles`, exécute
   aussi `supabase/player_profiles_permissions.sql` dans le SQL Editor.
2. Dans **Authentication > Sign In / Providers > Email**, autorise les nouvelles
   inscriptions. Laisse la confirmation par e-mail activée pour vérifier les
   adresses et réduire les comptes indésirables.
3. Dans **Authentication > URL Configuration**, règle **Site URL** sur l'adresse
   publique du site (par ex. `https://<utilisateur>.github.io/<depot>/`) puis
   ajoute cette même adresse et `http://localhost:5173/**` dans **Redirect URLs**.
   Ajoute le chemin avec `/**` si GitHub Pages le sert dans un sous-dossier.
   Si **Site URL** reste sur `localhost`, les liens reçus par e-mail renvoient
   vers `localhost` même depuis le site publié.
4. Facultatif : dans **Authentication > Email Templates**, personnalise les
   modèles **Confirm signup** et **Reset password** (sujet et contenu du mail).
   Garde la variable `{{ .ConfirmationURL }}` dans le lien : elle est remplacée
   par l'adresse configurée à l'étape 3, avec le jeton de confirmation.
5. Facultatif : pour que les liens générés depuis un serveur local pointent
   quand même vers le site publié, définis `VITE_PUBLIC_SITE_URL` avec l'adresse
   publique (dans `.env.local` en local et dans
   **Settings > Secrets and variables > Actions > Variables** du dépôt).
   Sans cette variable, l'URL du navigateur est utilisée.
6. Les e-mails d'authentification utilisent leur propre SMTP : dans
   **Authentication > Emails > SMTP Settings**, configure `smtp.gmail.com`, le
   port `465`, l'adresse Gmail complète comme identifiant et un mot de passe
   d'application Google (pas le mot de passe normal du compte). Utilise cette
   même adresse comme expéditeur, avec `ENSGdle` comme nom d'expéditeur. Le
   compte Google doit avoir la validation en deux étapes activée pour créer un
   mot de passe d'application.

## Adresse du site et installation PWA

Le dépôt `MaelQllt/ArbreENSG` est un site GitHub Pages de projet. Son adresse est
`https://maelqllt.github.io/ArbreENSG/` ; l'adresse courte
`https://maelqllt.github.io/` correspond à un autre dépôt et renvoie vers la
page 404 de GitHub tant qu'un dépôt `MaelQllt.github.io` n'existe pas. Ouvre
l'adresse complète dans Safari ou Chrome avant d'ajouter ENSGdle à l'écran
d'accueil. Si une ancienne icône ouvre encore la 404, supprime cette icône et
réinstalle-la depuis l'adresse complète.

Pour modifier ou supprimer les comptes depuis le menu superadmin, déploie aussi
`supabase/functions/manage-player-accounts/index.ts` avec la commande
`npx supabase functions deploy manage-player-accounts --project-ref <ref>`.
La fonction envoie les notifications de modification et suppression de compte
avec le SMTP configuré dans les secrets Edge Functions. Dans **Edge Functions >
Secrets**, configure :

- `ACCOUNT_ADMIN_SMTP_HOST` : `smtp.gmail.com`
- `ACCOUNT_ADMIN_SMTP_PORT` : `465`
- `ACCOUNT_ADMIN_SMTP_SECURE` : `true`
- `ACCOUNT_ADMIN_SMTP_USER` : `ensgdle.notifications@gmail.com`
- `ACCOUNT_ADMIN_SMTP_PASSWORD` : le mot de passe d'application Google, sans les espaces d'affichage
- `ACCOUNT_ADMIN_SMTP_FROM` : `ENSGdle <ensgdle.notifications@gmail.com>`

La modification ou suppression du compte est enregistrée même si l'envoi du
mail échoue. Les messages de résultat affichés dans le panneau disparaissent
automatiquement après quelques secondes.

Sans réseau, les inscriptions, connexions, confirmations et changements de mot
de passe ne peuvent pas être effectués. Le compte et son profil restent stockés
dans Supabase et sont retrouvés quand la personne se reconnecte.

Les modifications de l'admin mettent à jour la base active conservée dans
Supabase. Le bouton **Créer et télécharger la base (.xlsx)** archive une nouvelle
version (`v2`, `v3`, etc.), l'active pour le graphe, puis télécharge un classeur
avec un onglet par année de promo. Chaque onglet contient les étudiant·es, leur
code, leur filière et leurs liens de parrainage. Le premier `public/students.csv`
reste inchangé et sert de base initiale ou de secours si Supabase est indisponible.
Le classeur inclut aussi la colonne facultative « Appartenances secondaires »
pour les personnes inscrites dans plusieurs promotions ; la promo la plus récente
reste la promotion principale utilisée pour placer la personne dans le graphe.

Pour reprendre des modifications faites manuellement dans Excel, ouvre l'admin
et utilise **Importer un classeur (.xlsx)**. Le classeur importé devient une
nouvelle version active ; les versions précédentes et le CSV initial sont
conservés. Les onglets doivent garder les colonnes Étudiant·e, Promo, Code,
Filière, Parrains / marraines et Fillots / fillottes du classeur exporté. La
colonne « Appartenances secondaires » est facultative et accepte des codes tels
que `LG23 ; LG21`.

## Notifications e-mail des propositions

Les demandes sont d'abord enregistrées dans la boîte **Requêtes** de l'admin.
Une fonction Supabase envoie ensuite une notification à l'adresse du BDE ; la
demande reste enregistrée même si le fournisseur e-mail est indisponible.

1. Dans **SQL Editor**, exécute `supabase/family_link_requests.sql`. Tu peux
   réexécuter le script après une évolution : ses ajouts sont idempotents.
   Pour une base où ce script a déjà été exécuté, lance aussi
   `supabase/delete_family_link_request.sql` afin d'activer la suppression depuis
   l'admin.
2. Dans **Edge Functions > Secrets**, configure `REQUESTS_TO_EMAIL` avec
   l'adresse de réception du BDE. Le SMTP Gmail utilise les mêmes secrets
   `ACCOUNT_ADMIN_SMTP_*` que les notifications d'administration des comptes.
   Le mot de passe est celui d'application Google, sans les espaces d'affichage.
   `RESEND_API_KEY` et `REQUESTS_FROM_EMAIL` ne sont plus utilisés par cette
   fonction.
3. Déploie `notify-family-link-request` depuis le dossier du projet :
   `npx supabase functions deploy notify-family-link-request --project-ref <ref>`.
   La configuration `verify_jwt = false` est enregistrée dans
   `supabase/config.toml` ; la fonction publique n'accepte qu'un identifiant de
   demande et utilise la clé serveur uniquement pour réclamer une notification
   déjà enregistrée. Le garde-fou limite les notifications à 10 par heure.
4. Une fois le site poussé sur GitHub Pages, envoie une demande d'essai. Tu dois
   recevoir un e-mail à l'adresse de réception configurée.

Les secrets Edge Functions sont partagés par les fonctions du projet et sont
pris en compte immédiatement après leur enregistrement. Une mise à jour de
secret ne nécessite donc pas de redéploiement ; une modification du code de la
fonction, elle, nécessite le déploiement indiqué ci-dessus.

## Easter egg

Le graphe contient un easter egg caché. Le geste : ouvrir la fiche d'un étudiant
dans le graphe, puis cliquer trois fois sur son nœud en moins de 2,5 secondes.
Rien ne se passe si le geste n'est pas complet — ni son, ni animation, ni indice.

1. Dépose la photo dans `public/` sous un nom non devinable (par exemple
   `7c1f4a92e6b3.jpg`).

   Pour tester le geste en développement sans déployer, ajoute dans `.env.local`,
   qui est ignoré par Git :

       VITE_EASTER_EGG_NAME=<Prénom NOM de l'étudiant visé>

   `npm run dev` ouvre alors le panneau sur ce seul étudiant, et sur personne
   d'autre. Cette branche de code disparaît entièrement du build de production,
   comme le nom lui-même : ni le nom, ni la photo, ni le message ne figurent dans
   le JavaScript déployé.
2. Dans **SQL Editor**, exécute `supabase/easter_egg_findings.sql`. Le script est
   idempotent. Aucune policy RLS n'est créée : la table n'est accessible qu'à la
   clé serveur, donc aucun RPC n'est nécessaire.
3. Dans **Edge Functions > Secrets**, configure :

- `EASTER_EGG_NAME_KEY` : la clé de rapprochement de l'étudiant visé, calculée
  comme `src/lib/csv.js` la calcule — minuscules, sans accents ni ponctuation,
  mots séparés par une espace et **triés par ordre alphabétique**. Pour citer un
  exemple qui n'a rien à voir : « Jean Dupont » donne `dupont jean`. Le dépôt Git
  est public : n'écris jamais le nom réel dans ce fichier, uniquement dans le
  secret.
- `EASTER_EGG_TO_EMAIL` : l'adresse qui reçoit la notification.
- `EASTER_EGG_PHOTO_URL` : l'URL publique complète de la photo, servie depuis
  `public/`.
- `EASTER_EGG_TEXT` : le message affiché sous la photo.
- `EASTER_EGG_SIGNATURE` : la signature affichée sous le message.
- `EASTER_EGG_IP_SALT` : une chaîne aléatoire, par exemple
  `openssl rand -hex 32`.

4. Déploie la fonction :
   `npx supabase functions deploy notify-easter-egg --project-ref <ref>`.

Le SMTP est celui configuré pour les autres notifications
(`ACCOUNT_ADMIN_SMTP_*`).

Le garde-fou anti-spam ne concerne que le mail, jamais l'affichage : le panneau
s'ouvre à chaque tentative réussie. Une empreinte salée de l'adresse IP du
visiteur limite donc à une **notification** par heure, et un plafond global de 20
notifications par jour s'applique à tous les visiteurs confondus. Le navigateur
qui a déjà reçu la révélation la conserve pour la session, si bien que les
ouvertures suivantes sont instantanées et sans appel réseau. La fenêtre d'une heure, plutôt que
six, est délibérée : sur le Wi-Fi du campus de nombreux étudiants partagent la
même adresse IP, et un verrou long n'en laisserait qu'un seul/aboutir. Si l'envoi
SMTP échoue, la ligne du visiteur est effacée pour qu'un incident ne le bloque
pas. L'adresse IP n'est jamais
stockée en clair ni mentionnée dans un e-mail ; seule son empreinte est conservée,
et les lignes de plus de six mois sont purgées au passage. La notification ne
contient aucune donnée personnelle : uniquement la date et le numéro de la
découverte.

Pour que la boucle reste discrète, la fonction répond `{ found: false }` de façon
indiscernable pour un mauvais décompte, un mauvais étudiant et un visiteur déjà
servi.
