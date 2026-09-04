# API de l'Atelier informatique — comptes élèves et progression

Petite API (Node.js + PostgreSQL, sans cadre applicatif) qui permet à un élève de se
connecter depuis n'importe quel poste et de retrouver sa progression et ses trophées.

Tant que `scripts/config.js` ne contient pas d'adresse d'API, **rien ne change** : les
jeux fonctionnent comme avant, progression rangée dans le navigateur du poste. Cette
API est une couche qu'on ajoute, jamais un passage obligé.

---

## 1. Ce qui est stocké

| Table | Contenu |
|---|---|
| `etablissements` | nom, ville, ouvert ou fermé |
| `classes` | 6e, 5e, 4e, 3e, CAP1, CAP2… **rattachées à un établissement** |
| `comptes` | identifiant, prénom, nom, classe, **établissement**, rôle, **empreinte** du mot de passe, dates |
| `progressions` | un objet JSON par élève : `ms_unlocked`, `badges_v1`, etc. |
| `sessions` | empreinte du jeton, expiration |
| `journal` | connexions, créations, suppressions (traçabilité), et l'établissement concerné |

Rien d'autre : pas de date de naissance, pas d'adresse, pas d'e-mail élève, pas d'INE,
aucun champ de commentaire libre. Voir les commentaires de `schema.sql`.

Durées de conservation, appliquées automatiquement par le serveur :

| Donnée | Durée |
|---|---|
| Compte élève, progression, trophées | 24 mois après la **création** du compte (`CONSERVATION_MOIS`) |
| Journal des connexions et actions | 12 mois (`JOURNAL_MOIS`) |
| Session | 12 heures |
| Présence en séance | dernier état seulement, périmé après 2 minutes |

> **Les documents RGPD de l'établissement ne sont pas dans ce dépôt.** La fiche de
> registre (art. 30) et la mention d'information (art. 13) appartiennent au chef
> d'établissement, qui est le responsable de traitement — pas au logiciel. Remplies,
> elles portent le nom du collège, son adresse et des contacts nominatifs. Elles vivent
> donc dans `documents-rgpd/`, ignoré par git. Ce qui précède en est la matière
> technique, et a bien sa place ici.

> ⚠ **Une instance partagée change ta position juridique.** Tant que le serveur ne sert
> que ton collège, tu mets en œuvre un traitement dont ton chef d'établissement est le
> responsable. Dès qu'il en sert un second, tu deviens **sous-traitant** (RGPD art. 28) de
> chaque établissement qui n'est pas le tien : traiter leurs données pour leur compte, sur
> leur instruction. Ce qui suit, et qui n'est pas dans ce dépôt :
>
> - **un contrat de sous-traitance par établissement** (art. 28.3) — objet, durée,
>   finalité, catégories de personnes, mesures de sécurité, sort des données en fin de
>   contrat, et l'engagement de n'agir que sur instruction documentée ;
> - **ton propre registre**, celui du sous-traitant (art. 30.2), distinct de celui de
>   chaque responsable de traitement ;
> - **une obligation d'assistance** : chaque chef d'établissement doit pouvoir obtenir la
>   liste, l'export ou l'effacement de SES données. Le cloisonnement décrit au § 1 bis
>   n'est pas qu'une commodité d'affichage, c'est ce qui rend cette assistance possible —
>   d'où l'établissement inscrit sur chaque ligne de `journal`.
>
> **Le DPD de ton académie est le bon interlocuteur**, et il vaut mieux le saisir avant le
> premier élève du deuxième collège qu'après. Techniquement, `fermer` un établissement
> (§ 3) coupe l'accès sans rien effacer : c'est la manœuvre de fin de contrat, le temps de
> restituer avant de supprimer.

---

## 1 bis. Plusieurs établissements sur une seule instance

**L'établissement est la frontière.** Une même installation peut servir plusieurs
collèges ; chacun est un monde clos. Un enseignant appartient à un établissement et un
seul, et ne voit jamais rien au-delà : ni un élève, ni une classe, ni une présence, ni un
nom. Ce n'est pas une préférence d'affichage — c'est la limite juridique du traitement.

### Les trois rôles

| Rôle | Établissement | Ce qu'il voit |
|---|---|---|
| `eleve` | le sien | sa progression, rien d'autre |
| `prof` | **un seul** | tous les élèves et toutes les classes de **son** établissement |
| `admin` | **aucun** | la liste des établissements et les comptes enseignants — **aucun élève** |

L'administrateur est délibérément **un compte distinct** du compte enseignant, même quand
c'est la même personne qui détient les deux. Trois raisons, dans cet ordre :

- il ne sert qu'exceptionnellement — ouvrir un collège, créer un professeur — et un compte
  qu'on ouvre trois fois par an ne devrait pas rester connecté toute l'année dans l'onglet
  du fond ;
- il porte le seul pouvoir qui **traverse** la frontière des établissements, et ce
  pouvoir-là ne doit pas être un effet de bord du compte avec lequel on fait cours ;
- il ne voit **aucun élève**, et c'est vérifiable ligne à ligne dans `server.js` : pas une
  route `/api/admin/*` ne renvoie un prénom, une classe ou un avancement d'élève,
  seulement des décomptes.

### Les identifiants

Ils sont **globaux**, jamais propres à un établissement : l'écran de connexion ne demande
qu'un identifiant et un mot de passe, sans liste déroulante de collèges — un élève de 6e
ne doit pas avoir à savoir dans lequel on l'a inscrit.

| Rôle | Forme | Exemple |
|---|---|---|
| `eleve` | prénom . initiale, puis `.nom` court, `.nom`, `2`, `3`… | `lea.m` |
| `prof` | **initiale . NOM** | `g.lecossois` |
| `admin` | **admin . nom** | `admin.lecossois` |

Le professeur est nommé par son **nom** parce que c'est ainsi qu'on l'appelle dans un
établissement, et parce que « G. LECOSSOIS » se relit d'un coup d'œil dans une liste là où
« Grégoire Lecossois » se confond avec un élève. Le préfixe `admin.` n'est pas décoratif :
la même personne détient souvent les deux comptes, et une ligne de journal doit dire lequel
des deux a agi — sans compter qu'il libère `g.lecossois` pour le compte qui fait cours.

### Ce que le cloisonnement protège, concrètement

Trois choses se seraient cassées en silence sans lui, et méritent d'être nommées parce que
**aucune ne se voit à l'écran** :

1. **Résoudre une classe par son nom.** Créer « 6eB » au collège B aurait rendu la 6eB du
   collège A, déjà en base. Les élèves du second seraient allés grossir la classe du
   premier. `classeId()` exige désormais un établissement, et lève si on l'omet.
2. **L'unicité de `classes.nom`.** Elle était **globale** : deux collèges n'auraient pas pu
   avoir chacun une 6eB. Elle porte maintenant sur `(etablissement_id, lower(nom))`.
3. **`PUT /api/prof/classes/ordre`.** Elle reçoit une **liste brute de nombres**, sans rien
   qui les rattache à qui que ce soit — c'est la route la plus exposée de toutes. Elle
   refuse le lot entier dès qu'un identifiant sort de l'établissement, plutôt que de laisser
   le `where` ignorer les intrus : un rangement à moitié appliqué serait tout aussi faux,
   mais invisible.

Une cible d'un autre établissement répond **404 « introuvable »** et non 403 « interdit » :
un refus confirmerait son existence, et laisserait énumérer les comptes du voisin en
essayant des numéros.

### Reprendre une base mono-établissement

Le schéma s'en charge tout seul au premier démarrage (`db.migrer()`), et il n'y a rien à
lancer : les classes et les comptes d'avant sont rattachés au premier établissement, créé
au besoin sous le nom **« Établissement à renommer »**. Les rattacher silencieusement est
le seul choix sûr — la seule autre issue serait de les laisser orphelins, donc invisibles
de tous, c'est-à-dire une base qui s'efface d'elle-même au redémarrage.

Trois choses restent à faire à la main, dans cet ordre :

```bash
cd ~/api
node outils/atl.mjs etablissements                              # relever le numéro
node outils/atl.mjs renommer 1 "Collège Jean Moulin" "Ville"
node outils/atl.mjs admin Prénom Nom                            # le compte administrateur
```

Puis, **depuis `admin.html`**, renommer l'identifiant du compte enseignant existant
(`gregoire.l`, fabriqué par l'ancienne règle) en `g.lecossois` : bouton ✏️ sur sa ligne.
Ce n'est pas fait automatiquement — changer un identifiant de connexion sous les pieds de
quelqu'un sans qu'il l'ait demandé n'est jamais une bonne surprise.

> ⚠ **Le chantier se déploie d'un bloc.** Les pages (GitHub Pages) suivent `main` toutes
> seules ; l'API, non (§ 2.4). Entre les deux, `prof.html` demanderait un établissement à
> un serveur qui ne sait pas ce que c'est. Redéployer l'API **d'abord**, vérifier
> l'empreinte, puis fusionner.

---

## 2. Déploiement chez alwaysdata

Le plan **Cloud public gratuit** (100 Mo, usage non commercial, serveurs à Paris) suffit
très largement : 300 élèves occupent moins de 5 Mo.

### 2.1 La base

1. **Bases de données → PostgreSQL → Ajouter une base.** Note le nom, l'hôte
   (`postgresql-TONCOMPTE.alwaysdata.net`), l'utilisateur et le mot de passe.

### 2.2 Le code

2. **Accès distant → SSH** : il est désactivé par défaut, active-le, puis connecte-toi :

   ```bash
   ssh TONCOMPTE@ssh-TONCOMPTE.alwaysdata.net
   ```

   Récupère **les seuls fichiers de `api/`** — 86 Ko, en une seule ligne :

   ```bash
   mkdir -p ~/api/outils && cd ~/api && B=https://raw.githubusercontent.com/gregoirelecossois/atelier-informatique/main/api && for f in package.json package-lock.json schema.sql env.js db.js auth.js comptes.js motsdepasse.js version.js server.js README.md .env.example .gitignore; do curl -sfL -o "$f" "$B/$f" || echo "MANQUE $f"; done && for f in atl.mjs empreinte.mjs; do curl -sfL -o "outils/$f" "$B/outils/$f" || echo "MANQUE outils/$f"; done && ls -a
   ```

   > ⚠ **La liste de fichiers est à tenir à jour.** Un module oublié ne se voit pas au
   > `curl` — il se voit au démarrage, par un `Cannot find module` dans les journaux du
   > site, ou par une route qui répond « Route inconnue. » alors qu'elle existe dans le
   > dépôt. Le `|| echo "MANQUE …"` ci-dessus est là pour ça. La liste doit couvrir
   > **tout `FICHIERS_SUIVIS` de `version.js`** (c'est ce que l'empreinte compare) plus
   > `package-lock.json`, `README.md`, `.env.example` et `.gitignore` :
   >
   > ```bash
   > cd ~/api && node -e "import('./version.js').then(v=>console.log(v.FICHIERS_SUIVIS.join(' ')))"
   > ```

   ```bash
   cd ~/api && npm install
   ```

   > Ni `git clone`, ni archive complète : 56 Mo de fichiers plus autant d'objets Git
   > dépassent les 100 Mo du plan gratuit, et un `curl … | tar` se casse dès que le tuyau
   > se perd au copier-coller — constaté en conditions réelles. Douze fichiers nommés,
   > une ligne, rien à nettoyer. L'API installée pèse moins d'1 Mo.

### 2.3 Le site

3. **Sites → Ajouter un site**, type **Node.js** :
   - *Adresse* : `TONCOMPTE.alwaysdata.net/api`
   - *Répertoire de travail* : `/home/TONCOMPTE/api`
   - *Commande* : `node server.js`

   alwaysdata fournit `PORT` tout seul : ne le renseigne pas.

4. **Les variables** — dans un fichier `~/api/.env`, lisible par `env.js`.

   On les met **là plutôt que dans l'écran « Environnement » d'alwaysdata**, pour une
   raison pratique : l'outil en ligne de commande (`atl.mjs`, lancé en SSH) doit voir
   les mêmes valeurs que le site. Un fichier, un seul endroit, les deux qui marchent.
   Il n'est jamais versionné (`api/.gitignore`) et un `chmod 600` le réserve à ton compte.

   Voir `.env.example` :

   | Variable | Valeur |
   |---|---|
   | `PGHOST` | `postgresql-TONCOMPTE.alwaysdata.net` |
   | `PGUSER` / `PGPASSWORD` / `PGDATABASE` | ceux de l'étape 1 |
   | `POIVRE` | un secret généré une fois (voir ci-dessous) |
   | `ORIGINES` | `https://gregoirelecossois.github.io` |
   | `CONSERVATION_MOIS` | `24` |
   | `JOURNAL_MOIS` | `12` |

   Génère le poivre **une seule fois** et garde-le dans ton gestionnaire de mots de passe :

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   > ⚠ Changer `POIVRE` rend tous les mots de passe existants invalides. C'est le prix
   > de la protection qu'il apporte : une copie de la base, seule, ne permet aucune
   > attaque par dictionnaire.

5. Vérifie : `https://TONCOMPTE.alwaysdata.net/api/sante` doit répondre

   ```json
   {"ok":true,"service":"atelier-informatique","version":"94e3f1331da5","demarre":"…"}
   ```

   `version` est l'empreinte du code qui tourne réellement. Après chaque
   redéploiement, une commande suffit pour savoir si le nouveau code a bien été repris —
   la question qui, sans ça, ne se tranche qu'en observant le comportement de l'appli :

   ```bash
   node outils/empreinte.mjs https://TONCOMPTE.alwaysdata.net
   ```

   Elle affiche les deux empreintes, dit si elles concordent, et sort en erreur sinon.
   Rien à incrémenter à la main : l'empreinte est calculée à partir des fichiers source
   eux-mêmes, avec les fins de ligne normalisées pour qu'une copie Windows et une copie
   Linux donnent le même résultat.

### 2.4 Redéployer après un changement dans `api/`

**Fusionner une PR ne déploie rien.** Les pages de jeu sont servies par GitHub Pages et
suivent `main` toutes seules ; l'API, elle, vit dans `~/api` chez alwaysdata et n'a
aucun lien avec le dépôt. Une nouvelle route côté dépôt et un serveur qui répond
**« Route inconnue. »** sont donc l'état normal jusqu'à ce que les deux commandes
suivantes soient passées :

```bash
mkdir -p ~/api/outils && cd ~/api && B=https://raw.githubusercontent.com/gregoirelecossois/atelier-informatique/main/api && for f in package.json package-lock.json schema.sql env.js db.js auth.js comptes.js motsdepasse.js version.js server.js README.md .env.example .gitignore; do curl -sfL -o "$f" "$B/$f" || echo "MANQUE $f"; done && for f in atl.mjs empreinte.mjs; do curl -sfL -o "outils/$f" "$B/outils/$f" || echo "MANQUE outils/$f"; done && ls -a
```

Puis **redémarrer le site** dans l'admin alwaysdata (*Sites → ⋯ → Redémarrer*) : le
processus Node garde en mémoire les modules déjà importés, un fichier réécrit sous ses
pieds ne change rien tant qu'il n'a pas repris.

Enfin, vérifier — c'est tout l'intérêt de l'empreinte :

```bash
cd ~/api && node outils/empreinte.mjs https://TONCOMPTE.alwaysdata.net
```

Tant que ça dit « Le serveur fait tourner un AUTRE code », inutile de chercher le bug
ailleurs. `.env` n'est jamais écrasé par ces commandes : il n'est pas dans la liste.

Pour interroger une route directement depuis le poste Windows, `curl.exe` et pas `curl` :
sous PowerShell, `curl` est un **alias d'`Invoke-WebRequest`**, qui ne comprend ni `-s`
ni `-w` et répond « Argument manquant pour le paramètre SessionVariable ».

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" -X POST https://TONCOMPTE.alwaysdata.net/api/mdp -H "Content-Type: application/json" -d "{}"
```

`401 Connexion requise.` = la route est là et réclame un jeton, c'est le résultat
attendu. `404 Route inconnue.` = le site n'a pas redémarré.

Le schéma, lui, se rejoue tout seul au démarrage (`db.migrer()`, tout est en
`if not exists`) — une colonne ajoutée dans `schema.sql` n'a pas besoin d'être appliquée
à la main.

### 2.5 Brancher les jeux

6. Dans `scripts/config.js`, à la racine du dépôt :

   ```js
   window.ATELIER_CONFIG = {
     api: 'https://TONCOMPTE.alwaysdata.net',
     etablissement: '',          // ← à laisser VIDE si le serveur sert plusieurs collèges
     insisterConnexion: true
   };
   ```

   `etablissement` n'est qu'un nom affiché **avant** toute connexion. Ce fichier est le
   même pour tout le monde : dès que le serveur sert plusieurs collèges, y écrire le nom
   de l'un serait faux pour les autres. Une fois connecté, le nom vient du **serveur**,
   avec le profil, et c'est celui-là qui fait foi — il s'affiche dans la barre du tableau
   de bord et dans la fenêtre de compte.

   `ORIGINES` doit contenir **exactement** l'adresse d'où sont servis les jeux, protocole
   compris et sans `/` final. Plusieurs adresses se séparent par des virgules.

> **Variante « tout au même endroit »** : ajoute un second site alwaysdata, statique,
> à l'adresse `TONCOMPTE.alwaysdata.net/`, pointant sur le dépôt des jeux. Même origine
> pour les pages et l'API : plus rien à déclarer dans `ORIGINES`, et un seul domaine à
> faire ouvrir dans le proxy du collège.

### 2.6 Partager les comptes avec une autre application

L'application **« Le PC »** (dépôt `gregoirelecossois/le-pc`) utilise les mêmes comptes
élèves. Rien à installer côté serveur : elle est publiée sous le **même domaine**
(`gregoirelecossois.github.io`), donc sur la **même origine** au sens du navigateur —
le chemin ne compte pas. Elle voit la clé de session `atl_session` posée ici, et un
élève connecté d'un côté l'est de l'autre, sans second écran de connexion.

Ce qu'il a fallu, et ce qu'il faudra pour la suivante :

1. **Un préfixe de clés** réservé à l'application (`pc_`), ajouté aux **deux** listes
   jumelles — `PREFIXES` dans `api/server.js` et dans `scripts/store.js` — puis
   redéploiement de l'API (§ 2.4).
2. **`ORIGINES`** doit contenir le domaine de publication. Ici il y était déjà : c'est
   le même que celui des jeux.
3. Côté application, charger `scripts/store.js`, `scripts/compte.js` et
   `scripts/config.js` **avant** son propre code, et faire passer toute sa persistance
   par `Store.get/set/del` avec des clés préfixées.

#### Dans le tableau de bord

« Le PC » y figure, mais **à part** : après les six colonnes d'ateliers, derrière un
séparateur. Ce n'est pas un septième atelier — il vit dans un autre dépôt, raisonne en
chapitres et en étoiles plutôt qu'en niveaux et missions, et il ne compte **ni** dans
l'avancement global, **ni** dans le compteur de jeux de la page d'accueil, **ni** dans
les trophées. C'est pourquoi il n'est pas dans `window.ATELIERS` mais dans
`window.APPS_LIEES` (`scripts/ateliers.js`), et pas dans `PREFIXES_JEU` non plus.

Le partage du travail : le serveur renvoie des **comptes bruts** (`resumerLePc` lit la
clé `pc_progression` et en tire chapitres finis, étoiles, fiches, badges, XP) et ignore
comme toujours la structure des jeux ; les **totaux** vivent côté client, dans
`APPS_LIEES`, où ils sont déjà tenus. Un élève qui n'y a jamais joué a une colonne grisée
et un tiret, pas un zéro qui ressemblerait à un échec.

Pour la présence « en ce moment », l'application se déclare elle-même : elle pose une
fonction `window.ATELIER_POSITION` renvoyant `{ atelier, niveau, mission }`, que
`scripts/store.js` interroge à chaque battement. Son nom de fichier ne nous apprendrait
rien, elle n'est pas servie depuis ce dépôt.

> Une application qui n'expose **ni** l'un **ni** l'autre reste silencieuse : ni colonne,
> ni présence. C'est volontaire — un avancement faux serait pire que pas d'avancement.

#### Débloquer un chapitre : par instruction, jamais par écriture directe

Dans la fiche d'un élève, cliquer un chapitre de « Le PC » **n'écrit pas** dans sa
progression. Le tableau de bord y dépose une **instruction d'un seul nombre** :

```js
majs['pc_debloquer'] = '5'
```

L'application la lit à son démarrage (et à `store:maj`, si le professeur a cliqué pendant
qu'elle était ouverte ailleurs), l'applique **avec sa propre logique**, puis **efface la
clé** elle-même.

Pourquoi ce détour : la progression de « Le PC » est un unique objet JSON, où débloquer
signifie marquer `done` tous les chapitres précédents, avec des `stars`, `bestScore`,
`mistakes`, `seconds` et `hintsUsed` qu'il faudrait **inventer**. Le tableau de bord
devrait donc embarquer une copie du modèle de données de l'autre dépôt — un modèle qui a
déjà changé une fois (chapitre 7 scindé en deux, migration `v1 → v2`). Le jour où il
rebouge, on écrirait silencieusement des données fausses dans la progression d'un élève.
Avec l'instruction, le contrat entre les deux dépôts tient dans un nombre.

Deux garanties, tenues côté application et vérifiées :

- **rien n'est jamais retiré ni dégradé** — un chapitre déjà réussi garde ses étoiles ;
- **les résultats fabriqués valent zéro étoile** : ils disent « ce chapitre est ouvert »,
  pas « il l'a réussi ». Ni l'élève ni le professeur ne doit lire une réussite là où il
  n'y en a pas eu. L'XP n'est pas touchée non plus.

Tant que l'élève ne s'est pas reconnecté, la fiche affiche « ouverture jusqu'au
chapitre N **en attente** ».

### 2.7 Faire ouvrir le domaine

7. **À faire avant la première séance** : demander au référent numérique / à la DSI
   d'autoriser le domaine dans le filtrage du collège. Sinon, trente élèves devant un
   écran de connexion qui tourne.

---

## 3. L'espace administrateur

`admin.html`, à côté des jeux. Il n'est annoncé nulle part : le bouton « 🏫 Établissements »
n'apparaît que dans la fenêtre de compte d'un **administrateur** connecté. Comme
`prof.html`, la page n'est pas secrète — c'est l'API qui vérifie le rôle à chaque requête.

On y fait trois choses, et pas une de plus :

- **ouvrir un établissement** — nom, ville, et les six classes de base (6e, 5e, 4e, 3e,
  CAP1, CAP2) posées d'office ; l'enseignant les range et les supprime ensuite depuis son
  tableau de bord ;
- **créer les comptes enseignants** — un enseignant appartient à un établissement et un
  seul. Son mot de passe de vingt caractères n'est lisible **qu'une fois**, là, dans la
  fenêtre. Le muter d'un établissement à l'autre ferme ses sessions ouvertes : sans cela il
  continuerait un moment à voir les élèves du collège qu'il vient de quitter ;
- **fermer un établissement** — `actif` à faux. Plus personne ne s'y connecte, les sessions
  en cours tombent tout de suite, et **rien n'est effacé**. C'est ce qu'il faut d'une fin de
  contrat : le temps de restituer les données avant de les supprimer, sans qu'elles restent
  accessibles entre-temps.

Un établissement **ne se supprime pas avec ses données**. La base l'interdit
(`comptes.etablissement_id` est en `on delete restrict`) et la page le dit avant même
d'envoyer la requête : il faut d'abord supprimer ses comptes. « Supprimer le collège » se
lit beaucoup trop facilement comme « supprimer ses élèves », et c'est précisément ce qui
n'arrivera pas par accident.

> **Ce qu'on ne trouvera jamais sur cette page** : un nom d'élève, une classe, un
> avancement. Seulement des décomptes. Ouvrir un collège ne donne pas le droit d'en lire
> les élèves, et le découpage des écrans doit le dire aussi clairement que le contrat.

---

## 4. Le tableau de bord enseignant

`prof.html`, à côté des jeux. Il n'est annoncé nulle part : le bouton « 📊 Suivi des
élèves » n'apparaît que dans la fenêtre de compte d'un enseignant connecté. La page
elle-même n'est pas secrète — c'est l'API qui vérifie le rôle à chaque requête, un élève
qui trouve l'adresse ne voit rien.

Le nom de l'établissement s'affiche **en permanence dans la barre du haut**. Ce n'est pas
un ornement : c'est le périmètre exact de ce que la page a le droit de montrer, et il vient
du serveur, jamais de `scripts/config.js`.

Ce qu'on y fait :

- **repérer qui décroche** : le tri par défaut remonte les moins avancés, et la couleur
  de la barre passe du rouge au vert ; filtres par classe, recherche par nom (insensible
  aux accents), tri par avancement, classe, dernière connexion ou présence ;
- **voir qui travaille en ce moment**, dans quel atelier et à quel niveau — les élèves
  émettent un battement toutes les 45 s tant que leur onglet est visible, et la page
  l'interroge toutes les 10 s. Un élève disparaît du direct de deux façons : il ferme
  l'onglet, verrouille son téléphone ou change d'application, et son navigateur annonce
  le départ — le point vert s'éteint aussitôt ; ou plus aucun battement n'arrive pendant
  deux minutes, ce qui couvre la coupure de réseau et l'onglet tué de force. Passer d'un
  atelier à l'autre, en revanche, ne l'éteint pas ;
- **suivre finement** : chaque atelier affiche la position exacte, `N3·M2` — niveau 3,
  mission 2 — plutôt qu'un simple numéro de niveau ;
- **placer un élève mission par mission** : dans sa fiche, cliquer un niveau déplie ses
  missions avec celle en cours mise en évidence, et un second clic y envoie l'élève.
  Débloquer un niveau entier expédiait souvent l'élève plus loin qu'on ne voulait, et
  afficher les trois cents missions d'emblée aurait noyé la fiche ;
- **créer un compte élève**, réinitialiser un mot de passe, corriger un nom, une classe ou
  un identifiant, désactiver ou supprimer. Un enseignant ne gère que des **élèves** : les
  comptes de ses collègues appartiennent à l'espace administrateur, parce que réinitialiser
  le mot de passe d'un autre professeur, c'est prendre sa place. Cette seule règle remplace
  les deux garde-fous d'avant (« on ne se désactive pas soi-même », « on ne supprime pas son
  propre compte ») : un enseignant n'est pas un élève, il ne peut donc plus se viser ;
- **ranger les classes** : les pastilles de filtre se **glissent** dans l'ordre voulu, et
  cet ordre est celui de l'année scolaire, pas celui de l'alphabet. Il part au serveur en
  une seule requête (`PUT /api/prof/classes/ordre`) : un glisser déplace potentiellement
  toute la rangée, et une série d'appels laisserait un rangement à moitié écrit si l'un
  d'eux échouait ;
- **supprimer une classe** au clic droit. ⚠️ Cela ne supprime **aucun élève** :
  `comptes.classe_id` est en `on delete set null`, les comptes basculent en « Sans
  classe » avec toute leur progression, et on leur en réattribue une depuis leur fiche.
  La confirmation le dit et annonce combien d'élèves sont concernés — « supprimer la
  6eB » se lit trop facilement comme « supprimer ses élèves ».

Toute action de l'enseignant est inscrite dans la table `journal`, **avec l'établissement
concerné** : un avancement modifié doit pouvoir s'expliquer, et un chef d'établissement doit
pouvoir obtenir le journal de ses données sans qu'on lui montre celui des autres. La
suppression d'une classe y note le nombre d'élèves détachés.

## 5. Créer les comptes en ligne de commande

Le tableau de bord crée les comptes un par un ; l'import d'une classe entière, la purge et
l'amorçage restent en SSH depuis `~/api`.

**Toute commande qui touche une classe ou un compte sait dans quel établissement elle
travaille.** `--etab` accepte un numéro ou un nom. Tant qu'il n'y a qu'**un** établissement
en base, on peut l'omettre : il n'y a pas d'ambiguïté à lever. Dès qu'il y en a deux,
l'omettre est une **erreur** et non un choix par défaut — c'est exactement le moment où se
glisserait un élève créé dans le mauvais collège, invisible de son professeur et visible
d'un autre, sans que rien à l'écran ne le signale.

Premier démarrage, dans cet ordre :

```bash
node outils/atl.mjs init
node outils/atl.mjs admin Grégoire Lecossois
node outils/atl.mjs etablissement "Collège Jean Moulin" "Ville"
node outils/atl.mjs creer Grégoire Lecossois --prof --etab 1
```

```bash
node outils/atl.mjs creer Léa Martin 6e --etab 1
```

Import d'une classe entière depuis un fichier `classe.csv` (`prenom;nom;classe`, une
ligne par élève, en-tête facultatif) :

```bash
node outils/atl.mjs importer classe.csv --etab 1
```

L'import écrit à côté un `identifiants-AAAA-MM-JJ.csv` avec les mots de passe **en
clair** : imprime-le, découpe-le, distribue-le, puis **supprime le fichier**. C'est la
seule et unique fois où ces mots de passe sont lisibles — la base ne contient que leur
empreinte.

Autres commandes : `etablissements`, `renommer <id> <nom> [ville]`, `fermer` / `rouvrir`,
`classes`, `classe`, `liste [classe]`, `mdp <identifiant>`, `activer` / `desactiver`,
`supprimer <identifiant> --oui`, `purger`, `entropie`. `node outils/atl.mjs` sans argument
affiche la liste complète.

---

## 6. Sécurité — les choix faits, et pourquoi

- **Hachage scrypt** (`node:crypto`), sel aléatoire de 128 bits, plus un poivre gardé
  hors base. scrypt figure dans les fonctions admises par la recommandation CNIL
  2022-100, et ne demande aucune dépendance native — ce qui compte sur un hébergement
  mutualisé où rien ne se compile.
- **Limitation des tentatives** : 10 essais par identifiant et 40 par adresse IP, sur
  une fenêtre de 10 minutes.
- **Aucune énumération de comptes** : identifiant inconnu et mot de passe faux donnent
  le même message *et* le même temps de réponse (un hachage à vide est calculé exprès).
- **Jetons de session** de 256 bits, stockés hachés : une copie de la base ne donne
  aucune session utilisable. Durée 12 h, glissante, révoquée à la déconnexion et à
  chaque changement de mot de passe.
- **Jeton porteur plutôt que cookie** : les pages et l'API vivent sur deux domaines,
  et un cookie tiers se fait bloquer aussi bien par les navigateurs que par les filtres
  d'établissement. Effet de bord agréable : aucune surface CSRF.
- **Cloisonnement par établissement** : la portée est posée **une fois**, dans
  `sessionProf()`, à partir de la session — jamais à partir de ce que le client envoie.
  Aucun identifiant de classe, d'élève ou de liste reçu dans une requête ne peut
  l'élargir : il est vérifié contre l'établissement de la session avant d'être utilisé.
  Deux contraintes de base tiennent le reste : `classes.etablissement_id` est `not null`
  (une classe sans établissement serait visible de tous ou de personne, le serveur refuse
  de démarrer si la contrainte ne s'applique pas) et `comptes` porte un `check` qui
  n'autorise l'absence d'établissement que pour le rôle `admin`.
- **Périmètre des clés** : le serveur n'accepte que les clés de jeu (`ms_`, `kb_`,
  `tt_`, `df_`, `nv_`, `ml_`, `pc_`, `badges_`, `a11y_`). Tout le reste est refusé.
  Cette liste est **jumelle** de `PREFIXES` dans `scripts/store.js` : les deux bougent
  ensemble, sinon le client refuse d'envoyer une clé que le serveur accepte — ou le
  serveur rejette tout un envoi pour une seule clé inconnue.

### Le mot de passe des élèves

Les deux formes générées dépassent le seuil de **50 bits** demandé par la recommandation
CNIL 2022-100 lorsqu'une restriction d'accès est en place. `node outils/atl.mjs entropie`
affiche le calcul et des exemples — de quoi répondre au DPD sans le lui faire croire sur
parole.

**Par défaut — prononçable, ~55 bits** : `mibomu-sefanu-kerebe`

Consonne et voyelle en alternance stricte, trois groupes de six lettres. C'est la forme
la plus courte qui reste mémorisable, et elle a trois qualités qui comptent en classe :

- **ça se prononce**, donc ça se retient (« mi-bo-mu, sé-fa-nu, ké-ré-be ») ;
- **que des minuscules**, aucun accent, aucun chiffre à placer, aucune majuscule à
  chercher — ce qui compte quand l'atelier sert justement à apprendre le clavier ;
- **la position dit la nature de la lettre** : rangs impairs = consonnes, rangs pairs =
  voyelles. Un élève qui hésite entre `i` et `l`, ou entre `u` et `v`,
  tranche tout seul en recopiant depuis sa carte imprimée.

**Avec `--court` — 11 caractères, ~54 bits** : `jmzn-fyuc-5p7`

Deux fois plus court à taper, mais impossible à retenir : pour un adulte qui doit encore
pouvoir le recopier à la main.

**Le compte enseignant — 20 caractères, ~119 bits** : `7ni9FrGsJE00dX39e1jy`

C'est le défaut de `--prof`, et ce n'est pas un excès de zèle : ce compte voit **toute**
la base, c'est le seul qui mérite d'être attaqué, et le seul dont le mot de passe ne coûte
rien à rallonger puisqu'il vit dans un gestionnaire. Lui donner les 55 bits d'un mot de
passe d'élève reviendrait à économiser sur la seule serrure qui compte. Effet secondaire
appréciable : les gestionnaires cessent de le signaler comme faible.

`--prononcable` force la forme élève sur n'importe quel compte, si tu tiens à pouvoir
la taper de tête.

> **Le plancher est incompressible.** 50 bits d'information occupent au minimum ~11
> caractères tirés au hasard, ou ~18 lettres si on veut que ça se prononce. Aucune
> présentation n'y échappe : on choisit seulement entre « court et illisible » et
> « un peu plus long et mémorisable ».

### Le mot de passe que l'élève choisit lui-même

Tout ce qui précède décrit un mot de passe **provisoire**. Il a été imprimé, lu à voix
haute, parfois recopié sur un cahier : tant qu'il sert, l'empreinte gardée en base ne
protège pas grand-chose. À sa **première connexion**, l'élève en choisit donc un que
personne d'autre ne connaît — c'est le drapeau `comptes.doit_changer_mdp`, vrai à la
création d'un compte élève comme après chaque réinitialisation par l'enseignant.

- La fenêtre de création est **bloquante** (`scripts/compte.js`) : ni Échap ni clic à
  côté. Sans cela, la moitié de la classe cliquerait « plus tard » et le mot de passe
  imprimé resterait le vrai mot de passe toute l'année.
- Le mot de passe est saisi **deux fois** : un mot de passe choisi puis mal retapé est
  un compte perdu jusqu'à la prochaine réinitialisation.
- Quatre familles exigées — **majuscule, minuscule, chiffre, symbole** — plus une
  longueur minimale (`MDP_MIN`, **12** dans `motsdepasse.js`). Les règles sont
  cochées **en direct** pendant la frappe : un élève de 6e ne lit pas un refus après
  coup, il regarde ce qui manque encore pendant qu'il tape.
- `POST /api/mdp` revérifie tout côté serveur (`verifierPolitique`) : la liste affichée
  guide, elle ne décide pas. Le mot de passe actuel n'est redemandé que pour un
  changement **volontaire** ; à la première connexion l'élève vient tout juste de s'en
  servir pour entrer.
- Le changement ferme **toutes les autres** sessions, jamais celle en cours.

> **Ce que ça vaut, honnêtement.** Un mot de passe **choisi** par un humain de 11 ans
> n'atteint pas les ~55 bits d'un mot de passe **tiré au hasard**, même avec quatre
> familles. Ce qui maintient le compte dans le palier « 50 bits avec restriction
> d'accès » de la recommandation CNIL 2022-100, c'est la **limitation des tentatives**
> (10 essais par identifiant sur 10 minutes), pas la composition. Le registre de
> traitement doit dire ça, et pas autre chose. Le gain réel est ailleurs, et il est
> réel : plus aucun mot de passe d'élève ne circule sur une feuille de papier.

**Pourquoi 12 et pas 8.** « 12 caractères avec majuscules, minuscules, chiffres et
caractères spéciaux » est la formulation historique de la CNIL, et c'est ici un choix de
terrain plus qu'un choix réglementaire : les élèves qui arrivent sur cet écran sortent
de sept niveaux de clavier, dont un entièrement consacré aux symboles — taper douze
caractères ne leur coûte plus rien. `MDP_MIN` se change dans `motsdepasse.js` et dans sa
copie de `scripts/compte.js` ; tout le reste (messages affichés, contrôles serveur) en
découle. À surveiller à la rentrée : si des élèves se font réinitialiser leur mot de
passe à répétition, c'est ce chiffre qu'il faut baisser, pas les quatre familles.

---

## 7. Entretien

**Après avoir ajouté ou retiré une mission ou un niveau**, deux scripts remettent les
compteurs d'aplomb — le tableau de bord s'en sert comme dénominateurs :

```bash
node scripts/compter-missions.mjs && node scripts/verifier-catalogue.mjs
```

Le premier recompte les missions de chaque niveau et les réécrit dans
`scripts/ateliers.js` ; il recoupe sa somme avec `scripts/game-count.mjs` et refuse
d'écrire en cas d'écart. Le second vérifie que l'atelier, le catalogue et les pastilles
de la page d'accueil annoncent le même nombre de niveaux.

**Sauvegarde** (à mettre en tâche planifiée alwaysdata, une fois par nuit) :

```bash
pg_dump -Fc "$PGDATABASE" > ~/sauvegardes/atelier-$(date +%F).dump
```

**Purge — automatique, rien à lancer.** Un compte élève est supprimé **24 mois après sa
création**, progression et trophées compris. Le serveur s'en charge au démarrage puis une
fois par jour, et chaque passage laisse une trace dans la table `journal`. La durée se
règle avec `CONSERVATION_MOIS`.

Pour voir d'avance ce qui va partir, sans rien supprimer :

```bash
node outils/atl.mjs purger
```

Et pour forcer le passage tout de suite :

```bash
node outils/atl.mjs purger --oui
```

> **À savoir** : le délai court depuis la **création**, pas depuis la dernière connexion.
> C'est une échéance connue d'avance, identique pour tous, qu'on peut annoncer aux
> familles dans la mention d'information. En contrepartie, un élève encore présent au
> bout de deux ans repart de zéro : il suffit de lui recréer un compte.

---

## 8. Dépannage

| Symptôme | Piste |
|---|---|
| La pastille reste « Non connecté·e » | `api` absent de `scripts/config.js`, ou page ouverte en `file://` (mode local volontaire) |
| « Impossible de joindre le serveur » | `ORIGINES` ne correspond pas exactement à l'adresse des jeux ; ou domaine bloqué par le proxy du collège |
| « Session expirée » au bout de 12 h | normal, il suffit de se reconnecter |
| La pastille affiche « hors ligne » | l'élève continue de jouer, tout est gardé sur le poste et repart au retour du réseau |
| `/api/sante` ne répond pas | regarder les journaux du site dans l'admin alwaysdata ; le plus souvent une variable de base de données mal saisie |
| Un correctif déployé semble sans effet | `node outils/empreinte.mjs https://…` : si les empreintes diffèrent, le processus n'a pas repris le nouveau code — redémarrer le site dans l'admin |
| **« Route inconnue. »** sur une route qui existe dans le dépôt | l'API n'a pas été redéployée : fusionner une PR ne touche pas `~/api`. Voir § 2.4 — recopier les fichiers, **redémarrer le site**, vérifier l'empreinte |
| `Cannot find module './…'` dans les journaux au démarrage | un fichier manque dans la liste du `curl` de déploiement — la comparer à `FICHIERS_SUIVIS` de `version.js` (§ 2.2) |
| La fenêtre « Choisis ton mot de passe » n'apparaît jamais | API pas à jour : c'est `profil()` qui porte `doitChangerMdp`, l'ancien serveur ne le renvoyait pas dans `eleve` |
| Un établissement nommé **« Établissement à renommer »** apparaît | normal après la reprise d'une base mono-établissement : `node outils/atl.mjs renommer <id> "…" "…"` (§ 1 bis) |
| « Plusieurs établissements : précise lequel avec `--etab` » | voulu : au-delà d'un établissement, l'outil refuse de deviner |
| « Établissement obligatoire pour résoudre une classe. » | un appel à `classeId()` sans portée — c'est un bug, pas une configuration : la frontière est refusée à l'entrée plutôt que contournée |
| Un enseignant ne voit plus aucun élève après une mutation | ses sessions ont été fermées exprès, il se reconnecte et voit son nouvel établissement |
| « Les comptes enseignants se gèrent depuis l'espace administrateur. » | voulu : un professeur ne gère que des élèves (§ 4) |
| La barre du tableau de bord n'affiche aucun établissement | API pas à jour : c'est `/api/prof/tableau` qui le renvoie |
