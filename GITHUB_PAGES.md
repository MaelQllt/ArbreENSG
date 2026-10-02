# Publier le graphe avec GitHub Pages

Le dépôt doit être public pour profiter de GitHub Pages avec GitHub Free.
Le fichier `.env.local` est ignoré par Git : ne le téléverse pas dans le dépôt.

## Configurer le dépôt GitHub

1. Crée un dépôt public sur GitHub.
2. Dans **Settings > Secrets and variables > Actions > Variables**, ajoute :
   - `VITE_SUPABASE_URL` : l'URL du projet Supabase ;
   - `VITE_SUPABASE_PUBLISHABLE_KEY` : sa clé `publishable`.
3. Dans **Settings > Pages**, choisis **GitHub Actions** comme source de publication.
4. Ajoute les fichiers du projet au dépôt et pousse-les sur la branche `main`.

Le workflow `.github/workflows/deploy-pages.yml` construit et publie le site
à chaque mise à jour de `main`. GitHub affiche l'adresse publique dans l'onglet
**Actions** et dans **Settings > Pages**.

Les variables Supabase sont utilisées pendant la compilation du site. La clé
`publishable` est faite pour être utilisée dans le navigateur ; les permissions
de modification restent contrôlées par les règles RLS et le rôle superadmin.
