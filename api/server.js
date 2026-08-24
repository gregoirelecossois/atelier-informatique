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
 * Routes ouvertes à tout compte connecté :
 *   GET    /api/sante                       état du service (pour la supervision)
 *   POST   /api/connexion                   {identifiant, motdepasse} → jeton + progression
 *   POST   /api/deconnexion                 révoque le jeton présenté
 *   GET    /api/moi                         profil + progression complète
 *   PUT    /api/progression                 {majs, suppressions} → nouvelle version
 *   POST   /api/presence                    battement : où en est l'élève en ce moment
 *
 * Routes réservées au rôle « prof » — le tableau de bord :
 *   GET    /api/prof/tableau                tous les comptes + leur avancement résumé
 *   GET    /api/prof/presence               qui est connecté, et où (interrogé souvent)
 *   POST   /api/prof/classes                crée ou réordonne une classe
 *   POST   /api/prof/eleves                 crée un compte → mot de passe en clair, une fois
 *   GET    /api/prof/eleve/:id              fiche complète
 *   PATCH  /api/prof/eleve/:id              nom, prénom, classe, identifiant, actif
 *   DELETE /api/prof/eleve/:id              suppression définitive
 *   POST   /api/prof/eleve/:id/mdp          réinitialise le mot de passe
 *   PUT    /api/prof/eleve/:id/progression  débloque un niveau, corrige un avancement
 */
import './env.js';
import http from 'node:http';
import * as db from './db.js';
import * as auth from './auth.js';
import { creerCompte, reinitialiserMdp, IDENTIFIANT_OK } from './comptes.js';

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
   vaut une erreur visible qu'une progression qui disparaît en silence. */
const PREFIXES = ['ms_', 'kb_', 'tt_', 'df_', 'nv_', 'ml_', 'badges_', 'a11y_'];
const CLE_OK = /^[a-z0-9_]{1,64}$/;

const SESSION_MS = 12 * 60 * 60 * 1000;   /* une journée de classe, largement */

/* Durée de conservation d'un compte élève, comptée depuis sa CRÉATION (RGPD art. 5.1.e).
   Passé ce délai le compte est supprimé, progression et trophées compris. Compter depuis
   la création plutôt que depuis la dernière connexion est un choix : c'est une échéance
   connue d'avance, la même pour tout le monde, qu'on peut annoncer aux familles dans la
   mention d'information — mais un élève encore présent au bout de deux ans repart de zéro.
   Il suffit alors de lui recréer un compte. */
const CONSERVATION_MOIS = Number(process.env.CONSERVATION_MOIS || 24);
const CORPS_MAX = 256 * 1024;
const VALEUR_MAX = 4096;
const CLES_MAX = 500;

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

  const ligne = await db.une(
    `select s.jeton, s.expire_le, s.vue_le,
            c.id, c.identifiant, c.prenom, c.nom, c.role, cl.nom as classe
       from sessions s
       join comptes c  on c.id = s.compte_id
       left join classes cl on cl.id = c.classe_id
      where s.jeton = $1 and s.expire_le > now() and c.actif`,
    [auth.empreinte(m[1])]
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

function profil(l) {
  return { id: l.id, identifiant: l.identifiant, prenom: l.prenom, nom: l.nom, classe: l.classe, role: l.role };
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
    `select c.*, cl.nom as classe from comptes c
       left join classes cl on cl.id = c.classe_id
      where c.identifiant = $1`, [identifiant]);

  /* Même message et même durée dans tous les cas d'échec : ni le contenu ni le
     temps de réponse ne doivent révéler qu'un identifiant existe. */
  const bon = c && c.actif ? await auth.verifier(motdepasse, c.mdp) : await auth.perdreDuTemps();
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
  await db.journaliser(identifiant, 'connexion', null, { ip: adresse });

  const p = await progressionDe(c.id);
  return { jeton: jeton.clair, eleve: profil(c), ...p, doitChangerMdp: c.doit_changer_mdp };
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

async function sante() {
  await db.q('select 1');
  return { ok: true, service: 'atelier-informatique', heure: new Date().toISOString() };
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
        returning identifiant`,
      [String(CONSERVATION_MOIS)]);
    if (!r.rowCount) return;
    await db.journaliser('systeme', 'comptes.purge', null, {
      mois: CONSERVATION_MOIS,
      supprimes: r.rowCount,
      identifiants: r.rows.map((l) => l.identifiant).slice(0, 200)
    });
    console.log(`[api] purge : ${r.rowCount} compte(s) élève au-delà de ${CONSERVATION_MOIS} mois`);
  } catch (e) {
    console.error('[api] purge impossible :', e.message);
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

async function battement(req) {
  const s = await session(req);
  const corps = await lireCorps(req);

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
   Espace enseignant
   -------------------------------------------------------------------------- */
async function sessionProf(req) {
  const s = await session(req);
  if (s.role !== 'prof') throw new Refus(403, 'Réservé aux enseignants.');
  return s;
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
    niveaux, trophees
  };
}

async function lesClasses() {
  return (await db.q('select id, nom, ordre from classes order by ordre, nom')).rows;
}

/* Une seule requête pour peindre tout le tableau. Rechargée toutes les 30 s. */
async function profTableau(req) {
  await sessionProf(req);
  const r = await db.q(
    `select c.id, c.identifiant, c.prenom, c.nom, c.role, c.actif, c.cree_le, c.derniere_connexion,
            cl.id as classe_id, cl.nom as classe,
            coalesce(p.donnees, '{}'::jsonb) as donnees
       from comptes c
       left join classes cl on cl.id = c.classe_id
       left join progressions p on p.compte_id = c.id
      order by cl.ordre nulls last, cl.nom, c.nom, c.prenom`);
  return { eleves: r.rows.map(resumer), classes: await lesClasses() };
}

/* Volontairement minuscule : c'est CE qui est interrogé toutes les 10 s. */
async function profPresence(req) {
  await sessionProf(req);
  const r = await db.q(
    `select compte_id, atelier, niveau, mission, vu_le
       from presence where vu_le > now() - ($1 || ' minutes')::interval`, [String(PRESENCE_MINUTES)]);
  return { presents: r.rows, maintenant: new Date().toISOString() };
}

async function profEleve(req, params) {
  await sessionProf(req);
  const l = await db.une(
    `select c.id, c.identifiant, c.prenom, c.nom, c.role, c.actif, c.cree_le, c.derniere_connexion,
            c.doit_changer_mdp, cl.id as classe_id, cl.nom as classe
       from comptes c left join classes cl on cl.id = c.classe_id
      where c.id = $1`, [Number(params.id)]);
  if (!l) throw new Refus(404, 'Compte introuvable.');
  return { eleve: l, ...(await progressionDe(l.id)) };
}

async function profCreerEleve(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  try {
    const c = await creerCompte({
      prenom: String(corps.prenom || '').trim(),
      nom: String(corps.nom || '').trim(),
      classe_id: corps.classe_id != null ? Number(corps.classe_id) : undefined,
      classe: corps.classe,
      role: corps.role === 'prof' ? 'prof' : 'eleve',
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

  const cible = await db.une('select id, identifiant, role, actif from comptes where id = $1', [id]);
  if (!cible) throw new Refus(404, 'Compte introuvable.');

  const champs = [], valeurs = [];
  const poser = (col, val) => { champs.push(`${col} = $${champs.length + 2}`); valeurs.push(val); };

  if (typeof corps.prenom === 'string' && corps.prenom.trim()) poser('prenom', corps.prenom.trim().slice(0, 60));
  if (typeof corps.nom === 'string' && corps.nom.trim()) poser('nom', corps.nom.trim().slice(0, 60));
  if ('classe_id' in corps) poser('classe_id', corps.classe_id == null ? null : Number(corps.classe_id));

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
    if (id === s.id && !corps.actif) throw new Refus(400, 'On ne se désactive pas soi-même.');
    poser('actif', !!corps.actif);
    if (!corps.actif) await db.q('delete from sessions where compte_id = $1', [id]);
  }

  if (!champs.length) throw new Refus(400, 'Rien à modifier.');
  await db.q(`update comptes set ${champs.join(', ')} where id = $1`, [id, ...valeurs]);
  await db.journaliser(s.identifiant, 'compte.modification', cible.identifiant, corps);
  return { ok: true };
}

async function profMdpEleve(req, params) {
  const s = await sessionProf(req);
  const cible = await db.une('select identifiant from comptes where id = $1', [Number(params.id)]);
  if (!cible) throw new Refus(404, 'Compte introuvable.');
  return reinitialiserMdp(cible.identifiant, { acteur: s.identifiant });
}

async function profSupprimerEleve(req, params) {
  const s = await sessionProf(req);
  const id = Number(params.id);
  if (id === s.id) throw new Refus(400, 'On ne supprime pas son propre compte.');
  const cible = await db.une('select identifiant from comptes where id = $1', [id]);
  if (!cible) throw new Refus(404, 'Compte introuvable.');
  await db.q('delete from comptes where id = $1', [id]);
  await db.journaliser(s.identifiant, 'compte.suppression', cible.identifiant, null);
  return { ok: true };
}

/* Déblocage d'un niveau depuis le tableau de bord : c'est une écriture de progression
   comme une autre, avec les mêmes contrôles de clé — et une trace au journal, parce
   qu'un avancement modifié par l'enseignant doit pouvoir s'expliquer. */
async function profProgressionEleve(req, params) {
  const s = await sessionProf(req);
  const id = Number(params.id);
  const cible = await db.une('select identifiant from comptes where id = $1', [id]);
  if (!cible) throw new Refus(404, 'Compte introuvable.');
  const corps = await lireCorps(req);
  const r = await appliquerProgression(id, corps);
  await db.journaliser(s.identifiant, 'progression.modification', cible.identifiant,
    { majs: corps.majs || {}, suppressions: corps.suppressions || [] });
  return r;
}

async function profCreerClasse(req) {
  const s = await sessionProf(req);
  const corps = await lireCorps(req);
  const nom = String(corps.nom || '').trim().slice(0, 30);
  if (!nom) throw new Refus(400, 'Nom de classe attendu.');
  await db.q(
    `insert into classes(nom, ordre) values ($1,$2)
     on conflict (nom) do update set ordre = excluded.ordre`, [nom, Number(corps.ordre || 0)]);
  await db.journaliser(s.identifiant, 'classe.enregistrement', nom, null);
  return { classes: await lesClasses() };
}

/* --------------------------------------------------------------------------
   Aiguillage
   -------------------------------------------------------------------------- */
const ROUTES = [
  ['GET',    '/api/sante',                     sante],
  ['POST',   '/api/connexion',                 connexion],
  ['POST',   '/api/deconnexion',               deconnexion],
  ['GET',    '/api/moi',                       moi],
  ['PUT',    '/api/progression',               ecrireProgression],
  ['POST',   '/api/presence',                  battement],

  ['GET',    '/api/prof/tableau',              profTableau],
  ['GET',    '/api/prof/presence',             profPresence],
  ['POST',   '/api/prof/classes',              profCreerClasse],
  ['POST',   '/api/prof/eleves',               profCreerEleve],
  ['GET',    '/api/prof/eleve/:id',            profEleve],
  ['PATCH',  '/api/prof/eleve/:id',            profModifierEleve],
  ['DELETE', '/api/prof/eleve/:id',            profSupprimerEleve],
  ['POST',   '/api/prof/eleve/:id/mdp',        profMdpEleve],
  ['PUT',    '/api/prof/eleve/:id/progression', profProgressionEleve]
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
  console.log(`[api] conservation des comptes élèves : ${CONSERVATION_MOIS} mois après création`);
});

/* Au démarrage — après une minute, le temps que le service se pose — puis chaque jour. */
setTimeout(purgerComptesExpires, 60_000).unref();
setInterval(purgerComptesExpires, 24 * 60 * 60 * 1000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    serveur.close(() => db.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
