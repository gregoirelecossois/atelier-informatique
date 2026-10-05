/* API de l'Atelier informatique — comptes élèves et sauvegarde de progression.
 *
 * Volontairement sans cadre applicatif : node:http et pg, rien d'autre. Un hébergement
 * mutualisé, aucune étape de compilation — moins il y a de pièces, moins il y a à
 * surveiller et à mettre à jour pendant l'année scolaire.
 *
 * Authentification par jeton porteur (Authorization: Bearer …) et non par cookie :
 * la page de jeu et l'API vivent sur deux domaines différents (GitHub Pages d'un côté,
 * alwaysdata de l'autre), et un cookie tiers se fait aujourd'hui bloquer par les
 * navigateurs comme par les filtres des réseaux d'établissement. Corollaire agréable :
 * aucune surface CSRF.
 *
 * L'ÉTABLISSEMENT EST LA FRONTIÈRE. Une même instance sert plusieurs collèges, et un
 * enseignant ne voit jamais rien au-delà du sien : ni un élève, ni une classe, ni une
 * présence, ni un nom. Cela ne tient pas à ce que le tableau de bord affiche, mais à ce
 * que CHACUNE des routes /api/prof/* accepte de renvoyer — la portée est posée par
 * sessionProf(), et aucune requête n'y échappe. Une cible d'un autre établissement est
 * « introuvable » (404) et non « interdite » (403) : un refus confirmerait son existence.
 *
 * Routes ouvertes à tout compte connecté :
 *   GET    /api/sante                       état du service + empreinte du code déployé
 *   POST   /api/connexion                   {identifiant, motdepasse} → jeton + progression
 *   POST   /api/deconnexion                 révoque le jeton présenté
 *   GET    /api/moi                         profil + progression complète
 *   POST   /api/mdp                         {nouveau, ancien?} → l'élève choisit son mot de passe
 *   PUT    /api/progression                 {majs, suppressions} → nouvelle version
 *   POST   /api/presence                    battement : où en est l'élève en ce moment
 *   GET    /api/makecode/projets            tous ses projets MakeCode, compressés
 *   PUT    /api/makecode/projet             {id, donnees} → enregistre un projet
 *   DELETE /api/makecode/projet             {id} → supprime un projet
 *   GET    /api/makecode/modeles            modèles proposés à sa classe (prof : tous)
 *   GET    /api/makecode/modele/:id         un modèle, compressé, pour en partir
 *
 * Routes ouvertes SANS connexion — le travail à la maison (maison.html, dépôt le-pc).
 * Le code de l'établissement, porté par le lien donné aux élèves, tient lieu de portée :
 *   GET    /api/devoir/classes?c=CODE       les noms des classes, pour que l'élève choisisse
 *   POST   /api/devoir/passage              {c, id, devoir, prenom, classe, etape…} → où il en est
 *
 * Routes réservées au rôle « prof » — le tableau de bord, et travail-maison.html :
 *   GET    /api/prof/tableau                tous les comptes + leur avancement résumé
 *   GET    /api/prof/presence               qui est connecté, et où (interrogé souvent)
 *   POST   /api/prof/classes                crée ou réordonne une classe
 *   PUT    /api/prof/classes/ordre          {ids} → remet les classes dans cet ordre
 *   DELETE /api/prof/classes/:id            supprime la classe, détache ses élèves
 *   POST   /api/prof/eleves                 crée un compte → mot de passe en clair, une fois
 *   GET    /api/prof/eleve/:id              fiche complète
 *   PATCH  /api/prof/eleve/:id              nom, prénom, classe, identifiant, actif
 *   DELETE /api/prof/eleve/:id              suppression définitive
 *   POST   /api/prof/eleve/:id/mdp          réinitialise le mot de passe
 *   PUT    /api/prof/eleve/:id/progression  débloque un niveau, corrige un avancement
 *   GET    /api/prof/annee                  règles de passage à l'année suivante
 *   PUT    /api/prof/annee/regles           {regles | null} → les enregistre (null : défaut)
 *   POST   /api/prof/annee                  {attendu, forcer?} → fait passer l'année
 *   GET    /api/prof/makecode/modeles       modèles de l'établissement, avec leurs classes
 *   PUT    /api/prof/makecode/modele        {source, nom, donnees, classes} → publie
 *   PATCH  /api/prof/makecode/modele/:id    {nom?, classes?}
 *   DELETE /api/prof/makecode/modele/:id    retire le modèle (les copies des élèves restent)
 *   GET    /api/prof/devoirs                code du lien + qui a fait le travail à la maison
 *   DELETE /api/prof/devoirs                {id} une ligne, ou {devoir, classe?} toute une série
 *
 * Routes réservées au rôle « admin » — la gestion des établissements. Ce compte est
 * délibérément distinct du compte enseignant : il crée les collèges et les comptes
 * professeurs, et ne voit AUCUN élève. Aucune route ci-dessous ne renvoie le nom d'un
 * élève, sa classe ou son avancement — seulement des décomptes.
 *   GET    /api/admin/etablissements        la liste, avec le nombre de comptes de chacun
 *   POST   /api/admin/etablissements        crée un établissement et ses classes de base
 *   PATCH  /api/admin/etablissements/:id    renomme, ferme ou rouvre
 *   DELETE /api/admin/etablissements/:id    refuse tant qu'il reste un compte
 *   GET    /api/admin/profs                 les comptes enseignants, tous établissements
 *   POST   /api/admin/profs                 crée un enseignant → mot de passe, une fois
 *   PATCH  /api/admin/profs/:id             nom, identifiant, établissement, actif
 *   DELETE /api/admin/profs/:id             suppression définitive
 *   POST   /api/admin/profs/:id/mdp         réinitialise le mot de passe
 */
import './env.js';
import http from 'node:http';
import crypto from 'node:crypto';
import * as db from './db.js';
import * as auth from './auth.js';
import { creerCompte, reinitialiserMdp, classeDeLEtablissement,
         poserClassesDeBase, IDENTIFIANT_OK,
         reglesDePassage, enregistrerPassage, passerAnneeSuivante } from './comptes.js';
import { verifierPolitique } from './motsdepasse.js';
import { VERSION, DEMARRE } from './version.js';

const PORT = Number(process.env.PORT || 8300);
/* alwaysdata impose d'écouter sur l'IP et le port qu'il fournit, et les expose sous
   les noms IP et PORT ; d'autres hébergeurs utilisent HOST. On accepte les trois. */
const HOTE = process.env.IP || process.env.HOST || '0.0.0.0';

/* Domaines autorisés à appeler l'API depuis un navigateur. « * » n'est accepté que si
   on le demande explicitement (pratique en développement, à proscrire en production). */
const ORIGINES = String(process.env.ORIGINES || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* Mêmes préfixes que scripts/store.js : le serveur ne stocke que ce qui appartient
   au jeu. Une clé qui n'entre pas dans cette liste est refusée, pas ignorée — mieux
   vaut une erreur visible qu'une progression qui disparaît en silence.
   ⚠ Les DEUX listes doivent rester jumelles : le client refuserait d'envoyer une clé
   que le serveur accepte, et inversement le serveur rejetterait tout un envoi pour
   une seule clé inconnue.
   `pc_` appartient à l'application « Le PC » (dépôt gregoirelecossois/le-pc), qui
   partage les mêmes comptes : même domaine de publication, donc même session. */
const PREFIXES = ['ms_', 'kb_', 'tt_', 'df_', 'nv_', 'ml_', 'pc_', 'badges_', 'a11y_'];
const CLE_OK = /^[a-z0-9_]{1,64}$/;

const SESSION_MS = 12 * 60 * 60 * 1000;   /* une journée de classe, largement */

/* Durée de conservation d'un compte élève (RGPD art. 5.1.e). Un compte vit jusqu'à la fin
   du cursus : c'est la « 🎓 Nouvelle année » qui supprime les comptes de 3e et de CAP2
   (comptes.js, passerAnneeSuivante). Ce délai-ci n'est que le PLAFOND, compté depuis la
   CRÉATION : une échéance connue d'avance, annonçable aux familles, qui rattrape les
   comptes oubliés — un élève parti en cours d'année, une nouvelle année jamais lancée.
   60 mois = les quatre années de collège et un redoublement. */
const CONSERVATION_MOIS = Number(process.env.CONSERVATION_MOIS || 60);

/* Durée de conservation du journal des connexions et des actions enseignantes. Il
   contient identifiants et adresses IP : douze mois, la durée usuelle pour des traces
   de connexion — assez pour expliquer un incident, pas davantage. */
const JOURNAL_MOIS = Number(process.env.JOURNAL_MOIS || 12);
const CORPS_MAX = 256 * 1024;
const VALEUR_MAX = 4096;
const CLES_MAX = 500;

/* Projets MakeCode. Un projet micro:bit compressé pèse 3 à 8 Ko ; 64 Ko en laisse dix
   fois plus, et reste sous la limite des envois « keepalive » du navigateur (64 Ko), ceux
   qui partent quand l'élève ferme l'onglet. Le rythme est réglé côté navigateur (un envoi
   par projet toutes les 30 s au plus) : MC_ECRITURES_MINUTE n'est que le filet d'une page
   qui se mettrait à boucler.
   MC_TABLE_MAX_MO protège tout le reste : l'hébergement gratuit a 100 Mo pour TOUT, et un
   disque plein ferait échouer aussi l'écriture des progressions des ateliers. Les projets
   s'arrêtent bien avant — les jeux, eux, continuent. */
const MC_PROJETS_MAX = Number(process.env.MC_PROJETS_MAX || 30);
const MC_TABLE_MAX_MO = Number(process.env.MC_TABLE_MAX_MO || 40);
const MC_PROJET_MAX = 64 * 1024;
const MC_ECRITURES_MINUTE = 30;
const MC_ID_OK = /^[A-Za-z0-9-]{8,64}$/;
/* Modèles proposés par les enseignants (voir modeles_makecode dans schema.sql). Ils
   comptent dans MC_TABLE_MAX_MO comme les projets. */
const MC_MODELES_MAX = Number(process.env.MC_MODELES_MAX || 60);
const MC_MODELE_NOM_MAX = 50;

/* Travail à la maison (voir devoirs_passages dans schema.sql). Ces routes sont les seules
   qui écrivent sans connexion : tout y est borné. DEVOIRS_MOIS est la durée de vie d'une
   ligne, comptée depuis la dernière activité — un devoir se regarde dans les semaines
   qui suivent, pas l'année d'après. DEVOIRS_MAX plafonne le nombre de lignes d'un
   établissement : au-delà, les nouveaux élèves ne sont plus enregistrés (leur page
   continue de fonctionner), ceux déjà inscrits continuent d'avancer. */
const DEVOIRS_MOIS = Number(process.env.DEVOIRS_MOIS || 12);
const DEVOIRS_MAX = Number(process.env.DEVOIRS_MAX || 3000);
const DEVOIR_APPELS_FENETRE = 10 * 60_000;
const DEVOIR_APPELS_MAX = 240;     /* par adresse IP : une classe entière derrière la même box du collège */
const DEVOIR_ID_OK = /^[A-Za-z0-9-]{16,64}$/;
const DEVOIR_NOM_OK = /^[a-z0-9-]{1,30}$/;
const DEVOIR_CODE_OK = /^[a-z0-9]{6,16}$/;
/* Un prénom : des lettres, et ce qui les relie. Pas de chiffre, pas de ponctuation — ce
   champ est le seul que l'élève tape, et il ne doit pas pouvoir devenir un commentaire. */
const DEVOIR_PRENOM_OK = /^\p{L}[\p{L} '’-]{0,23}$/u;

/* --------------------------------------------------------------------------
   Utilitaires HTTP
   -------------------------------------------------------------------------- */
function ip(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

function cors(req, res) {
  const origine = req.headers.origin;
  if (!origine) return;
  if (ORIGINES.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (ORIGINES.includes(origine)) res.setHeader('Access-Control-Allow-Origin', origine);
  else return;                                  /* origine inconnue : pas d'en-tête, le navigateur bloquera */
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function repondre(res, code, corps) {
  const txt = JSON.stringify(corps);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(txt),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(txt);
}

function lireCorps(req) {
  return new Promise((res, rej) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > CORPS_MAX) { rej(Object.assign(new Error('Requête trop volumineuse.'), { code: 413 })); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => {
      if (!morceaux.length) return res({});
      try { res(JSON.parse(Buffer.concat(morceaux).toString('utf8'))); }
      catch { rej(Object.assign(new Error('Corps de requête illisible.'), { code: 400 })); }
    });
    req.on('error', rej);
  });
}

class Refus extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* --------------------------------------------------------------------------
   Session
   -------------------------------------------------------------------------- */
async function session(req) {
  const brut = String(req.headers.authorization || '');
  const m = brut.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Refus(401, 'Connexion requise.');
  return sessionDuJeton(m[1]);
}

async function sessionDuJeton(jetonClair) {
  /* La session transporte l'établissement : toute route qui filtre le fait à partir
     d'ici, jamais d'un paramètre venu du client. Un établissement fermé (`actif` à
     faux) coupe l'accès sans rien effacer — les sessions en cours tombent au premier
     appel suivant, ce qu'il faut pour une fin de contrat. */
  const ligne = await db.une(
    `select s.jeton, s.expire_le, s.vue_le,
            c.id, c.identifiant, c.prenom, c.nom, c.role, c.doit_changer_mdp,
            c.etablissement_id, c.classe_id, cl.nom as classe, et.nom as etablissement
       from sessions s
       join comptes c  on c.id = s.compte_id
       left join classes cl on cl.id = c.classe_id
       left join etablissements et on et.id = c.etablissement_id
      where s.jeton = $1 and s.expire_le > now() and c.actif
        and (c.etablissement_id is null or et.actif)`,
    [auth.empreinte(jetonClair)]
  );
  if (!ligne) throw new Refus(401, 'Session expirée.');

  /* Glissement : tant que l'élève travaille, la session ne tombe pas au milieu
     d'une heure de cours. On n'écrit qu'une fois par demi-heure. */
  if (Date.now() - new Date(ligne.vue_le).getTime() > 30 * 60 * 1000) {
    await db.q(
      `update sessions set vue_le = now(), expire_le = now() + ($2 || ' milliseconds')::interval where jeton = $1`,
      [ligne.jeton, String(SESSION_MS)]
    );
  }
  return ligne;
}

/* `doitChangerMdp` voyage avec le profil, donc aussi bien dans la réponse de connexion
   que dans /api/moi : la fenêtre de création de mot de passe doit revenir tant que
   l'élève ne l'a pas menée au bout, y compris s'il recharge la page pour l'esquiver. */
function profil(l) {
  return { id: l.id, identifiant: l.identifiant, prenom: l.prenom, nom: l.nom, classe: l.classe, role: l.role,
           etablissement: l.etablissement || null,
           doitChangerMdp: !!l.doit_changer_mdp };
}

async function progressionDe(compteId) {
  const p = await db.une('select donnees, version from progressions where compte_id = $1', [compteId]);
  return { progression: p ? p.donnees : {}, version: p ? p.version : 0 };
}

/* --------------------------------------------------------------------------
   Routes
   -------------------------------------------------------------------------- */
async function connexion(req) {
  const corps = await lireCorps(req);
  const identifiant = String(corps.identifiant || '').trim().toLowerCase();
  const motdepasse = String(corps.motdepasse || '');
  const adresse = ip(req);

  if (!identifiant || !motdepasse) throw new Refus(400, 'Identifiant et mot de passe attendus.');
  if (auth.bloque(adresse, identifiant)) {
    throw new Refus(429, 'Trop de tentatives. Attends quelques minutes, puis réessaie.');
  }

  const c = await db.une(
    `select c.*, cl.nom as classe, et.nom as etablissement,
            coalesce(et.actif, true) as etablissement_actif
       from comptes c
       left join classes cl on cl.id = c.classe_id
       left join etablissements et on et.id = c.etablissement_id
      where c.identifiant = $1`, [identifiant]);

  /* Même message et même durée dans tous les cas d'échec : ni le contenu ni le
     temps de réponse ne doivent révéler qu'un identifiant existe — ni qu'il existe
     dans un établissement qu'on vient de fermer. */
  const bon = c && c.actif && c.etablissement_actif
    ? await auth.verifier(motdepasse, c.mdp) : await auth.perdreDuTemps();
  if (!bon) {
    auth.noterEchec(adresse, identifiant);
    await db.journaliser(identifiant, 'connexion.echec', null, { ip: adresse });
    throw new Refus(401, 'Identifiant ou mot de passe incorrect.');
  }

  auth.oublier(adresse, identifiant);
  const jeton = auth.nouveauJeton();

  await db.q('delete from sessions where expire_le < now()');
  await db.q(
    `insert into sessions(jeton, compte_id, expire_le) values ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [jeton.empreinte, c.id, String(SESSION_MS)]
  );
  await db.q('update comptes set derniere_connexion = now() where id = $1', [c.id]);
  await db.q('insert into progressions(compte_id) values ($1) on conflict do nothing', [c.id]);
  await db.journaliser(identifiant, 'connexion', null, { ip: adresse }, c.etablissement_id);

  const p = await progressionDe(c.id);
  /* `doitChangerMdp` est dans profil() : le client trouve la même information au même
     endroit après une connexion et après un /api/moi. */
  return { jeton: jeton.clair, eleve: profil(c), ...p };
}

async function deconnexion(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (m) await db.q('delete from sessions where jeton = $1', [auth.empreinte(m[1])]);
  return { ok: true };
}

async function moi(req) {
  const s = await session(req);
  return { eleve: profil(s), ...(await progressionDe(s.id)) };
}

/* POST /api/mdp — l'élève (ou l'enseignant) choisit LUI-MÊME son mot de passe.
 *
 * Le mot de passe fabriqué par le tableau de bord est temporaire par construction : il
 * a été imprimé, lu à voix haute, recopié sur un cahier. Tant que `doit_changer_mdp`
 * est vrai, l'empreinte en base ne protège donc rien du tout ; c'est cette route qui
 * ferme la parenthèse.
 *
 * Le mot de passe actuel n'est redemandé QUE s'il s'agit d'un changement volontaire.
 * À la première connexion l'élève vient tout juste de s'authentifier avec, et le lui
 * refaire taper à 11 ans est surtout un bon moyen de le bloquer à la porte.
 */
async function changerMonMdp(req) {
  const s = await session(req);
  const corps = await lireCorps(req);
  const nouveau = String(corps.nouveau || '');
  const adresse = ip(req);

  const c = await db.une('select mdp from comptes where id = $1', [s.id]);
  if (!c) throw new Refus(401, 'Session expirée.');

  if (!s.doit_changer_mdp) {
    const ancien = String(corps.ancien || '');
    if (auth.bloque(adresse, s.identifiant)) {
      throw new Refus(429, 'Trop de tentatives. Attends quelques minutes, puis réessaie.');
    }
    if (!ancien || !(await auth.verifier(ancien, c.mdp))) {
      auth.noterEchec(adresse, s.identifiant);
      throw new Refus(401, 'Mot de passe actuel incorrect.');
    }
    auth.oublier(adresse, s.identifiant);
  }

  try { verifierPolitique(nouveau); } catch (e) { throw new Refus(400, e.message); }
  if (await auth.verifier(nouveau, c.mdp)) {
    throw new Refus(400, 'Choisis un mot de passe différent de celui que tu avais.');
  }

  await db.q('update comptes set mdp = $2, doit_changer_mdp = false where id = $1',
    [s.id, await auth.hacher(nouveau)]);
  /* Toutes les autres sessions tombent — sauf celle qui vient de faire le changement,
     sinon l'élève serait déconnecté juste après avoir choisi son mot de passe. */
  await db.q('delete from sessions where compte_id = $1 and jeton <> $2', [s.id, s.jeton]);
  /* Le journal note QUE le mot de passe a changé, jamais sa valeur ni sa forme. */
  await db.journaliser(s.identifiant, 'compte.mdp.choisi', null, { ip: adresse }, s.etablissement_id);

  return { ok: true, eleve: { ...profil(s), doitChangerMdp: false } };
}

async function ecrireProgression(req) {
  const s = await session(req);
  return appliquerProgression(s.id, await lireCorps(req));
}

/* Le même chemin d'écriture sert à l'élève qui joue et à l'enseignant qui débloque un
   niveau depuis le tableau de bord : mêmes contrôles de clé, même fusion, aucune porte
   dérobée qui accepterait des clés que l'autre refuse. */
async function appliquerProgression(compteId, corps) {
  const majs = corps.majs && typeof corps.majs === 'object' ? corps.majs : {};
  const suppressions = Array.isArray(corps.suppressions) ? corps.suppressions : [];

  const propre = {};
  for (const [k, v] of Object.entries(majs)) {
    verifierCle(k);
    const val = String(v);
    if (val.length > VALEUR_MAX) throw new Refus(413, `Valeur trop longue pour « ${k} ».`);
    propre[k] = val;
  }
  for (const k of suppressions) verifierCle(String(k));

  if (Object.keys(propre).length > CLES_MAX) throw new Refus(413, 'Trop de clés en une fois.');
  if (!Object.keys(propre).length && !suppressions.length) {
    return { version: (await progressionDe(compteId)).version };
  }

  const r = await db.une(
    `insert into progressions(compte_id, donnees, version, maj_le)
          values ($1, $2::jsonb, 1, now())
     on conflict (compte_id) do update
        set donnees = (progressions.donnees || $2::jsonb) - $3::text[],
            version = progressions.version + 1,
            maj_le  = now()
      returning version`,
    [compteId, JSON.stringify(propre), suppressions.map(String)]
  );
  return { version: r.version };
}

function verifierCle(k) {
  if (!CLE_OK.test(k)) throw new Refus(400, `Clé refusée : « ${k} ».`);
  if (!PREFIXES.some((p) => k.startsWith(p))) throw new Refus(400, `Clé hors périmètre : « ${k} ».`);
}

/* `version` est l'empreinte du code qui tourne réellement (cf. version.js) : après
   un redéploiement, elle dit en un coup d'œil si le nouveau code a bien été repris,
   sans avoir à deviner d'après le comportement de l'application. */
async function sante() {
  await db.q('select 1');
  return {
    ok: true,
    service: 'atelier-informatique',
    version: VERSION,
    demarre: DEMARRE,
    heure: new Date().toISOString()
  };
}

/* --------------------------------------------------------------------------
   Purge automatique
   Une durée de conservation qui dépend d'une commande qu'on pense à lancer n'est
   pas une durée de conservation. Le serveur s'en charge : au démarrage, puis une
   fois par jour. Chaque passage laisse une trace dans le journal.
   -------------------------------------------------------------------------- */
async function purgerComptesExpires() {
  try {
    const r = await db.q(
      `delete from comptes
        where role = 'eleve' and cree_le < now() - ($1 || ' months')::interval
        returning identifiant, etablissement_id`,
      [String(CONSERVATION_MOIS)]);
    if (!r.rowCount) return;
    /* Une ligne de journal PAR établissement, et non une seule pour tout le monde :
       un chef d'établissement qui demande ce qui a été effacé chez lui doit pouvoir
       l'obtenir sans qu'on lui montre les identifiants des autres collèges. */
    const parEtab = new Map();
    for (const l of r.rows) {
      if (!parEtab.has(l.etablissement_id)) parEtab.set(l.etablissement_id, []);
      parEtab.get(l.etablissement_id).push(l.identifiant);
    }
    for (const [etab, identifiants] of parEtab) {
      await db.journaliser('systeme', 'comptes.purge', null, {
        mois: CONSERVATION_MOIS,
        supprimes: identifiants.length,
        identifiants: identifiants.slice(0, 200)
      }, etab);
    }
    console.log(`[api] purge : ${r.rowCount} compte(s) élève au-delà de ${CONSERVATION_MOIS} mois`);
  } catch (e) {
    console.error('[api] purge impossible :', e.message);
  }
}

/* Le journal garde l'identifiant et l'adresse IP de chaque connexion : ce sont des
   données personnelles, elles ne peuvent pas être conservées indéfiniment. Douze mois
   est la durée usuelle pour des traces de connexion — assez pour expliquer un incident,
   pas davantage. La suppression d'un compte n'emporte PAS son journal (c'est le but :
   une trace qui disparaît avec ce qu'elle documente ne trace rien), d'où cette purge
   séparée, sur l'âge de la ligne. */
async function purgerJournal() {
  try {
    const r = await db.q(
      `delete from journal where ts < now() - ($1 || ' months')::interval`,
      [String(JOURNAL_MOIS)]);
    if (r.rowCount) console.log(`[api] journal : ${r.rowCount} ligne(s) au-delà de ${JOURNAL_MOIS} mois`);
  } catch (e) {
    console.error('[api] purge du journal impossible :', e.message);
  }
}

/* --------------------------------------------------------------------------
   Présence
   Un battement toutes les 45 secondes tant que l'onglet de l'élève est visible.
   On écrase la ligne précédente : savoir où en est un élève MAINTENANT sert à
   l'aider tout de suite ; garder la trace de ses allées et venues serait une
   collecte sans finalité.

   Deux façons de disparaître du tableau de bord :
     - le départ annoncé — l'élève ferme l'onglet ou passe à autre chose, le
       navigateur envoie {parti:true} et la ligne s'efface tout de suite ;
     - la péremption — plus de battement pendant PRESENCE_MINUTES, ce qui couvre
       la coupure de réseau, le téléphone qui s'éteint, l'onglet tué de force.
   Sans le premier, un élève parti restait « en ce moment » jusqu'à la fin du
   délai : le tableau affichait quelqu'un au travail alors qu'il était sorti.
   -------------------------------------------------------------------------- */
const PRESENCE_MINUTES = 2;   /* tolère un battement manqué, pas davantage */

/* sendBeacon ne sait pas poser d'en-tête Authorization : pour le seul message de
   départ, on accepte donc le jeton dans le corps. Aucune faiblesse ajoutée — c'est le
   même secret, présenté autrement, et sans cookie il n'y a pas de surface CSRF. On le
   limite quand même à cette route, la moins sensible de toutes. */
async function battement(req) {
  const corps = await lireCorps(req);
  const s = corps.jeton && !req.headers.authorization
    ? await sessionDuJeton(String(corps.jeton))
    : await session(req);

  if (corps.parti) {
    await db.q('delete from presence where compte_id = $1', [s.id]);
    return { ok: true };
  }

  const entier = (v, max) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  await db.q(
    `insert into presence(compte_id, atelier, niveau, mission, vu_le) values ($1,$2,$3,$4, now())
     on conflict (compte_id) do update
        set atelier = excluded.atelier, niveau = excluded.niveau,
            mission = excluded.mission, vu_le = now()`,
    [s.id, corps.atelier ? String(corps.atelier).slice(0, 40) : null,
     entier(corps.niveau, 99), entier(corps.mission, 999)]);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Projets MakeCode
   makecode.html affiche l'éditeur officiel (makecode.microbit.org) en mode
   « contrôleur » : c'est la page, et non Microsoft, qui garde les projets. Elle les
   compresse avant l'envoi ; le serveur les range tels quels, sans les ouvrir.
   Tables et routes à part : rien ici ne touche à `progressions`, et un refus sur un
   projet (quota, place) ne peut pas faire échouer une sauvegarde de jeu.
   -------------------------------------------------------------------------- */
const mcRythmes = new Map();   /* compte_id → { debut, n } sur une fenêtre d'une minute */

function mcRythme(compteId) {
  const maintenant = Date.now();
  let r = mcRythmes.get(compteId);
  if (!r || maintenant - r.debut > 60_000) { r = { debut: maintenant, n: 0 }; mcRythmes.set(compteId, r); }
  if (++r.n > MC_ECRITURES_MINUTE) throw new Refus(429, 'Trop de sauvegardes d\'un coup. Réessaie dans une minute.');
}
setInterval(() => {
  const limite = Date.now() - 60_000;
  for (const [k, r] of mcRythmes) if (r.debut < limite) mcRythmes.delete(k);
}, 10 * 60_000).unref();

/* La taille de la table n'est mesurée qu'une fois par minute : une requête de plus à
   chaque sauvegarde pour un chiffre qui bouge de quelques kilo-octets, c'est du gâchis. */
let mcOccupation = { octets: 0, mesure: 0 };
async function mcPlace() {
  if (Date.now() - mcOccupation.mesure > 60_000) {
    const r = await db.une(`select pg_total_relation_size('projets_makecode')
                                 + pg_total_relation_size('modeles_makecode') as n`);
    mcOccupation = { octets: Number(r.n), mesure: Date.now() };
  }
  if (mcOccupation.octets > MC_TABLE_MAX_MO * 1024 * 1024) {
    console.error(`[api] projets MakeCode : ${MC_TABLE_MAX_MO} Mo atteints, écritures refusées`);
    throw new Refus(507, 'L\'espace réservé aux projets MakeCode est plein. Ton projet reste sur ce poste : préviens ton professeur.');
  }
}

function mcId(corps) {
  const id = String(corps.id || '');
  if (!MC_ID_OK.test(id)) throw new Refus(400, 'Identifiant de projet invalide.');
  return id;
}

async function mcLister(req) {
  const s = await session(req);
  const r = await db.q(
    'select id, donnees, maj_le from projets_makecode where compte_id = $1 order by maj_le desc', [s.id]);
  return { projets: r.rows, max: MC_PROJETS_MAX };
}

/* Le quota se vérifie DANS l'insertion : un projet déjà en ligne se met toujours à jour,
   un nouveau n'entre que s'il reste de la place. Aucune ligne renvoyée = quota atteint. */
async function mcEcrire(req) {
  const s = await session(req);
  const corps = await lireCorps(req);
  const id = mcId(corps);
  const donnees = String(corps.donnees || '');
  if (!/^(gz|js):/.test(donnees)) throw new Refus(400, 'Projet illisible.');
  if (donnees.length > MC_PROJET_MAX) {
    throw new Refus(413, 'Ce projet est trop gros pour être sauvegardé en ligne. Il reste gardé sur ce poste.');
  }
  mcRythme(s.id);
  await mcPlace();

  const r = await db.une(
    `insert into projets_makecode(compte_id, id, donnees)
     select $1, $2, $3
      where exists (select 1 from projets_makecode where compte_id = $1 and id = $2)
         or (select count(*) from projets_makecode where compte_id = $1) < $4
     on conflict (compte_id, id) do update set donnees = excluded.donnees, maj_le = now()
     returning maj_le`,
    [s.id, id, donnees, MC_PROJETS_MAX]);
  if (!r) {
    throw new Refus(409, `Tu as déjà ${MC_PROJETS_MAX} projets en ligne : supprime ceux dont tu n'as plus besoin.`);
  }
  return { maj_le: r.maj_le };
}

async function mcSupprimer(req) {
  const s = await session(req);
  const id = mcId(await lireCorps(req));
  mcRythme(s.id);
  await db.q('delete from projets_makecode where compte_id = $1 and id = $2', [s.id, id]);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Modèles MakeCode
   Un enseignant propose un de ses projets à des classes ; l'élève le voit dans
   « Nouveau projet » et en part pour créer sa propre copie (côté navigateur, avec un
   nouvel identifiant). Le serveur ne recopie rien chez l'élève : il sert le modèle,
   c'est tout. Comme les projets, les modèles voyagent compressés et ne sont pas ouverts.
   -------------------------------------------------------------------------- */

/* Ce qu'un compte a le droit de voir : un élève, les modèles proposés à SA classe ; un
   enseignant, tous ceux de son établissement (pour tester ce que voient les élèves, ou
   partir du modèle d'un collègue). Un administrateur n'appartient à aucun collège. */
function mcModelesVisibles(s) {
  if (s.role === 'prof' && s.etablissement_id) {
    return { ou: 'm.etablissement_id = $1', params: [s.etablissement_id] };
  }
  if (s.role === 'eleve' && s.etablissement_id && s.classe_id) {
    return {
      ou: `m.etablissement_id = $1 and exists (select 1 from modeles_makecode_classes mc
                                                where mc.modele_id = m.id and mc.classe_id = $2)`,
      params: [s.etablissement_id, s.classe_id]
    };
  }
  return null;
}

async function mcModeles(req) {
  const s = await session(req);
  const v = mcModelesVisibles(s);
  if (!v) return { modeles: [] };
  const r = await db.q(
    `select m.id, m.nom, m.maj_le from modeles_makecode m where ${v.ou} order by lower(m.nom), m.id`, v.params);
  return { modeles: r.rows };
}

async function mcModele(req, params) {
  const s = await session(req);
  const v = mcModelesVisibles(s);
  const l = v && await db.une(
    `select m.id, m.nom, m.donnees from modeles_makecode m where m.id = $${v.params.length + 1} and ${v.ou}`,
    [...v.params, Number(params.id)]);
  if (!l) throw new Refus(404, 'Ce modèle n\'est plus proposé. Demande à ton professeur.');
  return l;
}

/* La liste complète, pour le panneau de l'enseignant : chaque modèle avec ses classes,
   et les classes de l'établissement pour les cases à cocher. */
async function lesModeles(etablissementId) {
  const r = await db.q(
    `select m.id, m.source, m.nom, m.maj_le,
            nullif(trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')), '') as auteur,
            coalesce(array_agg(mc.classe_id) filter (where mc.classe_id is not null), '{}') as classes
       from modeles_makecode m
       left join comptes a on a.id = m.auteur_id
       left join modeles_makecode_classes mc on mc.modele_id = m.id
      where m.etablissement_id = $1
      group by m.id, a.prenom, a.nom
      order by lower(m.nom), m.id`,
    [etablissementId]);
  return r.rows;
}

async function profModelesListe(s) {
  return { modeles: await lesModeles(s.etablissement_id), classes: await lesClasses(s.etablissement_id),
           max: MC_MODELES_MAX };
}

async function profModeles(req) {
  return profModelesListe(await sessionProf(req));
}

function nomDeModele(v) {
  const nom = String(v || '').replace(/\s+/g, ' ').trim().slice(0, MC_MODELE_NOM_MAX);
  if (!nom) throw new Refus(400, 'Donne un nom au modèle.');
  return nom;
}

/* Les classes cochées, vérifiées UNE PAR UNE contre l'établissement de l'enseignant :
   une classe d'un autre collège est « introuvable », comme partout ailleurs. */
async function classesDuModele(s, liste) {
  if (!Array.isArray(liste)) throw new Refus(400, 'Liste de classes invalide.');
  const ids = [...new Set(liste.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new Refus(400, 'Liste de classes invalide.');
  if (!ids.length) return ids;
  const r = await db.q('select id from classes where etablissement_id = $1 and id = any($2::int[])',
    [s.etablissement_id, ids]);
  if (r.rows.length !== ids.length) throw new Refus(404, 'Classe introuvable.');
  return ids;
}

async function poserClassesDuModele(client, modeleId, classes) {
  await client.query('delete from modeles_makecode_classes where modele_id = $1', [modeleId]);
  if (classes.length) {
    await client.query(
      `insert into modeles_makecode_classes(modele_id, classe_id)
       select $1, unnest($2::int[])`, [modeleId, classes]);
  }
}

/* Publier, ou republier : le même projet (même `source`) met à jour son modèle — nouveau
   contenu, nouveau nom, nouvelles classes. Les copies déjà faites par les élèves ne
   bougent pas : elles leur appartiennent. */
async function profPublierModele(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  const source = String(corps.source || '');
  if (!MC_ID_OK.test(source)) throw new Refus(400, 'Identifiant de projet invalide.');
  const nom = nomDeModele(corps.nom);
  const donnees = String(corps.donnees || '');
  if (!/^(gz|js):/.test(donnees)) throw new Refus(400, 'Projet illisible.');
  if (donnees.length > MC_PROJET_MAX) throw new Refus(413, 'Ce projet est trop gros pour devenir un modèle.');
  const classes = await classesDuModele(s, corps.classes);
  mcRythme(s.id);
  await mcPlace();

  await db.transaction(async (client) => {
    const r = await client.query(
      `insert into modeles_makecode(etablissement_id, auteur_id, source, nom, donnees)
       select $1, $2, $3, $4, $5
        where exists (select 1 from modeles_makecode where etablissement_id = $1 and source = $3)
           or (select count(*) from modeles_makecode where etablissement_id = $1) < $6
       on conflict (etablissement_id, source)
         do update set nom = excluded.nom, donnees = excluded.donnees, auteur_id = excluded.auteur_id, maj_le = now()
       returning id`,
      [s.etablissement_id, s.id, source, nom, donnees, MC_MODELES_MAX]);
    if (!r.rows[0]) {
      throw new Refus(409, `Ton établissement a déjà ${MC_MODELES_MAX} modèles : retire ceux qui ne servent plus.`);
    }
    await poserClassesDuModele(client, r.rows[0].id, classes);
  });
  await db.journaliser(s.identifiant, 'makecode.modele.publication', nom, { classes }, s.etablissement_id);
  return profModelesListe(s);
}

async function modeleDuProf(s, id) {
  const l = await db.une('select id, nom from modeles_makecode where id = $1 and etablissement_id = $2',
    [Number(id), s.etablissement_id]);
  if (!l) throw new Refus(404, 'Modèle introuvable.');
  return l;
}

/* Renommer, ou changer les classes, sans toucher au contenu — c'est ce qui reste
   possible quand l'enseignant a supprimé le projet d'origine. */
async function profModifierModele(req, params) {
  const s = await sessionProf(req);
  const m = await modeleDuProf(s, params.id);
  const corps = await lireCorps(req);
  const nom = 'nom' in corps ? nomDeModele(corps.nom) : null;
  const classes = 'classes' in corps ? await classesDuModele(s, corps.classes) : null;
  await db.transaction(async (client) => {
    if (nom) await client.query('update modeles_makecode set nom = $2 where id = $1', [m.id, nom]);
    if (classes) await poserClassesDuModele(client, m.id, classes);
  });
  await db.journaliser(s.identifiant, 'makecode.modele.modification', nom || m.nom,
    classes ? { classes } : null, s.etablissement_id);
  return profModelesListe(s);
}

async function profRetirerModele(req, params) {
  const s = await sessionProf(req);
  const m = await modeleDuProf(s, params.id);
  await db.q('delete from modeles_makecode where id = $1', [m.id]);
  await db.journaliser(s.identifiant, 'makecode.modele.retrait', m.nom, null, s.etablissement_id);
  return profModelesListe(s);
}

/* --------------------------------------------------------------------------
   Espace enseignant
   -------------------------------------------------------------------------- */
/* Toute route enseignante commence ici, et la portée qu'elle renvoie — s.etablissement_id
   — est la SEULE source de l'établissement pour les requêtes qui suivent. Rien de ce que
   le client envoie ne peut l'élargir : ni un identifiant de classe, ni un identifiant
   d'élève, ni une liste d'identifiants. Le second contrôle double la contrainte de base
   (`comptes_etablissement_check`) : si elle sautait, on refuserait ici plutôt que de
   servir un `where etablissement_id = null` qui, lui, ne renverrait rien mais laisserait
   croire à un établissement vide. */
async function sessionProf(req) {
  const s = await session(req);
  if (s.role !== 'prof') throw new Refus(403, 'Réservé aux enseignants.');
  if (!s.etablissement_id) throw new Refus(403, 'Compte enseignant sans établissement.');
  return s;
}

/* Retrouve un compte DANS l'établissement de l'enseignant, et nulle part ailleurs.
   Un compte d'un autre collège est « introuvable » et non « interdit » : distinguer les
   deux réponses laisserait énumérer les comptes des voisins en essayant des numéros. */
async function compteDuProf(s, id) {
  const l = await db.une(
    `select c.id, c.identifiant, c.prenom, c.nom, c.role, c.actif, c.cree_le,
            c.derniere_connexion, c.doit_changer_mdp, c.classe_id, cl.nom as classe
       from comptes c left join classes cl on cl.id = c.classe_id
      where c.id = $1 and c.etablissement_id = $2`,
    [Number(id), s.etablissement_id]);
  if (!l) throw new Refus(404, 'Compte introuvable.');
  return l;
}

/* Un enseignant gère les ÉLÈVES de son établissement, jamais les comptes de ses
   collègues : réinitialiser le mot de passe d'un autre professeur, c'est prendre sa
   place. Ces comptes-là appartiennent à l'espace administrateur. Cette seule règle
   remplace les deux garde-fous d'avant (« on ne se désactive pas soi-même », « on ne
   supprime pas son propre compte ») : un enseignant n'est pas un élève, il ne peut
   donc plus se viser lui-même. */
function eleveSeulement(l) {
  if (l.role !== 'eleve') {
    throw new Refus(403, 'Les comptes enseignants se gèrent depuis l\'espace administrateur.');
  }
  return l;
}

const PREFIXES_JEU = ['ms', 'kb', 'tt', 'df', 'nv', 'ml'];

/* Résumé compact. Le serveur ignore volontairement la structure des jeux — c'est
   scripts/ateliers.js, côté navigateur, qui sait combien de niveaux compte chaque
   atelier. Ici on extrait seulement les nombres, ce qui évite d'expédier la
   progression complète de trois cents élèves à chaque rafraîchissement. */
function resumer(l) {
  const d = l.donnees || {};

  let badges = {};
  try { badges = JSON.parse(d.badges_v1 || '{}') || {}; } catch { /* progression illisible */ }

  const niveaux = {};
  for (const p of PREFIXES_JEU) {
    const courant = parseInt(d[p + '_curlevel'] || '1', 10) || 1;
    niveaux[p] = {
      u: parseInt(d[p + '_unlocked'] || '1', 10) || 1,
      c: courant,
      s: parseInt(d[p + '_step_l' + courant] || '0', 10) || 0,
      /* Terminer le DERNIER niveau ne fait pas monter *_unlocked : les ateliers passent
         directement à leur écran de fin. Le trophée d'atelier est donc le seul signal
         fiable de « tout fini » — sans lui, un élève complet plafonnerait à 6/7. */
      fini: !!badges[p + '.master']
    };
  }
  const trophees = Object.keys(badges).length;

  return {
    id: l.id, identifiant: l.identifiant, prenom: l.prenom, nom: l.nom,
    classe: l.classe, classe_id: l.classe_id, role: l.role, actif: l.actif,
    cree_le: l.cree_le, derniere_connexion: l.derniere_connexion,
    niveaux, trophees, pc: resumerLePc(d)
  };
}

/* « Le PC » n'est PAS un septième atelier : c'est une application à part, avec ses
 * chapitres et ses étoiles, et le tableau de bord l'affiche à côté des six, séparément.
 * Sa progression n'a donc pas la forme <p>_curlevel / <p>_step_l<n> que lit la boucle
 * ci-dessus — c'est un seul objet JSON, écrit par zustand.
 *
 * On en tire des COMPTES, jamais des pourcentages : le serveur ignore volontairement
 * combien l'application a de chapitres, comme il ignore le contenu des six ateliers.
 * Les totaux vivent dans scripts/ateliers.js, côté client, où ils sont déjà tenus.
 *
 * Renvoie null si l'élève n'y a jamais joué — le tableau de bord grise la colonne
 * plutôt que d'afficher un zéro qui ressemble à un échec.
 */
function resumerLePc(d) {
  try {
    const s = JSON.parse(d.pc_progression || 'null')?.state;
    if (!s) return null;
    const res = s.results && typeof s.results === 'object' ? s.results : {};
    const finis = Object.values(res).filter((r) => r && r.done);
    return {
      faits: finis.length,
      etoiles: finis.reduce((t, r) => t + (Number(r.stars) || 0), 0),
      fiches: Array.isArray(s.discovered) ? s.discovered.length : 0,
      badges: Array.isArray(s.badges) ? s.badges.length : 0,
      xp: Number(s.xp) || 0
    };
  } catch {
    return null;   /* progression illisible : comme si elle n'existait pas */
  }
}

async function lesClasses(etablissementId) {
  return (await db.q(
    'select id, nom, ordre from classes where etablissement_id = $1 order by ordre, nom',
    [etablissementId])).rows;
}

/* Une seule requête pour peindre tout le tableau. Rechargée toutes les 30 s. */
async function profTableau(req) {
  const s = await sessionProf(req);
  const r = await db.q(
    `select c.id, c.identifiant, c.prenom, c.nom, c.role, c.actif, c.cree_le, c.derniere_connexion,
            cl.id as classe_id, cl.nom as classe,
            coalesce(p.donnees, '{}'::jsonb) as donnees
       from comptes c
       left join classes cl on cl.id = c.classe_id
       left join progressions p on p.compte_id = c.id
      where c.etablissement_id = $1
      order by cl.ordre nulls last, cl.nom, c.nom, c.prenom`, [s.etablissement_id]);
  return { eleves: r.rows.map(resumer), classes: await lesClasses(s.etablissement_id),
           etablissement: s.etablissement };
}

/* Volontairement minuscule : c'est CE qui est interrogé toutes les 10 s. */
async function profPresence(req) {
  const s = await sessionProf(req);
  const r = await db.q(
    `select p.compte_id, p.atelier, p.niveau, p.mission, p.vu_le
       from presence p join comptes c on c.id = p.compte_id
      where c.etablissement_id = $2
        and p.vu_le > now() - ($1 || ' minutes')::interval`,
    [String(PRESENCE_MINUTES), s.etablissement_id]);
  return { presents: r.rows, maintenant: new Date().toISOString() };
}

async function profEleve(req, params) {
  const s = await sessionProf(req);
  const l = await compteDuProf(s, params.id);
  return { eleve: l, ...(await progressionDe(l.id)) };
}

/* Le rôle n'est plus lu dans le corps de la requête : le tableau de bord ne crée que des
   élèves, et un compte enseignant se crée depuis l'espace administrateur. Un rôle accepté
   ici aurait permis à un professeur de se fabriquer des collègues — et, une fois la route
   connue, à n'importe qui d'en fabriquer chez lui. `creerCompte` vérifie que la classe
   demandée appartient bien à cet établissement. */
async function profCreerEleve(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  try {
    const c = await creerCompte({
      prenom: String(corps.prenom || '').trim(),
      nom: String(corps.nom || '').trim(),
      classe_id: corps.classe_id != null ? Number(corps.classe_id) : undefined,
      classe: corps.classe,
      etablissement_id: s.etablissement_id,
      role: 'eleve',
      acteur: s.identifiant
    });
    return c;                       /* contient le mot de passe en clair, une seule fois */
  } catch (e) {
    throw new Refus(400, e.message);
  }
}

async function profModifierEleve(req, params) {
  const s = await sessionProf(req);
  const id = Number(params.id);
  const corps = await lireCorps(req);

  const cible = eleveSeulement(await compteDuProf(s, id));

  const champs = [], valeurs = [];
  const poser = (col, val) => { champs.push(`${col} = $${champs.length + 2}`); valeurs.push(val); };

  if (typeof corps.prenom === 'string' && corps.prenom.trim()) poser('prenom', corps.prenom.trim().slice(0, 60));
  if (typeof corps.nom === 'string' && corps.nom.trim()) poser('nom', corps.nom.trim().slice(0, 60));
  if ('classe_id' in corps) {
    /* Un identifiant de classe vient du client : on ne le pose qu'après avoir vérifié
       qu'il désigne une classe de CET établissement. Sans ce contrôle, changer un nombre
       dans la requête suffisait à ranger un élève dans la classe d'un autre collège —
       il disparaissait alors du tableau de bord de son propre professeur. */
    try {
      poser('classe_id', corps.classe_id == null
        ? null : await classeDeLEtablissement(corps.classe_id, s.etablissement_id));
    } catch (e) { throw new Refus(400, e.message); }
  }

  if (typeof corps.identifiant === 'string') {
    const id2 = corps.identifiant.trim().toLowerCase();
    if (!IDENTIFIANT_OK.test(id2)) {
      throw new Refus(400, 'Identifiant : minuscules, chiffres, point et tiret, 2 à 31 caractères.');
    }
    const pris = await db.une('select 1 from comptes where identifiant = $1 and id <> $2', [id2, id]);
    if (pris) throw new Refus(409, `L'identifiant « ${id2} » est déjà pris.`);
    poser('identifiant', id2);
  }

  if ('actif' in corps) {
    poser('actif', !!corps.actif);
    if (!corps.actif) await db.q('delete from sessions where compte_id = $1', [id]);
  }

  if (!champs.length) throw new Refus(400, 'Rien à modifier.');
  await db.q(`update comptes set ${champs.join(', ')} where id = $1`, [id, ...valeurs]);
  await db.journaliser(s.identifiant, 'compte.modification', cible.identifiant, corps, s.etablissement_id);
  return { ok: true };
}

async function profMdpEleve(req, params) {
  const s = await sessionProf(req);
  const cible = eleveSeulement(await compteDuProf(s, params.id));
  return reinitialiserMdp(cible.identifiant, { acteur: s.identifiant });
}

async function profSupprimerEleve(req, params) {
  const s = await sessionProf(req);
  const cible = eleveSeulement(await compteDuProf(s, params.id));
  await db.q('delete from comptes where id = $1', [cible.id]);
  await db.journaliser(s.identifiant, 'compte.suppression', cible.identifiant, null, s.etablissement_id);
  return { ok: true };
}

/* Déblocage d'un niveau depuis le tableau de bord : c'est une écriture de progression
   comme une autre, avec les mêmes contrôles de clé — et une trace au journal, parce
   qu'un avancement modifié par l'enseignant doit pouvoir s'expliquer. */
async function profProgressionEleve(req, params) {
  const s = await sessionProf(req);
  const cible = eleveSeulement(await compteDuProf(s, params.id));
  const corps = await lireCorps(req);
  const r = await appliquerProgression(cible.id, corps);
  await db.journaliser(s.identifiant, 'progression.modification', cible.identifiant,
    { majs: corps.majs || {}, suppressions: corps.suppressions || [] }, s.etablissement_id);
  return r;
}

/* « 6eB » n'est unique que dans son établissement : le conflit se lit maintenant sur le
   couple (établissement, nom en minuscules), qui est exactement l'index unique de la
   base. Avec l'ancienne unicité globale, deux collèges n'auraient pas pu avoir chacun
   une 6eB — le second aurait réordonné celle du premier en croyant créer la sienne. */
async function profCreerClasse(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  const nom = String(corps.nom || '').trim().slice(0, 30);
  if (!nom) throw new Refus(400, 'Nom de classe attendu.');
  await db.q(
    `insert into classes(nom, ordre, etablissement_id) values ($1,$2,$3)
     on conflict (etablissement_id, lower(nom)) do update set ordre = excluded.ordre`,
    [nom, Number(corps.ordre || 0), s.etablissement_id]);
  await db.journaliser(s.identifiant, 'classe.enregistrement', nom, null, s.etablissement_id);
  return { classes: await lesClasses(s.etablissement_id) };
}

/* Remise en ordre des classes, d'un seul coup : le tableau de bord envoie la liste des
   identifiants dans l'ordre voulu, et leur RANG est leur position. Une requête plutôt
   qu'une par classe — un glisser-déposer déplace potentiellement tout le monde, et une
   série d'appels laisserait un ordre à moitié écrit si l'un d'eux échoue. */
async function profOrdreClasses(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  const ids = Array.isArray(corps.ids)
    ? [...new Set(corps.ids.map(Number).filter(Number.isInteger))] : [];
  if (!ids.length) throw new Refus(400, 'Liste d\'identifiants de classes attendue.');
  if (ids.length > 200) throw new Refus(413, 'Trop de classes en une fois.');

  /* C'est la route la plus exposée de toutes : elle reçoit une liste brute de nombres,
     sans rien qui rattache ces nombres à qui que ce soit. On refuse le lot entier dès
     qu'un seul identifiant sort de l'établissement, plutôt que de laisser le `where`
     ci-dessous ignorer les intrus en silence : un rangement à moitié appliqué serait
     tout aussi faux, mais invisible. Le décompte suffit parce que la liste est
     dédoublonnée juste au-dessus. */
  const n = await db.une(
    'select count(*)::int as n from classes where etablissement_id = $1 and id = any($2::int[])',
    [s.etablissement_id, ids]);
  if (n.n !== ids.length) throw new Refus(404, 'Classe introuvable dans cet établissement.');

  /* `with ordinality` : PostgreSQL numérote lui-même les éléments du tableau, ce qui
     évite d'assembler une requête à rallonge — et de la refaire à chaque classe. */
  await db.q(
    `update classes set ordre = v.rang
       from unnest($1::int[]) with ordinality as v(id, rang)
      where classes.id = v.id and classes.etablissement_id = $2`,
    [ids, s.etablissement_id]);
  await db.journaliser(s.identifiant, 'classes.ordre', null, { ids }, s.etablissement_id);
  return { classes: await lesClasses(s.etablissement_id) };
}

/* Supprimer une classe ne supprime AUCUN élève : `comptes.classe_id` est en
   « on delete set null », les comptes basculent simplement en « Sans classe » avec
   toute leur progression. C'est ce que le tableau de bord annonce avant de demander
   confirmation, et c'est ce que le journal doit refléter — d'où le décompte. */
async function profSupprimerClasse(req, params) {
  const s = await sessionProf(req);
  const id = Number(params.id);
  const cible = await db.une('select nom from classes where id = $1 and etablissement_id = $2',
    [id, s.etablissement_id]);
  if (!cible) throw new Refus(404, 'Classe introuvable.');
  const n = await db.une('select count(*)::int as n from comptes where classe_id = $1', [id]);
  await db.q('delete from classes where id = $1', [id]);
  await db.journaliser(s.identifiant, 'classe.suppression', cible.nom, { detaches: n.n }, s.etablissement_id);
  return { ok: true, detaches: n.n, classes: await lesClasses(s.etablissement_id) };
}

/* Nouvelle année : les règles se règlent et s'enregistrent d'un côté, s'appliquent de
   l'autre. Le passage n'accepte PAS de règles dans sa requête — il applique celles qui
   sont en base, celles que le tableau de bord vient d'afficher et de faire confirmer.
   La logique vit dans comptes.js ; ici, seulement la portée et le contrôle d'entrée. */
async function profAnnee(req) {
  const s = await sessionProf(req);
  return reglesDePassage(s.etablissement_id);
}

async function profReglesAnnee(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  if (!('regles' in corps)) throw new Refus(400, 'Règles attendues (ou null pour le défaut).');
  return enregistrerPassage(s.etablissement_id, corps.regles, s.identifiant);
}

/* `attendu` est obligatoire : sans lui, rien ne garantirait que ce qui s'exécute est ce
   que l'enseignant a vu à l'écran avant de confirmer des suppressions définitives. */
async function profPasserAnnee(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  const a = corps.attendu || {};
  if (!Number.isInteger(a.deplaces) || !Number.isInteger(a.supprimes)) {
    throw new Refus(400, 'Aperçu attendu : nombre de comptes déplacés et supprimés.');
  }
  return passerAnneeSuivante(s.etablissement_id,
    { attendu: a, forcer: corps.forcer === true, acteur: s.identifiant });
}


/* --------------------------------------------------------------------------
   Espace administrateur

   Ce compte est délibérément distinct du compte enseignant, même quand c'est la même
   personne qui les détient. Trois raisons, dans cet ordre :

   - il ne sert qu'exceptionnellement — ouvrir un collège, créer un professeur — et un
     compte qu'on ouvre trois fois par an ne devrait pas rester connecté toute l'année
     dans l'onglet du fond ;
   - il porte le seul pouvoir qui traverse la frontière des établissements, et un
     pouvoir qui traverse la frontière ne doit pas être un effet de bord du compte avec
     lequel on fait cours ;
   - il ne voit AUCUN élève, et c'est vérifiable ligne à ligne ci-dessous : pas une
     requête ne renvoie un prénom, une classe ou un avancement d'élève, seulement des
     décomptes. L'administrateur d'une instance partagée est le sous-traitant technique
     de plusieurs responsables de traitement ; qu'il puisse ouvrir un collège n'implique
     pas qu'il puisse lire ses élèves, et le code doit le dire aussi clairement que le
     contrat.
   -------------------------------------------------------------------------- */
async function sessionAdmin(req) {
  const s = await session(req);
  if (s.role !== 'admin') throw new Refus(403, 'Réservé à l\'administration.');
  return s;
}

/* Des décomptes, jamais des noms. */
async function lesEtablissements() {
  return (await db.q(
    `select e.id, e.nom, e.ville, e.actif, e.cree_le,
            count(*) filter (where c.role = 'eleve') ::int as eleves,
            count(*) filter (where c.role = 'prof')  ::int as profs,
            (select count(*)::int from classes cl where cl.etablissement_id = e.id) as classes
       from etablissements e
       left join comptes c on c.etablissement_id = e.id
      group by e.id
      order by e.nom, e.ville`)).rows;
}

async function adminEtablissements(req) {
  await sessionAdmin(req);
  return { etablissements: await lesEtablissements() };
}

async function adminCreerEtablissement(req) {
  const s = await sessionAdmin(req);
  const corps = await lireCorps(req);
  const nom = String(corps.nom || '').trim().slice(0, 80);
  const ville = String(corps.ville || '').trim().slice(0, 60);
  if (!nom) throw new Refus(400, 'Nom de l\'établissement attendu.');

  const deja = await db.une(
    'select id from etablissements where lower(nom) = lower($1) and lower(ville) = lower($2)',
    [nom, ville]);
  if (deja) throw new Refus(409, `« ${nom} » existe déjà.`);

  const e = await db.une(
    'insert into etablissements(nom, ville) values ($1,$2) returning id', [nom, ville]);
  await poserClassesDeBase(e.id);
  await db.journaliser(s.identifiant, 'etablissement.creation', nom, { ville }, e.id);
  return { id: e.id, etablissements: await lesEtablissements() };
}

async function adminModifierEtablissement(req, params) {
  const s = await sessionAdmin(req);
  const id = Number(params.id);
  const corps = await lireCorps(req);
  const cible = await db.une('select nom from etablissements where id = $1', [id]);
  if (!cible) throw new Refus(404, 'Établissement introuvable.');

  const champs = [], valeurs = [];
  const poser = (col, val) => { champs.push(`${col} = $${champs.length + 2}`); valeurs.push(val); };
  if (typeof corps.nom === 'string' && corps.nom.trim()) poser('nom', corps.nom.trim().slice(0, 80));
  if (typeof corps.ville === 'string') poser('ville', corps.ville.trim().slice(0, 60));
  if ('actif' in corps) poser('actif', !!corps.actif);
  if (!champs.length) throw new Refus(400, 'Rien à modifier.');

  await db.q(`update etablissements set ${champs.join(', ')} where id = $1`, [id, ...valeurs]);
  /* Fermer un établissement doit couper l'accès tout de suite, pas au bout de douze
     heures : les sessions ouvertes de ses comptes tombent avec lui. */
  if ('actif' in corps && !corps.actif) {
    await db.q(
      'delete from sessions where compte_id in (select id from comptes where etablissement_id = $1)', [id]);
  }
  await db.journaliser(s.identifiant, 'etablissement.modification', cible.nom, corps, id);
  return { etablissements: await lesEtablissements() };
}

/* Un établissement ne se supprime pas « avec ses données » d'un clic. La base l'interdit
   déjà (`comptes.etablissement_id` est en « on delete restrict »), on le dit ici avec le
   décompte : supprimer un collège en fin de contrat, c'est d'abord supprimer ses comptes,
   ce qui est une décision qui se prend élève par élève ou par la purge. */
async function adminSupprimerEtablissement(req, params) {
  const s = await sessionAdmin(req);
  const id = Number(params.id);
  const cible = await db.une('select nom from etablissements where id = $1', [id]);
  if (!cible) throw new Refus(404, 'Établissement introuvable.');

  const n = await db.une('select count(*)::int as n from comptes where etablissement_id = $1', [id]);
  if (n.n) {
    throw new Refus(409,
      `« ${cible.nom} » compte encore ${n.n} compte${n.n > 1 ? 's' : ''}. ` +
      'Supprime-les d\'abord, ou ferme l\'établissement au lieu de le supprimer.');
  }
  await db.q('delete from etablissements where id = $1', [id]);
  await db.journaliser(s.identifiant, 'etablissement.suppression', cible.nom, null, null);
  return { ok: true, etablissements: await lesEtablissements() };
}

/* Les comptes ENSEIGNANTS, de tous les établissements — et eux seuls. Le `where` porte
   sur le rôle : c'est ce qui garantit qu'aucun nom d'élève ne sort d'ici. */
async function lesProfs() {
  return (await db.q(
    `select c.id, c.identifiant, c.prenom, c.nom, c.actif, c.cree_le, c.derniere_connexion,
            c.etablissement_id, e.nom as etablissement
       from comptes c left join etablissements e on e.id = c.etablissement_id
      where c.role = 'prof'
      order by e.nom, c.nom, c.prenom`)).rows;
}

async function adminProfs(req) {
  await sessionAdmin(req);
  return { profs: await lesProfs(), etablissements: await lesEtablissements() };
}

async function adminCreerProf(req) {
  const s = await sessionAdmin(req);
  const corps = await lireCorps(req);
  const etab = Number(corps.etablissement_id);
  if (!(await db.une('select 1 from etablissements where id = $1', [etab]))) {
    throw new Refus(400, 'Établissement inconnu.');
  }
  try {
    const c = await creerCompte({
      prenom: String(corps.prenom || '').trim(),
      nom: String(corps.nom || '').trim(),
      etablissement_id: etab,
      role: 'prof',
      acteur: s.identifiant
    });
    return { ...c, profs: await lesProfs() };   /* mot de passe en clair, une seule fois */
  } catch (e) {
    throw new Refus(400, e.message);
  }
}

async function adminProfSeul(id) {
  const l = await db.une(
    'select id, identifiant, etablissement_id from comptes where id = $1 and role = $2', [id, 'prof']);
  if (!l) throw new Refus(404, 'Compte enseignant introuvable.');
  return l;
}

async function adminModifierProf(req, params) {
  const s = await sessionAdmin(req);
  const id = Number(params.id);
  const corps = await lireCorps(req);
  const cible = await adminProfSeul(id);

  const champs = [], valeurs = [];
  const poser = (col, val) => { champs.push(`${col} = $${champs.length + 2}`); valeurs.push(val); };

  if (typeof corps.prenom === 'string' && corps.prenom.trim()) poser('prenom', corps.prenom.trim().slice(0, 60));
  if (typeof corps.nom === 'string' && corps.nom.trim()) poser('nom', corps.nom.trim().slice(0, 60));

  if (typeof corps.identifiant === 'string') {
    const id2 = corps.identifiant.trim().toLowerCase();
    if (!IDENTIFIANT_OK.test(id2)) {
      throw new Refus(400, 'Identifiant : minuscules, chiffres, point et tiret, 2 à 31 caractères.');
    }
    const pris = await db.une('select 1 from comptes where identifiant = $1 and id <> $2', [id2, id]);
    if (pris) throw new Refus(409, `L'identifiant « ${id2} » est déjà pris.`);
    poser('identifiant', id2);
  }

  /* Muter un professeur d'un établissement à l'autre, c'est lui retirer la vue sur le
     premier et lui donner celle du second : ses sessions ouvertes tombent, sinon il
     continuerait un moment à voir les élèves du collège qu'il vient de quitter. */
  if ('etablissement_id' in corps) {
    const etab = Number(corps.etablissement_id);
    if (!(await db.une('select 1 from etablissements where id = $1', [etab]))) {
      throw new Refus(400, 'Établissement inconnu.');
    }
    poser('etablissement_id', etab);
  }
  if ('actif' in corps) poser('actif', !!corps.actif);
  if (!champs.length) throw new Refus(400, 'Rien à modifier.');

  await db.q(`update comptes set ${champs.join(', ')} where id = $1`, [id, ...valeurs]);
  if (('etablissement_id' in corps) || ('actif' in corps && !corps.actif)) {
    await db.q('delete from sessions where compte_id = $1', [id]);
  }
  await db.journaliser(s.identifiant, 'prof.modification', cible.identifiant, corps, cible.etablissement_id);
  return { profs: await lesProfs() };
}

async function adminSupprimerProf(req, params) {
  const s = await sessionAdmin(req);
  const cible = await adminProfSeul(Number(params.id));
  await db.q('delete from comptes where id = $1', [cible.id]);
  await db.journaliser(s.identifiant, 'prof.suppression', cible.identifiant, null, cible.etablissement_id);
  return { ok: true, profs: await lesProfs() };
}

async function adminMdpProf(req, params) {
  const s = await sessionAdmin(req);
  const cible = await adminProfSeul(Number(params.id));
  return reinitialiserMdp(cible.identifiant, { acteur: s.identifiant });
}

/* --------------------------------------------------------------------------
   Travail à la maison — sans compte
   L'élève ouvre un lien sur son téléphone, tape son prénom, choisit sa classe, et la
   page envoie ici où il en est : étapes faites, score. Pas de session, donc pas de
   jeton : la portée vient du CODE de l'établissement, que le lien transporte. Un code
   inconnu est « introuvable », comme partout ailleurs.

   Ce qui protège ces routes, faute d'authentification :
     - le code (il faut avoir reçu le lien) ;
     - un rythme par adresse IP, tenu en mémoire — l'adresse n'est PAS enregistrée ;
     - une classe qui doit exister dans l'établissement, un prénom fait de lettres ;
     - un plafond de lignes par établissement.
   Rien de tout cela n'empêche un élève de taper le prénom d'un autre : ce suivi dit qui
   a travaillé, il ne certifie rien. C'est écrit aussi dans le README (§ 4 bis).
   -------------------------------------------------------------------------- */
const devoirRythmes = new Map();   /* adresse IP → { debut, n } */

function devoirRythme(req) {
  const adresse = ip(req), maintenant = Date.now();
  let r = devoirRythmes.get(adresse);
  if (!r || maintenant - r.debut > DEVOIR_APPELS_FENETRE) { r = { debut: maintenant, n: 0 }; devoirRythmes.set(adresse, r); }
  if (++r.n > DEVOIR_APPELS_MAX) throw new Refus(429, 'Trop d\'envois. Réessaie dans quelques minutes.');
}
setInterval(() => {
  const limite = Date.now() - DEVOIR_APPELS_FENETRE;
  for (const [k, r] of devoirRythmes) if (r.debut < limite) devoirRythmes.delete(k);
}, 10 * 60_000).unref();

async function etablissementDuCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!DEVOIR_CODE_OK.test(c)) throw new Refus(404, 'Lien inconnu.');
  const e = await db.une('select id from etablissements where code_devoir = $1 and actif', [c]);
  if (!e) throw new Refus(404, 'Lien inconnu.');
  return e.id;
}

/* Les noms de classes, et rien d'autre : l'élève choisit la sienne au lieu de la taper
   (« 5eme », « 5 e », « cinquième »…), ce qui la rend comparable côté enseignant. */
async function devoirClasses(req) {
  devoirRythme(req);
  const code = new URL(req.url || '/', 'http://x').searchParams.get('c');
  const etab = await etablissementDuCode(code);
  return { classes: (await lesClasses(etab)).map((c) => c.nom) };
}

async function devoirPassage(req) {
  devoirRythme(req);
  const corps = await lireCorps(req);
  const etab = await etablissementDuCode(corps.c);

  const id = String(corps.id || '');
  const devoir = String(corps.devoir || '');
  const prenom = String(corps.prenom || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!DEVOIR_ID_OK.test(id) || !DEVOIR_NOM_OK.test(devoir)) throw new Refus(400, 'Envoi incomplet.');
  if (!DEVOIR_PRENOM_OK.test(prenom)) throw new Refus(400, 'Écris ton prénom avec des lettres seulement.');

  const classe = await db.une(
    'select id from classes where etablissement_id = $1 and lower(nom) = lower($2)',
    [etab, String(corps.classe || '').trim()]);
  if (!classe) throw new Refus(400, 'Classe inconnue.');

  const entier = (v, max) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  const etapes = entier(corps.etapes, 50), max = entier(corps.max, 500);
  const etape = Math.min(entier(corps.etape, 50), etapes), score = Math.min(entier(corps.score, 500), max);
  const termine = etapes > 0 && etape >= etapes;

  const deja = await db.une('select etablissement_id, devoir from devoirs_passages where id = $1', [id]);
  /* Un identifiant déjà pris ailleurs (autre collège, autre devoir) n'est ni repris ni
     signalé : on répond comme pour un envoi mal formé. */
  if (deja && (deja.etablissement_id !== etab || deja.devoir !== devoir)) throw new Refus(400, 'Envoi incomplet.');
  if (!deja) {
    const n = await db.une('select count(*)::int as n from devoirs_passages where etablissement_id = $1', [etab]);
    if (n.n >= DEVOIRS_MAX) throw new Refus(507, 'Le suivi est plein pour le moment.');
  }

  /* greatest() : deux envois peuvent arriver dans le désordre (réseau de téléphone, onglet
     rouvert). Un score ou une étape ne redescendent jamais, quel que soit l'ordre. */
  await db.q(
    `insert into devoirs_passages(id, etablissement_id, devoir, prenom, classe_id, etape, etapes, score, score_max, termine)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update
        set prenom = excluded.prenom, classe_id = excluded.classe_id,
            etape = greatest(devoirs_passages.etape, excluded.etape),
            etapes = excluded.etapes,
            score = greatest(devoirs_passages.score, excluded.score),
            score_max = excluded.score_max,
            termine = devoirs_passages.termine or excluded.termine,
            maj_le = now()`,
    [id, etab, devoir, prenom, classe.id, etape, etapes, score, max, termine]);
  return { ok: true };
}

/* Le code du lien est créé à la première visite de l'enseignant : tant que personne n'a
   ouvert travail-maison.html, l'établissement n'a aucune porte sans connexion. */
async function codeDevoir(etablissementId) {
  const e = await db.une('select code_devoir from etablissements where id = $1', [etablissementId]);
  if (e && e.code_devoir) return e.code_devoir;
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   /* sans i/l/o/0/1 : le code se dicte */
  for (let essai = 0; essai < 5; essai++) {
    const code = Array.from(crypto.randomBytes(8), (o) => ALPHABET[o % ALPHABET.length]).join('');
    try {
      const r = await db.une(
        `update etablissements set code_devoir = coalesce(code_devoir, $2) where id = $1 returning code_devoir`,
        [etablissementId, code]);
      return r.code_devoir;
    } catch (e2) {
      if (e2.code !== '23505') throw e2;   /* code déjà pris par un autre établissement : on retire */
    }
  }
  throw new Refus(500, 'Code du lien impossible à créer.');
}

async function profDevoirs(req) {
  const s = await sessionProf(req);
  const r = await db.q(
    `select p.id, p.devoir, p.prenom, cl.nom as classe, p.etape, p.etapes, p.score, p.score_max,
            p.termine, p.debut_le, p.maj_le
       from devoirs_passages p left join classes cl on cl.id = p.classe_id
      where p.etablissement_id = $1
      order by p.devoir, cl.ordre nulls last, cl.nom, lower(p.prenom), p.debut_le`, [s.etablissement_id]);
  return { code: await codeDevoir(s.etablissement_id), passages: r.rows, conservationMois: DEVOIRS_MOIS };
}

/* {id} : une ligne. {devoir, classe?} : toute la série d'un devoir, d'une classe ou de
   toutes. Toujours bornée à l'établissement de la session. */
async function profSupprimerDevoirs(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  let r;
  if (corps.id) {
    r = await db.q('delete from devoirs_passages where id = $1 and etablissement_id = $2',
      [String(corps.id), s.etablissement_id]);
  } else if (corps.devoir) {
    let classe = null;
    if (corps.classe) {
      const c = await db.une(
        'select id from classes where etablissement_id = $1 and lower(nom) = lower($2)',
        [s.etablissement_id, String(corps.classe).trim()]);
      if (!c) throw new Refus(404, 'Classe introuvable.');
      classe = c.id;
    }
    r = await db.q(
      `delete from devoirs_passages
        where etablissement_id = $1 and devoir = $2 and ($3::int is null or classe_id = $3)`,
      [s.etablissement_id, String(corps.devoir), classe]);
  } else {
    throw new Refus(400, 'Rien à supprimer.');
  }
  if (r.rowCount) {
    await db.journaliser(s.identifiant, 'devoirs.suppression', corps.id ? null : String(corps.devoir),
      { lignes: r.rowCount, classe: corps.classe || null }, s.etablissement_id);
  }
  return { ok: true, supprimes: r.rowCount };
}

async function purgerDevoirs() {
  try {
    const r = await db.q(
      `delete from devoirs_passages where maj_le < now() - ($1 || ' months')::interval`,
      [String(DEVOIRS_MOIS)]);
    if (r.rowCount) console.log(`[api] devoirs : ${r.rowCount} ligne(s) au-delà de ${DEVOIRS_MOIS} mois`);
  } catch (e) {
    console.error('[api] purge des devoirs impossible :', e.message);
  }
}

/* --------------------------------------------------------------------------
   Aiguillage
   -------------------------------------------------------------------------- */
const ROUTES = [
  ['GET',    '/api/sante',                     sante],
  ['POST',   '/api/connexion',                 connexion],
  ['POST',   '/api/deconnexion',               deconnexion],
  ['GET',    '/api/moi',                       moi],
  ['POST',   '/api/mdp',                       changerMonMdp],
  ['PUT',    '/api/progression',               ecrireProgression],
  ['POST',   '/api/presence',                  battement],
  ['GET',    '/api/makecode/projets',          mcLister],
  ['PUT',    '/api/makecode/projet',           mcEcrire],
  ['DELETE', '/api/makecode/projet',           mcSupprimer],
  ['GET',    '/api/makecode/modeles',          mcModeles],
  ['GET',    '/api/makecode/modele/:id',       mcModele],

  ['GET',    '/api/devoir/classes',            devoirClasses],
  ['POST',   '/api/devoir/passage',            devoirPassage],

  ['GET',    '/api/prof/tableau',              profTableau],
  ['GET',    '/api/prof/presence',             profPresence],
  ['POST',   '/api/prof/classes',              profCreerClasse],
  ['PUT',    '/api/prof/classes/ordre',        profOrdreClasses],
  ['DELETE', '/api/prof/classes/:id',          profSupprimerClasse],
  ['POST',   '/api/prof/eleves',               profCreerEleve],
  ['GET',    '/api/prof/eleve/:id',            profEleve],
  ['PATCH',  '/api/prof/eleve/:id',            profModifierEleve],
  ['DELETE', '/api/prof/eleve/:id',            profSupprimerEleve],
  ['POST',   '/api/prof/eleve/:id/mdp',        profMdpEleve],
  ['PUT',    '/api/prof/eleve/:id/progression', profProgressionEleve],
  ['GET',    '/api/prof/annee',                profAnnee],
  ['PUT',    '/api/prof/annee/regles',         profReglesAnnee],
  ['POST',   '/api/prof/annee',                profPasserAnnee],
  ['GET',    '/api/prof/makecode/modeles',     profModeles],
  ['PUT',    '/api/prof/makecode/modele',      profPublierModele],
  ['PATCH',  '/api/prof/makecode/modele/:id',  profModifierModele],
  ['DELETE', '/api/prof/makecode/modele/:id',  profRetirerModele],
  ['GET',    '/api/prof/devoirs',              profDevoirs],
  ['DELETE', '/api/prof/devoirs',              profSupprimerDevoirs],

  ['GET',    '/api/admin/etablissements',      adminEtablissements],
  ['POST',   '/api/admin/etablissements',      adminCreerEtablissement],
  ['PATCH',  '/api/admin/etablissements/:id',  adminModifierEtablissement],
  ['DELETE', '/api/admin/etablissements/:id',  adminSupprimerEtablissement],
  ['GET',    '/api/admin/profs',               adminProfs],
  ['POST',   '/api/admin/profs',               adminCreerProf],
  ['PATCH',  '/api/admin/profs/:id',           adminModifierProf],
  ['DELETE', '/api/admin/profs/:id',           adminSupprimerProf],
  ['POST',   '/api/admin/profs/:id/mdp',       adminMdpProf]
];

function trouverRoute(methode, chemin) {
  for (const [m, motif, fn] of ROUTES) {
    if (m !== methode) continue;
    if (!motif.includes(':')) {
      if (motif === chemin) return { fn, params: {} };
      continue;
    }
    const a = motif.split('/'), b = chemin.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) {
        if (!/^\d+$/.test(b[i])) { ok = false; break; }   /* nos seuls paramètres sont des identifiants numériques */
        params[a[i].slice(1)] = b[i];
      } else if (a[i] !== b[i]) { ok = false; break; }
    }
    if (ok) return { fn, params };
  }
  return null;
}

const serveur = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const chemin = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const route = trouverRoute(req.method, chemin);
  if (!route) return repondre(res, 404, { erreur: 'Route inconnue.' });

  try {
    repondre(res, 200, await route.fn(req, route.params));
  } catch (e) {
    const code = e.code >= 400 && e.code <= 599 ? e.code : 500;
    if (code === 500) console.error('[api]', chemin, e);
    repondre(res, code, { erreur: code === 500 ? 'Erreur interne du serveur.' : e.message });
  }
});

serveur.headersTimeout = 20_000;
serveur.requestTimeout = 30_000;

try {
  await db.migrer();
  console.log('[api] schéma vérifié');
} catch (e) {
  console.error('[api] schéma non appliqué :', e.message);
  process.exit(1);
}

serveur.listen(PORT, HOTE, () => {
  console.log(`[api] à l'écoute sur ${HOTE}:${PORT}`);
  console.log(`[api] origines autorisées : ${ORIGINES.length ? ORIGINES.join(', ') : '(aucune — appels navigateur bloqués)'}`);
  console.log(`[api] conservation : comptes élèves ${CONSERVATION_MOIS} mois, journal ${JOURNAL_MOIS} mois, travail à la maison ${DEVOIRS_MOIS} mois`);
  console.log(`[api] empreinte du code : ${VERSION}`);
});

/* Au démarrage — après une minute, le temps que le service se pose — puis chaque jour. */
function menageQuotidien(){ purgerComptesExpires(); purgerJournal(); purgerDevoirs(); }
setTimeout(menageQuotidien, 60_000).unref();
setInterval(menageQuotidien, 24 * 60 * 60 * 1000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    serveur.close(() => db.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
