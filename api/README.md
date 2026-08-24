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

   Récupère **le seul dossier `api/`**, sans jamais poser les 56 Mo du dépôt sur le
   disque — l'archive est lue au vol, seul ce qui est demandé est écrit (~90 Ko) :

   ```bash
   curl -sL https://github.com/gregoirelecossois/atelier-informatique/archive/refs/heads/main.tar.gz | tar xz --strip-components=1 --wildcards '*/api/*'
   ```

   ```bash
   cd ~/api && npm install
   ```

   > Un `git clone` du dépôt entier ne passerait pas : 56 Mo de fichiers plus autant
   > d'objets Git dépassent les 100 Mo du plan gratuit. L'API installée pèse moins d'1 Mo.

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

   Génère le poivre **une seule fois** et garde-le dans ton gestionnaire de mots de passe :

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   > ⚠ Changer `POIVRE` rend tous les mots de passe existants invalides. C'est le prix
   > de la protection qu'il apporte : une copie de la base, seule, ne permet aucune
   > attaque par dictionnaire.

5. Vérifie : `https://TONCOMPTE.alwaysdata.net/api/sante` doit répondre `{"ok":true,…}`.

### 2.4 Brancher les jeux

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

### 2.5 Faire ouvrir le domaine

7. **À faire avant la première séance** : demander au référent numérique / à la DSI
   d'autoriser le domaine dans le filtrage du collège. Sinon, trente élèves devant un
   écran de connexion qui tourne.

---

## 3. Créer les comptes

Tant que le tableau de bord enseignant n'existe pas (phase 2), tout se fait en SSH
depuis `~/api` :

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

## 4. Sécurité — les choix faits, et pourquoi

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

Deux fois plus court à taper, mais impossible à retenir : pour les adultes et les comptes
qui vivent dans un gestionnaire de mots de passe.

> **Le plancher est incompressible.** 50 bits d'information occupent au minimum ~11
> caractères tirés au hasard, ou ~18 lettres si on veut que ça se prononce. Aucune
> présentation n'y échappe : on choisit seulement entre « court et illisible » et
> « un peu plus long et mémorisable ».

---

## 5. Entretien

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

## 6. Dépannage

| Symptôme | Piste |
|---|---|
| La pastille reste « Non connecté·e » | `api` absent de `scripts/config.js`, ou page ouverte en `file://` (mode local volontaire) |
| « Impossible de joindre le serveur » | `ORIGINES` ne correspond pas exactement à l'adresse des jeux ; ou domaine bloqué par le proxy du collège |
| « Session expirée » au bout de 12 h | normal, il suffit de se reconnecter |
| La pastille affiche « hors ligne » | l'élève continue de jouer, tout est gardé sur le poste et repart au retour du réseau |
| `/api/sante` ne répond pas | regarder les journaux du site dans l'admin alwaysdata ; le plus souvent une variable de base de données mal saisie |
