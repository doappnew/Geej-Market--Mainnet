# GÉEJ MARKET — Le marché de la mer

Application e-commerce de produits halieutiques (Sénégal), compatible Pi Browser.
**Stack** : React + Vite (PWA) · Express 5 · PostgreSQL · Pi SDK / API Pi côté serveur.
Un seul service sert l'API (`/api`) et le front (`client/dist`).

## Structure

```
geej/
├─ server/
│  ├─ db/schema.sql         22 tables (users, sellers, admins, categories, products, product_images, addresses,
│  │                        carts, cart_items, orders, order_items, order_status_history, deliveries, delivery_zones,
│  │                        regions, departments, payments, pi_transactions, notifications, complaints, audit_logs, settings)
│  ├─ db/seed.js            régions/départements, catégories, admin ; `--demo` = vendeur, client, 7 produits
│  ├─ src/app.js            sécurité (helmet/CSP, rate-limit, CORS), montage des routes, erreurs
│  ├─ src/routes/           auth · catalog · cart · orders (+devis) · me · pay (Pi) · seller · admin
│  ├─ src/lib/              règles produits/quantités, calcul de commande et de livraison
│  ├─ src/pi.js             client API Pi (serveur uniquement)   src/storage.js  photos (disque ou Supabase Storage)
│  └─ test/e2e.test.js      17 tests de bout en bout sur une vraie base PostgreSQL
├─ client/
│  ├─ src/pages/            Accueil, Catégories, Catalogue, Fiche produit, Panier, Commander (4 étapes), Commandes, Compte, Infos
│  ├─ src/seller/           Espace vendeur   src/admin/   Espace administrateur   src/components/  UI partagée
│  ├─ src/pi.js             Pi.init / authenticate / createPayment (aucune simulation)
│  └─ public/               logo.svg, icônes PWA, manifest, service worker, photos de démonstration
└─ render.yaml              déploiement Render
```

## Installation locale

Prérequis : Node 22+, PostgreSQL 14+.

```bash
cp server/.env.example server/.env      # renseigner DATABASE_URL et JWT_SECRET
npm run install:all
createdb geej
npm run db:migrate
ADMIN_PASSWORD='ChoisirUnMotDePasse' npm --prefix server run db:seed -- --demo
npm run build && npm start              # http://localhost:3000
# développement front avec rechargement : npm --prefix client run dev  (proxy vers :3000)
```

Comptes de démonstration (`--demo`, **à ne jamais utiliser en production**) :
`vendeur@geejmarket.sn / Vendeur#2026` · `client@geejmarket.sn / Client#2026` · admin : `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
Sans `--demo`, seuls les référentiels et l'administrateur sont créés. Les produits, prix et stocks de démonstration sont fictifs.

## Tests

```bash
npm test     # crée la base geej_test, applique le schéma, lance l'API et déroule 17 scénarios
```
Couvre : inscription/connexion, rôles, panier (pas de vente, stock), devis et zones de livraison, création de commande
(numéro GJM-AAAA-NNNNNN, stock, historique, notifications), workflow vendeur, isolation entre clients/vendeurs,
prix figés dans les lignes de commande, refus/annulation (stock restitué), multi-vendeurs, upload d'images, réclamations,
suspension immédiate d'un compte, journal d'audit, et le flux Pi complet. Pour le Pi, un **faux serveur Pi local** sert
uniquement de fixture de test ; l'application ne simule rien en fonctionnement normal.

## Règles métier clés

- **Pi est la seule monnaie.** Tous les prix, frais et totaux sont en Pi (π, 7 décimales max). Aucun FCFA, aucun taux de conversion, aucun paiement à la livraison.
- **Commande ≠ paiement.** On peut commander sans compte Pi ; la commande reste « en attente de paiement » (invisible du vendeur) jusqu'à ce que le serveur ait vérifié le paiement Pi (voir plus bas). Un vendeur qui refuse une commande déjà payée déclenche une alerte de remboursement à l'administrateur (le remboursement est effectué puis enregistré à la main : rien n'est simulé).
- **Prix et quantités figés** dans `order_items` ; produit modifié/supprimé ⇒ historique intact.
- **Stock** réservé à la création de la commande, restitué à l'annulation/refus.
- **Livraison** : par vendeur, région (+ commune optionnelle), frais, délai, minimum, domicile/retrait. Zone non desservie ⇒ commande bloquée avec message clair. Panier multi-vendeurs ⇒ une commande par vendeur.
- **Statuts** : en attente de paiement · nouvelle · en attente de confirmation · confirmée · en préparation · prête · en livraison · livrée · annulée — chaque changement est historisé (qui/quand/pourquoi).
- Les pionniers se connectent **uniquement avec leur compte Pi** (bouton sur l'écran d'accueil, obligatoire avant toute action). Aucune connexion par e-mail ni mot de passe, équipe comprise : l'administrateur et les vendeurs se connectent avec leur compte Pi, leur rôle étant attribué par `ADMIN_PI_USERNAMES` et `SELLER_PI_USERNAMES` (noms d'utilisateur Pi séparés par des virgules).

## Intégration Pi Network — ce qui est prêt, ce qu'il faut fournir

Implémenté : `Pi.init`, `Pi.authenticate(['username','payments'])`, vérification du jeton par le serveur (`/v2/me`), création de
paiement avec montant fixé par le serveur, `approve` / `complete` serveur avec contrôles (propriétaire, montant, transaction
vérifiée, idempotence), reprise des paiements incomplets, table `pi_transactions`, historique client, `/validation-key.txt`.

À fournir / faire (rien de cela ne peut être fait à votre place) :
1. Enregistrer l'app dans le **Pi Developer Portal** avec l'URL de production (ex. l'URL Render, ou votre domaine) ; **un domaine propre, pas un `*.pinet.com`**.
2. Vérification de domaine : copier la clé fournie par Pi dans `PI_VALIDATION_KEY` (servie sur `/validation-key.txt`).
3. Générer la **clé API Pi de cette app** → `PI_API_KEY`.
4. Créer le **portefeuille de l'app** (Developer Portal) ; la clé secrète (S…) reste chez vous, jamais dans ce projet ni dans un chat.
5. Saisir les prix des produits et les frais de livraison **en Pi** (aucun taux de conversion n'existe).
6. Tester dans **Pi Browser** (le SDK n'existe pas dans Chrome) ; contrôler la transaction sur le block explorer Mainnet.
7. Version **Mainnet** : application Developer Portal dédiée (réseau Mainnet), URL vérifiée propre à cette version, nouvelle clé API, base de données séparée du Testnet. Le serveur refuse tout paiement dont le réseau n'est pas « Pi Network ».

Limites assumées : pas de remboursement automatique en Pi (l'admin enregistre un remboursement fait hors plateforme) ; montant d'une commande payée en Pi non modifiable après coup (ajustement par support).

## Déploiement (Render + Supabase)

1. **Supabase** : créer un projet ; récupérer la chaîne de connexion Postgres (pooler) → `DATABASE_URL` ; créer un bucket public `product-images` ; clé de service → `SUPABASE_SERVICE_KEY` (serveur uniquement), `SUPABASE_URL`.
2. **Render** : New ▸ Blueprint sur ce dépôt (`render.yaml`) ; renseigner les variables marquées `sync: false`. `JWT_SECRET` est généré. L'application applique le schéma au démarrage (`db:migrate`, idempotent).
3. Désigner l'administrateur : variable `ADMIN_PI_USERNAMES` (son nom d'utilisateur Pi). (ancienne méthode par mot de passe supprimée ; sans `--demo`).
4. Sans Supabase Storage, les photos vont sur disque local : **perdues à chaque déploiement sur Render gratuit**. Configurer Supabase Storage en production.
5. Le plan gratuit Render s'endort (premier chargement ≈ 50 s). Ne jamais confirmer un « Rollback » Render : il restaure d'anciennes variables d'environnement.
6. Sauvegardes : activer les sauvegardes quotidiennes Supabase (plan adapté) ; `pg_dump` régulier recommandé.

## Sécurité

Mots de passe bcrypt (coût 12) · JWT 7 j + `token_version` (changement de mot de passe/suspension ⇒ sessions coupées) · rôle et statut relus en base à chaque requête · validation Zod de toutes les entrées · requêtes SQL paramétrées · helmet + CSP · rate-limit (général et connexion) · limite de taille JSON/images, images ré-encodées (WebP) · isolation vendeur/client testée · journal d'audit (jamais de secrets) · aucune clé dans le front.

## Écarts assumés par rapport aux maquettes

- Pas d'étoiles/avis, pas de minuteur de « réservation du panier », pas de « satisfait ou remboursé » : ces éléments n'existent pas dans le cahier des charges et seraient factices. À ajouter si l'entreprise s'engage réellement dessus.
- Pas de favoris (cœur) : hors cahier des charges.
- La bannière d'accueil et les photos produits viennent de vos maquettes (images illustratives) : **à remplacer par de vraies photos** via l'espace vendeur.

## Reste à faire / non vérifié ici

- Test réel dans Pi Browser avec identifiants Pi (impossible dans cet environnement).
- Envoi d'e-mails/WhatsApp : seules les notifications dans l'application sont actives (liens d'appel/WhatsApp sortants pour le vendeur).
- Supabase Storage : code écrit mais non exécuté ici (pas d'accès réseau).
- Communes : saisie libre (suggestions pour Dakar) ; liste officielle complète à intégrer si besoin.
- Pages CGV / confidentialité : textes modèles à faire valider juridiquement (loi sénégalaise sur les données personnelles).
- Langues : français uniquement (structure prête pour wolof, pulaar, sérère, joola, mandingue via une couche i18n à ajouter).
