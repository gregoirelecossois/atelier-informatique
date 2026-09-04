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
