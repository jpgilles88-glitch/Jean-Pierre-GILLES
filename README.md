# LE MARCHÉ D’HERBLAY — V6 mobile synchronisée

Site public et interface **Gestion V6 Mobile**, conçus pour fonctionner sur le même site Netlify. Aucun catalogue fictif n’est chargé. Le dépôt initial était vide : l’interface adopte une identité verte et jaune, sans anciens fichiers graphiques à reprendre.

## Fonctionnement

- Catalogue responsive : trois produits par ligne sur ordinateur, deux sur petit écran. Recherche et treize familles. Une photo manquante est signalée par du texte, sans image de substitution.
- Gestion sur `/#gestion` : connexion, ajout, modification, suppression avec confirmation, photo depuis la photothèque ou l’appareil photo du téléphone, achats HT, ventes TTC, TVA, stock et conditionnement.
- Familles : fruits, légumes, pommes de terre, oignons, boucherie, crèmerie, surgelé, poissonnerie, épicerie, boissons, produits en promotion, produits de saison, déstockage.
- Types de vente : colis, sac, kilo, pièce, plateau, pack. Le stock et le panier comptent des **unités de vente entières**. Pour le kilo, une unité correspond à 1 kg ; renseigner le poids / quantité. Une commande de deux sacs réserve deux sacs, pas deux kilos.
- Marge = `(vente TTC / (1 + TVA / 100) − achat HT) / (vente TTC / (1 + TVA / 100)) × 100`. Alerte sous 30 %, sauvegarde autorisée. La TVA est réglable par produit, avec 5,5 % comme valeur initiale à vérifier selon sa nature.
- Click & Collect uniquement, paiement au retrait. Créneaux entre 8h et 20h inclus, toutes les 30 minutes, au moins deux heures après la validation, sur les sept prochains jours. Le serveur vérifie l’heure **Europe/Paris**, indépendamment du fuseau du téléphone. Le dernier retrait est à 20h.
- Commande enregistrée avec référence affichée à conserver ; suivi « à préparer », « prête », « retirée » dans la gestion. Aucun paiement en ligne ni email automatique. Les produits commandés et leurs prix sont conservés dans la commande même après suppression du produit.

## Stockage et synchronisation

La fonction `netlify/functions/api.mjs` utilise le magasin **site-wide** Netlify Blobs `herblay-v6` : le catalogue et les commandes dans `state`, les JPEG dans `photo/<uuid>`. Les données persistent entre les déploiements du **même site Netlify**. Elles ne sont pas stockées uniquement sur le téléphone. Le panier seul reste dans le stockage local du navigateur.

Les lectures sont en cohérence forte. Les écritures conditionnelles par ETag empêchent une modification simultanée d’écraser des données ou deux commandes de réserver le même dernier article. Catalogue, commande et décrément de stock sont écrits ensemble dans le même document. En cas de conflit, l’interface demande d’actualiser et de recommencer. Un formulaire déjà ouvert conserve la version du catalogue qu’il modifie pour détecter les conflits.

L’interface actualise les données toutes les **10 secondes** lorsqu’elle est visible, au retour sur la fenêtre, au retour du réseau et après chaque modification. Ce mécanisme nécessite une connexion Internet ; il ne permet pas de modifier le catalogue hors connexion. Les réponses API ne sont pas mises en cache. Les achats HT et la TVA ne sont jamais renvoyés dans le catalogue public.

Les photos sont redimensionnées à 1 400 px maximum et converties en JPEG dans le navigateur (2 Mo maximum après conversion). Les photos HEIC nécessitent un navigateur capable de les décoder ; sinon utiliser une photo JPEG. Le code administrateur reste côté serveur : cookie signé HttpOnly, Secure et SameSite Strict, valable huit heures. Dix essais de connexion au maximum par adresse IP sur quinze minutes. Changer le code invalide les sessions existantes.

## Développement local

Prérequis : Node.js 22 ou supérieur et npm.

```sh
npm ci
cp .env.example .env
# Remplacer la valeur d’exemple de HERBLAY_ADMIN_CODE dans .env.
npm run dev
```

Le serveur local écoute sur le port 8888. Le stockage de développement est dans `.netlify/herblay`, ignoré par Git. Il est distinct des données de production. Le serveur utilise le véritable SDK et l’émulateur officiel de Netlify Blobs. Un adaptateur local compense l’absence d’ETag dans les réponses GET de l’émulateur 10.7.13, en récupérant ses métadonnées LIST ; cet adaptateur n’est jamais utilisé en production. Les tests de concurrence utilisent un magasin atomique de test, car les écritures de l’émulateur local ne sont pas une garantie de concurrence distribuée.

Chaque tâche cloud est déjà isolée : utiliser le checkout existant, sans créer de worktree sauf demande explicite.

## Vérifications

```sh
npm test
npm run build
npm run check:function
npm run test:e2e
```

Les tests métier couvrent validation, marge, confidentialité des coûts, stocks, délais et changements d’heure. Les tests API exécutent le CRUD, les sessions, les conflits, les commandes et la persistance avec le SDK Blobs et son serveur local. Un test de concurrence vérifie le refus d’une seconde réservation du dernier article.

Playwright utilise Chromium installé dans `/usr/bin/chromium`, ou le chemin défini par `CHROMIUM_PATH`. Sur une autre machine : installer Chromium et définir ce chemin, ou installer le navigateur Playwright et adapter `executablePath` dans `playwright.config.js`. Le parcours navigateur teste la gestion en émulation iPhone (390 × 844), l’import d’un vrai JPEG, la modification des deux prix, la synchronisation sans rechargement avec un autre navigateur, la commande, le stock et la suppression. Les captures et les données de test sont ignorées par Git. L’émulation Chromium ne remplace pas un essai sur un iPhone physique avec Safari.

## Relier le dépôt au site Netlify EXISTANT eloquent-crisp-f348bb

1. Envoyer le commit de la branche principale sur GitHub si ce n’est pas déjà fait :

   ```sh
   git push -u origin main
   ```

2. Ouvrir **le site existant**, pas « Add new project » :
   `https://app.netlify.com/sites/eloquent-crisp-f348bb`
   (Netlify peut rediriger cette adresse vers son interface « projects ».) Vérifier que le nom affiché est bien `eloquent-crisp-f348bb`.
3. Dans **Project configuration** (ou **Site configuration**) → **Build & deploy** → **Continuous deployment** → **Repository**, cliquer sur **Link repository**. Si un dépôt est déjà lié, utiliser **Manage repository** → **Link to a different repository**. Choisir GitHub, autoriser l’accès à ce seul dépôt si nécessaire, puis sélectionner `jpgilles88-glitch/Jean-Pierre-GILLES` et la branche `main`.
4. Conserver ces réglages, fournis également par `netlify.toml` :

   | Réglage             | Valeur                 |
   | ------------------- | ---------------------- |
   | Base directory      | vide (racine du dépôt) |
   | Package directory   | vide (racine du dépôt) |
   | Build command       | `npm run build`        |
   | Publish directory   | `dist`                 |
   | Functions directory | `netlify/functions`    |
   | Node.js             | `22`                   |

5. Dans **Project configuration → Environment variables**, ajouter `HERBLAY_ADMIN_CODE` avec un code long et unique. Utiliser le scope **Functions** (ou tous les scopes si le choix détaillé est indisponible), et le contexte **Production**. Ne jamais placer sa valeur dans Git, dans le frontend ou dans `netlify.toml`. Aucun token Netlify Blobs manuel n’est nécessaire : les Functions du site reçoivent leur contexte automatiquement.
6. Dans **Deploys**, déclencher **Trigger deploy → Deploy site** une fois la variable enregistrée. Si l’association au dépôt a déjà lancé un déploiement avant l’ajout de la variable, relancer un déploiement après son ajout. Utiliser un déploiement Git Netlify, pas un glisser-déposer de `dist`, qui n’installe pas les Functions.
7. Sur `https://eloquent-crisp-f348bb.netlify.app/#gestion`, se connecter, ajouter un produit réel avec photo et ouvrir le site public sur un autre appareil. Vérifier la synchronisation, une commande de test et sa présence dans la gestion. Retirer ensuite les données de démonstration que vous avez ajoutées au catalogue.

**Cette procédure modifie le site existant** : son identifiant, son adresse Netlify et ses domaines restent associés au même projet. Aucun nouveau site n’est à créer. La liaison au dépôt et le déploiement de production ne sont pas effectués par les scripts de ce dépôt.

## Limites opérationnelles

- Le magasin est lié au site Netlify, et non à la branche Git. Ne pas utiliser de commandes réelles dans un Deploy Preview partageant le magasin du site. Ne fournir le code administrateur qu’aux contextes voulus.
- Le catalogue initial est vide. Renseigner les produits, origines, tarifs, TVA et photos réels dans la gestion. L’adresse de retrait et les coordonnées du commerce n’étaient pas fournies : les compléter dans les informations du site avant ouverture au public, ainsi que les mentions légales et la politique de conservation adaptées au commerce.
- Le stock est réservé lors de la commande ; les statuts ne libèrent pas de stock automatiquement. Corriger le stock dans la gestion si une commande doit être annulée. Les commandes restent consultables dans la gestion ; définir une politique d’archivage et d’effacement des données personnelles avant une exploitation prolongée.
- Les photos retirées du catalogue restent dans Blobs pour ne pas supprimer une image encore utilisée par un autre produit. Les sauvegardes et l’entretien du magasin relèvent de l’exploitation Netlify.
- La validation locale utilise un stockage de test. L’accès Blobs réel, les Functions publiées et Safari sur iPhone physique devront être confirmés après déploiement. Aucun accès au compte Netlify n’est nécessaire pour tester localement.

### Révisions des catégories

Chaque écriture renvoie la révision issue de l’écriture conditionnelle Blobs. Une modification de catégorie renvoie aussi le catalogue résultant : l’interface applique immédiatement produits, catégories et révision sans attendre une seconde lecture. Les lectures démarrées avant une écriture sont ignorées et les actions sur les catégories sont bloquées pendant leur enregistrement. « Actualiser » effectue une lecture sans cache, même si une lecture précédente était en cours. Les révisions d’un formulaire produit déjà ouvert restent conservées pour détecter une modification concurrente.

Le test navigateur `category-revisions.spec.js` enchaîne deux renommages, un ajout, une montée, une descente et une suppression sans rechargement ; il retarde une lecture ancienne, contrôle les révisions échangées, provoque un conflit depuis une seconde session et vérifie la reprise après « Actualiser ». Les tests utilisent exclusivement un magasin local isolé.

## Comptes clients et listes de courses

Le bouton **Mon compte · Mes listes** permet l’inscription (nom, email et mot de passe de 12 à 128 caractères), la connexion et la déconnexion. Les mots de passe sont dérivés avec scrypt et un sel individuel ; les sessions aléatoires sont conservées sous forme de condensat côté serveur, expirent après 30 jours et utilisent un cookie HttpOnly, Secure et SameSite Strict. Les tentatives de connexion et d’inscription sont limitées par adresse IP. Le compte client est indépendant de la gestion administrateur.

Chaque client peut enregistrer jusqu’à 30 listes de 100 produits dans Netlify Blobs. Elles se retrouvent sur ses appareils après connexion ; les mises à jour concurrentes sont refusées et nécessitent une actualisation. Ajouter une liste au panier conserve le panier courant et ajuste les quantités au stock actuel. Les produits supprimés restent signalés dans les listes. Enregistrer une liste ne réserve aucun stock. Les photos sont affichées dans le panier et les listes, avec un texte de remplacement si aucune image n’est disponible. Les suggestions proposent au maximum quatre produits en stock qui ne sont pas déjà dans le panier ; elles ne reposent pas sur un profilage.

Cette première version ne vérifie pas les emails et ne fournit pas encore de récupération de mot de passe ni de suppression de compte en libre-service. Aucun email n’est envoyé. Ces parcours et la politique de conservation des comptes restent à compléter avant une ouverture générale des inscriptions. Les données clients sont stockées séparément du catalogue public et ne sont accessibles via l’API qu’avec la session du client concerné.
