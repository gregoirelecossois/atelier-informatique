/* Création et entretien des comptes — partagé par l'outil en ligne de commande et par
 * le tableau de bord enseignant.
 *
 * Ce module existe pour une seule raison : un compte créé depuis le navigateur et un
 * compte créé en SSH doivent être rigoureusement identiques. Même façon de fabriquer
 * l'identifiant, même politique de mot de passe, même trace au journal. Deux chemins de
 * création, c'est deux comportements qui divergent au premier correctif appliqué d'un
 * seul côté.
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

/* prenom.n, puis prenom.nom si c'est pris, puis prenom.n2, prenom.n3… */
export async function identifiantLibre(prenom, nom) {
  const p = sansAccent(prenom).toLowerCase().replace(/[^a-z]/g, '');
  const n = sansAccent(nom).toLowerCase().replace(/[^a-z]/g, '');
  if (!p || !n) throw new Error('Prénom et nom doivent contenir des lettres.');

  const essais = [`${p}.${n[0]}`, `${p}.${n.slice(0, 3)}`, `${p}.${n}`];
  for (let i = 2; i <= 30; i++) essais.push(`${p}.${n[0]}${i}`);
  for (const id of essais) {
    if (!(await db.une('select 1 from comptes where identifiant = $1', [id]))) return id;
  }
  throw new Error('Impossible de trouver un identifiant libre.');
}

/* Crée la classe si elle n'existe pas : en pratique on tape « 5eB » avant d'avoir pensé
   à la déclarer, et refuser à ce moment-là ne rend service à personne. */
export async function classeId(nom) {
  if (!nom) return null;
  const c = await db.une('select id from classes where lower(nom) = lower($1)', [nom]);
  if (c) return c.id;
  return (await db.une('insert into classes(nom) values ($1) returning id', [nom])).id;
}

/* Renvoie { id, identifiant, motdepasse } — le mot de passe en clair n'existe qu'ici,
   dans cette réponse, et nulle part ailleurs ensuite. */
export async function creerCompte({ prenom, nom, classe, classe_id, role = 'eleve', mdp, forme, acteur }) {
  if (!prenom || !nom) throw new Error('Prénom et nom obligatoires.');
  if (role !== 'eleve' && role !== 'prof') throw new Error('Rôle inconnu.');

  const clair = mdp || generer(formePour(role, forme));
  if (role === 'prof' && clair.length < 12) {
    throw new Error('Le compte enseignant voit toute la base : 12 caractères minimum.');
  }

  const cid = classe_id != null ? classe_id : await classeId(classe);
  const identifiant = await identifiantLibre(prenom, nom);

  const c = await db.une(
    `insert into comptes(identifiant, prenom, nom, classe_id, role, mdp, doit_changer_mdp)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [identifiant, prenom, nom, cid, role, await auth.hacher(clair), role === 'eleve']);

  await db.q('insert into progressions(compte_id) values ($1) on conflict do nothing', [c.id]);
  await db.journaliser(acteur || 'cli', 'compte.creation', identifiant, { role, classe: classe || null });

  return { id: c.id, identifiant, motdepasse: clair };
}

/* Toutes les sessions ouvertes tombent : c'est le but d'une réinitialisation. */
export async function reinitialiserMdp(identifiant, { mdp, forme, acteur } = {}) {
  const c = await db.une('select id, role from comptes where identifiant = $1', [identifiant]);
  if (!c) throw new Error(`Compte « ${identifiant} » introuvable.`);

  const clair = mdp || generer(formePour(c.role, forme));
  await db.q('update comptes set mdp = $2, doit_changer_mdp = $3 where id = $1',
    [c.id, await auth.hacher(clair), c.role === 'eleve']);
  await db.q('delete from sessions where compte_id = $1', [c.id]);
  await db.journaliser(acteur || 'cli', 'compte.mdp', identifiant, null);

  return { id: c.id, identifiant, motdepasse: clair };
}
