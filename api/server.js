/* API de l'Atelier informatique — comptes élèves et sauvegarde de progression.
 *
 * Volontairement sans cadre applicatif : node:http et pg, rien d'autre. Cinq routes,
 * un hébergement mutualisé, aucune étape de compilation — moins il y a de pièces, moins
 * il y a à surveiller et à mettre à jour pendant l'année scolaire.
 *
 * Authentification par jeton porteur (Authorization: Bearer …) et non par cookie :
 * la page de jeu et l'API vivent sur deux domaines différents (GitHub Pages d'un côté,
 * alwaysdata de l'autre), et un cookie tiers se fait aujourd'hui bloquer par les
 * navigateurs comme par les filtres des réseaux d'établissement. Corollaire agréable :
 * aucune surface CSRF.
 *
 * Routes :
 *   GET  /api/sante          état du service (pour la supervision)
 *   POST /api/connexion      {identifiant, motdepasse} → jeton + progression
 *   POST /api/deconnexion    révoque le jeton présenté
 *   GET  /api/moi            profil + progression complète
 *   PUT  /api/progression    {majs:{clé:valeur}, suppressions:[clé]} → nouvelle version
 */
import './env.js';
import http from 'node:http';
import * as db from './db.js';
import * as auth from './auth.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
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
  const corps = await lireCorps(req);

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
    return { version: (await progressionDe(s.id)).version };
  }

  const r = await db.une(
    `insert into progressions(compte_id, donnees, version, maj_le)
          values ($1, $2::jsonb, 1, now())
     on conflict (compte_id) do update
        set donnees = (progressions.donnees || $2::jsonb) - $3::text[],
            version = progressions.version + 1,
            maj_le  = now()
      returning version`,
    [s.id, JSON.stringify(propre), suppressions.map(String)]
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
   Aiguillage
   -------------------------------------------------------------------------- */
const ROUTES = {
  'GET /api/sante': sante,
  'POST /api/connexion': connexion,
  'POST /api/deconnexion': deconnexion,
  'GET /api/moi': moi,
  'PUT /api/progression': ecrireProgression
};

const serveur = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const chemin = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const route = ROUTES[`${req.method} ${chemin}`];
  if (!route) return repondre(res, 404, { erreur: 'Route inconnue.' });

  try {
    repondre(res, 200, await route(req));
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
