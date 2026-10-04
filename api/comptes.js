/* Création et entretien des comptes — partagé par l'outil en ligne de commande et par
 * le tableau de bord enseignant.
 *
 * Ce module existe pour une seule raison : un compte créé depuis le navigateur et un
 * compte créé en SSH doivent être rigoureusement identiques. Même façon de fabriquer
 * l'identifiant, même politique de mot de passe, même trace au journal. Deux chemins de
 * création, c'est deux comportements qui divergent au premier correctif appliqué d'un
 * seul côté.
 *
 * Depuis le cloisonnement, ce module porte aussi la frontière : aucune fonction d'ici
 * ne résout une classe ni ne crée un compte sans savoir DANS QUEL établissement. Ce
 * n'est pas un paramètre par défaut qu'on peut oublier, c'est une erreur si on l'omet.
 */
import * as db from './db.js';
import * as auth from './auth.js';
import { generer, formePour } from './motsdepasse.js';

/* Un identifiant n'a le droit qu'à des minuscules, des chiffres, un point et un tiret :
   c'est ce que l'élève tape sur un clavier qu'il apprend justement à utiliser. */
export const IDENTIFIANT_OK = /^[a-z][a-z0-9.-]{1,30}$/;

export function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* L'identifiant est GLOBAL, jamais propre à un établissement : l'écran de connexion ne
   demande qu'un identifiant et un mot de passe, sans liste déroulante de collèges — un
   élève de 6e ne doit pas avoir à savoir dans quel établissement on l'a inscrit. Deux
   « lea.m » dans deux collèges différents seraient donc deux comptes indiscernables à
   la connexion : la suite d'essais ci-dessous s'allonge jusqu'à trouver un libre.
 *
 * Élève  : lea.m, puis lea.mar, lea.martin, lea.m2, lea.m3…
 * Prof   : g.lecossois — l'initiale du prénom et le NOM entier. C'est sous ce nom qu'un
 *          professeur est appelé dans un établissement, c'est celui que ses collègues
 *          reconnaissent sur une liste de comptes, et c'est le seul qui reste lisible
 *          quand plusieurs enseignants partagent le même tableau de bord.
 * Admin  : admin.lecossois — le préfixe n'est pas décoratif. La même personne détient
 *          souvent les deux comptes ; il faut qu'une ligne de journal, un écran de
 *          connexion ou une liste dise lequel des deux a agi, sans avoir à le déduire.
 *          Et il libère « g.lecossois » pour le compte avec lequel on fait cours.
 */
export async function identifiantLibre(prenom, nom, role = 'eleve') {
  const p = sansAccent(prenom).toLowerCase().replace(/[^a-z]/g, '');
  const n = sansAccent(nom).toLowerCase().replace(/[^a-z]/g, '');
  if (!p || !n) throw new Error('Prénom et nom doivent contenir des lettres.');

  const racine = role === 'eleve' ? `${p}.${n[0]}`
               : role === 'admin' ? `admin.${n}`
               : `${p[0]}.${n}`;
  const essais = role === 'eleve' ? [racine, `${p}.${n.slice(0, 3)}`, `${p}.${n}`]
               : role === 'admin' ? [racine]
               : [racine, `${p.slice(0, 2)}.${n}`];
  /* Jusqu'à 200 homonymes, et non 30 : l'identifiant est global à l'instance, alors que
     le stock de noms, lui, est celui d'un seul collège. Trois cents élèves de plus par
     établissement ajouté, ce sont autant d'occasions pour deux « Léa Martin » de deux
     villes de se disputer « lea.m ». La butée reste utile — mais tomber dessus renverrait
     « Impossible de trouver un identifiant libre » en plein import de classe. */
  for (let i = 2; i <= 200; i++) essais.push(`${racine}${i}`);

  for (const id of essais) {
    if (id.length > 31) continue;
    if (!(await db.une('select 1 from comptes where identifiant = $1', [id]))) return id;
  }
  throw new Error('Impossible de trouver un identifiant libre.');
}

/* Les classes qu'on pose d'office à la création d'un établissement. Un collège tout
   neuf dont le tableau de bord n'affiche aucune pastille se lit comme une panne ; ces
   six-là couvrent le cas général et se suppriment au clic droit si elles ne conviennent
   pas. La liste est ici, et pas dupliquée dans l'outil en ligne de commande. */
export const CLASSES_DE_BASE = ['6e', '5e', '4e', '3e', 'CAP1', 'CAP2'];

export async function poserClassesDeBase(etablissementId) {
  for (let i = 0; i < CLASSES_DE_BASE.length; i++) {
    await db.q(
      `insert into classes(nom, ordre, etablissement_id) values ($1,$2,$3)
       on conflict (etablissement_id, lower(nom)) do nothing`,
      [CLASSES_DE_BASE[i], i, Number(etablissementId)]);
  }
}

/* Crée la classe si elle n'existe pas : en pratique on tape « 5eB » avant d'avoir pensé
   à la déclarer, et refuser à ce moment-là ne rend service à personne.
 *
 * ⚠ L'établissement n'a PAS de valeur par défaut, et son absence lève une erreur plutôt
 * que de chercher partout. C'était le trou le plus discret du cloisonnement : une
 * résolution par le seul nom aurait rendu la « 6eB » du premier collège venu à un
 * professeur du second, qui aurait alors rangé ses élèves dans la classe de quelqu'un
 * d'autre — sans qu'aucun écran ne montre quoi que ce soit d'anormal. */
export async function classeId(nom, etablissementId) {
  if (!nom) return null;
  const etab = Number(etablissementId);
  if (!Number.isInteger(etab)) throw new Error('Établissement obligatoire pour résoudre une classe.');

  const c = await db.une(
    'select id from classes where etablissement_id = $1 and lower(nom) = lower($2)', [etab, nom]);
  if (c) return c.id;
  return (await db.une(
    'insert into classes(nom, etablissement_id) values ($1,$2) returning id', [nom, etab])).id;
}

/* Une classe passée par son identifiant numérique vient du client : elle doit être
   vérifiée, pas crue. Sans ce contrôle, un professeur pouvait ranger un élève dans une
   classe d'un autre établissement en changeant un nombre dans la requête — l'élève
   disparaissait alors de son propre tableau de bord pour apparaître dans celui du
   voisin. Renvoie l'identifiant s'il est bien du bon établissement, lève sinon. */
export async function classeDeLEtablissement(classeId, etablissementId) {
  if (classeId == null) return null;
  const c = await db.une('select id from classes where id = $1 and etablissement_id = $2',
    [Number(classeId), Number(etablissementId)]);
  if (!c) throw new Error('Classe inconnue dans cet établissement.');
  return c.id;
}

/* Renvoie { id, identifiant, motdepasse } — le mot de passe en clair n'existe qu'ici,
   dans cette réponse, et nulle part ailleurs ensuite. */
export async function creerCompte({ prenom, nom, classe, classe_id, etablissement_id,
                                    role = 'eleve', mdp, forme, acteur }) {
  if (!prenom || !nom) throw new Error('Prénom et nom obligatoires.');
  if (!['eleve', 'prof', 'admin'].includes(role)) throw new Error('Rôle inconnu.');

  /* Un élève ou un professeur appartient toujours à un établissement — c'est la
     frontière, elle ne se pose pas après coup. L'administrateur, lui, n'appartient à
     aucun : il gère les établissements, il n'y enseigne pas. */
  const etab = role === 'admin' ? null : Number(etablissement_id);
  if (role !== 'admin' && !Number.isInteger(etab)) {
    throw new Error('Établissement obligatoire pour un compte élève ou enseignant.');
  }

  const clair = mdp || generer(formePour(role, forme));
  if (role !== 'eleve' && clair.length < 12) {
    throw new Error('Un compte enseignant ou administrateur voit beaucoup : 12 caractères minimum.');
  }

  const cid = classe_id != null
    ? await classeDeLEtablissement(classe_id, etab)
    : await classeId(classe, etab);
  const identifiant = await identifiantLibre(prenom, nom, role);

  const c = await db.une(
    `insert into comptes(identifiant, prenom, nom, classe_id, etablissement_id, role, mdp, doit_changer_mdp)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [identifiant, prenom, nom, cid, etab, role, await auth.hacher(clair), role === 'eleve']);

  await db.q('insert into progressions(compte_id) values ($1) on conflict do nothing', [c.id]);
  await db.journaliser(acteur || 'cli', 'compte.creation', identifiant,
    { role, classe: classe || null }, etab);

  return { id: c.id, identifiant, motdepasse: clair };
}

/* Toutes les sessions ouvertes tombent : c'est le but d'une réinitialisation. */
export async function reinitialiserMdp(identifiant, { mdp, forme, acteur } = {}) {
  const c = await db.une(
    'select id, role, etablissement_id from comptes where identifiant = $1', [identifiant]);
  if (!c) throw new Error(`Compte « ${identifiant} » introuvable.`);

  const clair = mdp || generer(formePour(c.role, forme));
  await db.q('update comptes set mdp = $2, doit_changer_mdp = $3 where id = $1',
    [c.id, await auth.hacher(clair), c.role === 'eleve']);
  await db.q('delete from sessions where compte_id = $1', [c.id]);
  await db.journaliser(acteur || 'cli', 'compte.mdp', identifiant, null, c.etablissement_id);

  return { id: c.id, identifiant, motdepasse: clair };
}

/* --------------------------------------------------------------------------
 * Passage à l'année suivante
 *
 * Une règle par classe de départ : ses élèves PASSENT dans une autre classe, ou leurs
 * comptes sont SUPPRIMÉS (fin de 3e, fin de CAP). Une classe sans règle ne bouge pas.
 * Les règles se lisent par NOM de classe, insensible à la casse, et non par identifiant
 * numérique : on les règle une année pour la suivante, et une « 5e » supprimée puis
 * recréée entre-temps doit rester la même 5e.
 *
 * Le défaut couvre les classes que pose poserClassesDeBase(). Les autres classes (6eB,
 * ULIS…) ne bougent pas tant que l'enseignant ne leur a pas donné de règle.
 * -------------------------------------------------------------------------- */
export const PASSAGE_DEFAUT = [
  { de: '6e',   action: 'passer', vers: '5e' },
  { de: '5e',   action: 'passer', vers: '4e' },
  { de: '4e',   action: 'passer', vers: '3e' },
  { de: '3e',   action: 'supprimer' },
  { de: 'CAP1', action: 'passer', vers: 'CAP2' },
  { de: 'CAP2', action: 'supprimer' }
];

/* Un passage refait moins de 300 jours après le précédent ferait monter tout le monde
   d'une classe de trop : il faut alors le demander explicitement (`forcer`). */
export const PASSAGE_JOURS_MIN = 300;

function refus(code, message) { return Object.assign(new Error(message), { code }); }

/* Les règles viennent du navigateur : on les relit entièrement plutôt que de les croire.
   Un même départ ne peut avoir qu'une règle — deux règles pour la 4e, ce seraient deux
   destinations pour les mêmes élèves. */
export function normaliserPassage(brut) {
  if (!Array.isArray(brut)) throw refus(400, 'Liste de règles attendue.');
  if (brut.length > 100) throw refus(413, 'Trop de règles.');
  const vus = new Set();
  const regles = [];
  for (const r of brut) {
    const de = String(r?.de ?? '').trim().slice(0, 30);
    if (!de) throw refus(400, 'Chaque règle doit nommer sa classe de départ.');
    if (vus.has(de.toLowerCase())) throw refus(400, `La classe « ${de} » a deux règles.`);
    vus.add(de.toLowerCase());

    if (r.action === 'supprimer') { regles.push({ de, action: 'supprimer' }); continue; }
    if (r.action !== 'passer') throw refus(400, `Règle de « ${de} » : action inconnue.`);
    const vers = String(r.vers ?? '').trim().slice(0, 30);
    if (!vers) throw refus(400, `Règle de « ${de} » : classe d'arrivée manquante.`);
    if (vers.toLowerCase() === de.toLowerCase()) {
      throw refus(400, `« ${de} » ne peut pas passer dans elle-même.`);
    }
    regles.push({ de, action: 'passer', vers });
  }
  return regles;
}

export async function reglesDePassage(etablissementId) {
  const e = await db.une('select passage, passage_le from etablissements where id = $1',
    [Number(etablissementId)]);
  if (!e) throw refus(404, 'Établissement introuvable.');
  return { regles: e.passage || PASSAGE_DEFAUT, parDefaut: !e.passage, derniere: e.passage_le,
           joursMin: PASSAGE_JOURS_MIN };
}

/* `null` remet le défaut — et le défaut n'est pas recopié en base, cf. schema.sql. */
export async function enregistrerPassage(etablissementId, brut, acteur) {
  const regles = brut == null ? null : normaliserPassage(brut);
  await db.q('update etablissements set passage = $2 where id = $1',
    [Number(etablissementId), regles ? JSON.stringify(regles) : null]);
  await db.journaliser(acteur, 'passage.reglages', null, { regles }, etablissementId);
  return reglesDePassage(etablissementId);
}

/* Applique les règles ENREGISTRÉES, en une seule transaction : un passage à moitié
 * fait — les 3e supprimés mais les 4e pas encore montés — ne se rattrape pas en le
 * relançant, il ferait monter une seconde fois ceux qui étaient déjà passés.
 *
 * Toutes les classes sont lues AVANT le premier déplacement. Sans cette photographie,
 * l'ordre des règles compterait : appliquer « 5e → 4e » avant « 4e → 3e » enverrait
 * les anciens 5e jusqu'en 3e. Avec elle, l'ordre est indifférent, et même un échange
 * (A → B et B → A) fait ce qu'on attend.
 *
 * `attendu` = { deplaces, supprimes } tels que le tableau de bord les a annoncés à
 * l'enseignant. S'ils ne correspondent plus (un collègue a déplacé un élève entre-temps,
 * le passage vient d'être fait dans un autre onglet), on refuse : on n'exécute que ce
 * qui a été montré et confirmé.
 *
 * Seuls les ÉLÈVES bougent ; un compte enseignant rangé dans une classe reste où il est.
 * La suppression emporte progression, sessions, présence et projets MakeCode (cascade).
 */
export async function passerAnneeSuivante(etablissementId, { attendu, forcer, acteur } = {}) {
  const etab = Number(etablissementId);
  const bilan = await db.transaction(async (t) => {
    /* `for update` : deux passages lancés en même temps (deux onglets, deux collègues)
       s'attendent l'un l'autre, et le second trouve la date posée par le premier. */
    const e = (await t.query(
      'select passage, passage_le from etablissements where id = $1 for update', [etab])).rows[0];
    if (!e) throw refus(404, 'Établissement introuvable.');
    if (e.passage_le && !forcer &&
        Date.now() - new Date(e.passage_le).getTime() < PASSAGE_JOURS_MIN * 864e5) {
      throw refus(409, `La nouvelle année a déjà été démarrée le ${
        new Date(e.passage_le).toLocaleDateString('fr-FR')}.`);
    }
    const regles = e.passage || PASSAGE_DEFAUT;

    const photo = [];
    for (const r of regles) {
      const { rows } = await t.query(
        `select c.id, c.identifiant from comptes c join classes cl on cl.id = c.classe_id
          where c.etablissement_id = $1 and c.role = 'eleve' and lower(cl.nom) = lower($2)`,
        [etab, r.de]);
      photo.push({ ...r, comptes: rows });
    }
    const compter = (action) => photo.filter((p) => p.action === action)
      .reduce((n, p) => n + p.comptes.length, 0);
    const res = { deplaces: compter('passer'), supprimes: compter('supprimer') };
    if (attendu && (Number(attendu.deplaces) !== res.deplaces ||
                    Number(attendu.supprimes) !== res.supprimes)) {
      throw refus(409, 'Les classes ont changé depuis l\'aperçu. Rouvre la fenêtre pour voir ' +
        'ce qui va réellement se passer.');
    }

    const supprimes = [];
    const classes = [];
    for (const p of photo) {
      const ids = p.comptes.map((c) => c.id);
      if (p.action === 'supprimer') {
        if (ids.length) await t.query('delete from comptes where id = any($1::int[])', [ids]);
        supprimes.push(...p.comptes.map((c) => c.identifiant));
        classes.push({ de: p.de, action: 'supprimer', n: ids.length });
        continue;
      }
      /* La classe d'arrivée est créée si elle manque, comme partout ailleurs (classeId) :
         la règle a été réglée l'an dernier, la classe a pu être supprimée depuis. Elle
         prend le rang de la classe de départ, pour ne pas surgir en tête des pastilles. */
      if (ids.length) {
        const cible = (await t.query(
          'select id from classes where etablissement_id = $1 and lower(nom) = lower($2)',
          [etab, p.vers])).rows[0] || (await t.query(
          `insert into classes(nom, ordre, etablissement_id)
           select $1, coalesce((select ordre from classes
                                 where etablissement_id = $2 and lower(nom) = lower($3)), 0), $2
           returning id`,
          [p.vers, etab, p.de])).rows[0];
        await t.query('update comptes set classe_id = $2 where id = any($1::int[])', [ids, cible.id]);
      }
      classes.push({ de: p.de, action: 'passer', vers: p.vers, n: ids.length });
    }

    await t.query('update etablissements set passage_le = now() where id = $1', [etab]);
    return { ...res, classes, identifiants: supprimes };
  });

  /* Après la transaction : journaliser() écrit sur une autre connexion de la réserve. */
  await db.journaliser(acteur, 'passage.annee', null, {
    deplaces: bilan.deplaces, supprimes: bilan.supprimes, classes: bilan.classes,
    identifiants: bilan.identifiants.slice(0, 500)
  }, etab);
  return { deplaces: bilan.deplaces, supprimes: bilan.supprimes, classes: bilan.classes };
}
