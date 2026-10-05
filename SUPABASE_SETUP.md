# Administration superadmin

L'application publique reste consultable par tout le monde. L'accès à l'édition
demande une connexion Supabase, puis la base vérifie le rôle superadmin avec RLS.
La clé publique (`publishable`) utilisée par le navigateur ne peut pas modifier
les données sans ce rôle.

## Mise en service

1. Crée un projet Supabase et active la connexion par e-mail et mot de passe.
   La création de comptes reste désactivée dans l'application.
2. Dans **Authentication > Users**, ajoute ton utilisateur avec ton e-mail et un
   mot de passe, puis copie son UUID.
3. Dans **SQL Editor**, exécute le contenu de `supabase/schema.sql`.
4. Dans le même SQL Editor, exécute la dernière commande du fichier après avoir
   remplacé `REMPLACER_PAR_UUID` par l'UUID copié à l'étape 2.
   Pour un projet qui avait déjà reçu l'ancien `schema.sql`, exécute aussi
   `supabase/versioned_exports.sql` une seule fois afin d'activer les exports versionnés.
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
