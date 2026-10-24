# Familles ENSG

Arbre des familles parrains/fillots de l'ENSG, avec un jeu (relier deux
étudiants par leurs liens de famille) et un espace d'administration.

Site statique React + Vite, publié sur GitHub Pages ; les données partagées,
les comptes joueurs et les défis figés sont dans Supabase.

## Démarrer

```sh
npm install
cp .env.example .env.local   # puis renseigner les variables Supabase
npm run dev
```

Sans variables Supabase, le site tourne avec la base intégrée
(`src/data/familyWorkbookFallback.json`) et sans comptes.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` | build de production dans `dist/` |
| `npm test` | tests unitaires (Vitest) ; `npm run test:watch` pour les relancer en continu |
| `npm run lint` | vérification du code (ESLint) |

Le déploiement lance le lint et les tests avant le build : un push sur `main`
qui les fait échouer n'est pas mis en ligne.

## Organisation

- `src/App.jsx` : l'application (arbre des familles, recherche, fiches) qui
  ouvre aussi le jeu.
- `src/GamePage.jsx` : le jeu.
- `src/components/` : composants partagés et panneaux d'administration.
- `src/lib/` : logique sans interface (CSV, recherche, promos, lignées, Supabase).
- `admin/` : seconde page HTML qui charge la même application, pour l'accès admin.
- `supabase/` : scripts SQL, fonctions Edge et logique des défis partagée avec le
  navigateur (`functions/_shared/gameChallengeCore.js`).
- `tests/` : tests unitaires.

## Documentation

- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) : mise en service de Supabase,
  comptes joueurs, e-mails, easter egg.
- [GITHUB_PAGES.md](GITHUB_PAGES.md) : publication sur GitHub Pages.
