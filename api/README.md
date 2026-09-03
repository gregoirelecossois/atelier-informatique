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
| `classes` | 6e, 5e, 4e, 3e, CAP1, CAP2… |
| `comptes` | identifiant, prénom, nom, classe, rôle, **empreinte** du mot de passe, dates |
| `progressions` | un objet JSON par élève : `ms_unlocked`, `badges_v1`, etc. |
| `sessions` | empreinte du jeton, expiration |
| `journal` | connexions, créations, suppressions (traçabilité) |

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
     etablissement: 'Collège …',
     insisterConnexion: true
   };
   ```

   `ORIGINES` doit contenir **exactement** l'adresse d'où sont servis les jeux, protocole
   compris et sans `/` final. Plusieurs adresses se séparent par des virgules.

> **Variante « tout au même endroit »** : ajoute un second site alwaysdata, statique,
> à l'adresse `TONCOMPTE.alwaysdata.net/`, pointant sur le dépôt des jeux. Même origine
> pour les pages et l'API : plus rien à déclarer dans `ORIGINES`, et un seul domaine à
> faire ouvrir dans le proxy du collège.

### 2.6 Faire ouvrir le domaine

7. **À faire avant la première séance** : demander au référent numérique / à la DSI
   d'autoriser le domaine dans le filtrage du collège. Sinon, trente élèves devant un
   écran de connexion qui tourne.

---

## 3. Le tableau de bord enseignant

`prof.html`, à côté des jeux. Il n'est annoncé nulle part : le bouton « 📊 Suivi des
élèves » n'apparaît que dans la fenêtre de compte d'un enseignant connecté. La page
elle-même n'est pas secrète — c'est l'API qui vérifie le rôle à chaque requête, un élève
qui trouve l'adresse ne voit rien.

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
- **créer un compte**, réinitialiser un mot de passe, corriger un nom, une classe ou un
  identifiant, désactiver ou supprimer.

Toute action de l'enseignant est inscrite dans la table `journal` : un avancement modifié
doit pouvoir s'expliquer.

Deux garde-fous : on ne supprime ni ne désactive son propre compte.

## 4. Créer les comptes en ligne de commande

Le tableau de bord crée les comptes un par un ; l'import d'une classe entière et la
purge restent en SSH depuis `~/api` :

```bash
node outils/atl.mjs init
```

```bash
node outils/atl.mjs creer Grégoire Lecossois --prof --court
```

```bash
node outils/atl.mjs creer Léa Martin 6e
```

Import d'une classe entière depuis un fichier `classe.csv` (`prenom;nom;classe`, une
ligne par élève, en-tête facultatif) :

```bash
node outils/atl.mjs importer classe.csv
```

L'import écrit à côté un `identifiants-AAAA-MM-JJ.csv` avec les mots de passe **en
clair** : imprime-le, découpe-le, distribue-le, puis **supprime le fichier**. C'est la
seule et unique fois où ces mots de passe sont lisibles — la base ne contient que leur
empreinte.

Autres commandes : `classes`, `classe`, `liste [classe]`, `mdp <identifiant>`,
`activer` / `desactiver`, `supprimer <identifiant> --oui`, `entropie`.

---

## 5. Sécurité — les choix faits, et pourquoi

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
- **Périmètre des clés** : le serveur n'accepte que les clés de jeu (`ms_`, `kb_`,
  `tt_`, `df_`, `nv_`, `ml_`, `badges_`, `a11y_`). Tout le reste est refusé.

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

## 6. Entretien

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

## 7. Dépannage

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
