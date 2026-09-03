#!/usr/bin/env node
/* Outil d'administration en ligne de commande.
 *
 * Il double le tableau de bord enseignant pour tout ce qui se fait mieux en SSH :
 * l'import d'une classe entière, l'inspection, la purge. La création de comptes et la
 * politique de mots de passe viennent de ../comptes.js et ../motsdepasse.js, partagés
 * avec le serveur — un compte créé ici et un compte créé depuis le navigateur sont
 * rigoureusement identiques.
 *
 * Les mots de passe en clair n'apparaissent qu'une fois, à l'écran ou dans le fichier à
 * imprimer, et ne sont plus jamais récupérables : la base ne contient que leur empreinte.
 *
 *   node outils/atl.mjs init
 *   node outils/atl.mjs classes
 *   node outils/atl.mjs classe <nom> [ordre]
 *   node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--mdp X] [--court|--prononcable]
 *   node outils/atl.mjs liste [classe]
 *   node outils/atl.mjs mdp <identifiant> [--mdp X] [--court|--prononcable]
 *   node outils/atl.mjs activer|desactiver <identifiant>
 *   node outils/atl.mjs supprimer <identifiant> --oui
 *   node outils/atl.mjs importer <fichier.csv> [--court]
 *   node outils/atl.mjs purger [--mois 24] [--oui]
 *   node outils/atl.mjs entropie
 */
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../db.js';
import { creerCompte, reinitialiserMdp } from '../comptes.js';
import {
  CONSONNES, VOYELLES, ALPHABET, ALPHABET_COFFRE,
  GROUPES, SYLLABES_PAR_GROUPE, LONGUEUR_COURT, LONGUEUR_COFFRE,
  BITS_PRONONCABLE, BITS_COURT, BITS_COFFRE, generer
} from '../motsdepasse.js';

const args = process.argv.slice(2);
const commande = args[0];
const positionnels = args.slice(1).filter((a) => !a.startsWith('--'));
const options = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
  })
);
/* `--mdp X` en deux mots : la forme la plus naturelle à taper. */
for (const cle of ['mdp', 'mois']) {
  if (options[cle] === true) {
    const i = args.indexOf('--' + cle);
    if (args[i + 1] && !args[i + 1].startsWith('--')) {
      options[cle] = args[i + 1];
      positionnels.splice(positionnels.indexOf(args[i + 1]), 1);
    }
  }
}
const forme = options.court ? 'court' : options.prononcable ? 'prononcable' : undefined;
const mdpImpose = typeof options.mdp === 'string' ? options.mdp : undefined;

/* --------------------------------------------------------------------------
   Commandes
   -------------------------------------------------------------------------- */
const commandes = {
  async init() {
    await db.migrer();
    const base = ['6e', '5e', '4e', '3e', 'CAP1', 'CAP2'];
    for (let i = 0; i < base.length; i++) {
      await db.q('insert into classes(nom, ordre) values ($1,$2) on conflict (nom) do nothing', [base[i], i]);
    }
    console.log('Schéma appliqué, classes de base en place.');
    console.log('Crée maintenant ton compte enseignant :');
    console.log('  node outils/atl.mjs creer Prenom Nom --prof');
  },

  async classes() {
    const r = await db.q(
      `select cl.nom, cl.ordre, count(c.id)::int as eleves
         from classes cl left join comptes c on c.classe_id = cl.id
        group by cl.id order by cl.ordre, cl.nom`);
    if (!r.rows.length) return console.log('Aucune classe. Lance « init » d’abord.');
    for (const c of r.rows) console.log(`  ${c.nom.padEnd(10)} ${String(c.eleves).padStart(3)} élève(s)`);
  },

  async classe() {
    const [nom, ordre] = positionnels;
    if (!nom) throw new Error('Usage : classe <nom> [ordre]');
    await db.q(
      `insert into classes(nom, ordre) values ($1,$2)
       on conflict (nom) do update set ordre = excluded.ordre`, [nom, Number(ordre || 0)]);
    console.log(`Classe « ${nom} » enregistrée.`);
  },

  async creer() {
    const [prenom, nom, classe] = positionnels;
    if (!prenom || !nom) throw new Error('Usage : creer <prenom> <nom> [classe] [--prof] [--mdp X] [--court]');

    const role = options.prof ? 'prof' : 'eleve';
    const c = await creerCompte({ prenom, nom, classe, role, mdp: mdpImpose, forme, acteur: 'cli' });

    console.log('');
    console.log(`  ${role === 'prof' ? 'ENSEIGNANT' : 'Élève'} : ${prenom} ${nom}${classe ? ' · ' + classe : ''}`);
    console.log(`  Identifiant   : ${c.identifiant}`);
    console.log(`  Mot de passe  : ${c.motdepasse}${role === 'prof' ? '' : '   (provisoire)'}`);
    console.log('');
    console.log('  Note-le maintenant : il n’est plus affiché ensuite.');
    if (role !== 'prof') {
      console.log('  À sa première connexion, l’élève devra choisir lui-même son mot de passe.');
    }
  },

  async liste() {
    const [classe] = positionnels;
    const r = await db.q(
      `select c.identifiant, c.prenom, c.nom, c.role, c.actif, c.derniere_connexion,
              cl.nom as classe, coalesce(p.version,0) as version
         from comptes c
         left join classes cl on cl.id = c.classe_id
         left join progressions p on p.compte_id = c.id
        where $1::text is null or lower(cl.nom) = lower($1)
        order by cl.ordre nulls last, cl.nom, c.nom, c.prenom`, [classe || null]);

    if (!r.rows.length) return console.log('Aucun compte.');
    console.log('');
    console.log('  IDENTIFIANT          NOM                       CLASSE    DERNIÈRE CONNEXION');
    for (const c of r.rows) {
      const quand = c.derniere_connexion ? new Date(c.derniere_connexion).toLocaleString('fr-FR') : '—';
      const marque = !c.actif ? ' (désactivé)' : c.role === 'prof' ? ' (prof)' : '';
      console.log(`  ${c.identifiant.padEnd(20)} ${(c.prenom + ' ' + c.nom).padEnd(25)} ${(c.classe || '—').padEnd(9)} ${quand}${marque}`);
    }
    console.log(`\n  ${r.rows.length} compte(s).`);
  },

  async mdp() {
    const [identifiant] = positionnels;
    if (!identifiant) throw new Error('Usage : mdp <identifiant> [--mdp X] [--court]');
    const c = await reinitialiserMdp(identifiant, { mdp: mdpImpose, forme, acteur: 'cli' });
    console.log(`\n  ${c.identifiant} → nouveau mot de passe provisoire : ${c.motdepasse}`);
    console.log('  Il en choisira un lui-même à sa prochaine connexion.\n');
  },

  async activer() { await basculer(true); },
  async desactiver() { await basculer(false); },

  async supprimer() {
    const [identifiant] = positionnels;
    if (!identifiant) throw new Error('Usage : supprimer <identifiant>');
    if (!options.oui) {
      console.log(`Supprime définitivement « ${identifiant} », progression et trophées compris.`);
      console.log('Confirme en ajoutant --oui.');
      return;
    }
    const r = await db.q('delete from comptes where identifiant = $1', [identifiant]);
    await db.journaliser('cli', 'compte.suppression', identifiant, null);
    console.log(r.rowCount ? `« ${identifiant} » supprimé.` : `« ${identifiant} » introuvable.`);
  },

  async importer() {
    const [fichier] = positionnels;
    if (!fichier) throw new Error('Usage : importer <fichier.csv>   (colonnes : prenom;nom;classe)');

    const lignes = fs.readFileSync(fichier, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
      .map((l) => l.trim()).filter(Boolean);
    const sortie = [];
    let ignorees = 0;

    for (const ligne of lignes) {
      const champs = ligne.split(/[;,\t]/).map((s) => s.trim());
      if (/^pr[ée]nom$/i.test(champs[0])) continue;                 /* en-tête */
      const [prenom, nom, classe] = champs;
      if (!prenom || !nom) { ignorees++; continue; }

      const c = await creerCompte({ prenom, nom, classe, role: 'eleve', forme, acteur: 'cli' });
      sortie.push([classe || '', prenom, nom, c.identifiant, c.motdepasse]);
    }

    const nomSortie = path.join(path.dirname(path.resolve(fichier)),
      `identifiants-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.writeFileSync(nomSortie,
      '﻿classe;prenom;nom;identifiant;motdepasse\n' + sortie.map((l) => l.join(';')).join('\n') + '\n',
      { encoding: 'utf8', mode: 0o600 });

    await db.journaliser('cli', 'comptes.import', null, { crees: sortie.length, ignorees });
    console.log(`\n  ${sortie.length} compte(s) créé(s)${ignorees ? `, ${ignorees} ligne(s) ignorée(s)` : ''}.`);
    console.log(`  Identifiants à imprimer : ${nomSortie}`);
    console.log('  ⚠ Ce fichier contient les mots de passe EN CLAIR : imprime-le, distribue-le, puis SUPPRIME-LE.');
    console.log('  Ces mots de passe sont PROVISOIRES : chaque élève en choisira un à sa première connexion.\n');
  },

  /* Conservation limitée dans le temps (RGPD art. 5.1.e).
     Le serveur fait déjà cette purge tout seul, une fois par jour : cette commande
     sert à REGARDER ce qui va partir, ou à forcer le passage tout de suite. */
  async purger() {
    const mois = Number(options.mois || process.env.CONSERVATION_MOIS || 24);
    if (!Number.isFinite(mois) || mois < 1) throw new Error('Usage : purger [--mois 24] [--oui]');

    const vises = await db.q(
      `select identifiant, cree_le from comptes
        where role = 'eleve' and cree_le < now() - ($1 || ' months')::interval
        order by cree_le`, [String(mois)]);

    if (!vises.rows.length) return console.log(`Aucun compte élève n'a plus de ${mois} mois.`);

    if (!options.oui) {
      console.log(`${vises.rows.length} compte(s) élève créé(s) il y a plus de ${mois} mois :`);
      for (const c of vises.rows.slice(0, 20)) {
        console.log(`  ${c.identifiant.padEnd(20)} créé le ${new Date(c.cree_le).toLocaleDateString('fr-FR')}`);
      }
      if (vises.rows.length > 20) console.log(`  … et ${vises.rows.length - 20} autre(s)`);
      console.log('\nConfirme la suppression définitive en ajoutant --oui.');
      return;
    }
    const r = await db.q(
      `delete from comptes where role = 'eleve' and cree_le < now() - ($1 || ' months')::interval`,
      [String(mois)]);
    await db.journaliser('cli', 'comptes.purge', null, { mois, supprimes: r.rowCount });
    console.log(`${r.rowCount} compte(s) supprimé(s).`);
  },

  /* De quoi répondre au DPD sans avoir à le croire sur parole. */
  async entropie() {
    const ex = (n, f) => Array.from({ length: n }, f).join('\n                  ');
    console.log('');
    console.log(`  Prononçable (élèves)   ${BITS_PRONONCABLE.toFixed(1)} bits`);
    console.log(`     ${GROUPES} groupes × ${SYLLABES_PAR_GROUPE} syllabes, ${CONSONNES.length} consonnes × ${VOYELLES.length} voyelles`);
    console.log(`     exemples :   ${ex(3, () => generer('prononcable'))}`);
    console.log('');
    console.log(`  Court (--court)        ${BITS_COURT.toFixed(1)} bits`);
    console.log(`     ${LONGUEUR_COURT} caractères d'un alphabet de ${ALPHABET.length} sans glyphe ambigu`);
    console.log(`     exemples :   ${ex(3, () => generer('court'))}`);
    console.log('');
    console.log(`  Coffre (défaut --prof) ${BITS_COFFRE.toFixed(1)} bits`);
    console.log(`     ${LONGUEUR_COFFRE} caractères d'un alphabet de ${ALPHABET_COFFRE.length}, pour un gestionnaire de mots de passe`);
    console.log(`     exemples :   ${ex(3, () => generer('coffre'))}`);
    console.log('');
    console.log(`  Seuil CNIL 2022-100 avec restriction d'accès : 50 bits.`);
    console.log(`  Restriction en place : 10 essais par identifiant et 40 par IP, sur 10 minutes.`);
    console.log('');
  }
};

async function basculer(actif) {
  const [identifiant] = positionnels;
  if (!identifiant) throw new Error(`Usage : ${actif ? 'activer' : 'desactiver'} <identifiant>`);
  const r = await db.q('update comptes set actif = $2 where identifiant = $1', [identifiant, actif]);
  if (!actif) await db.q(
    'delete from sessions where compte_id = (select id from comptes where identifiant = $1)', [identifiant]);
  await db.journaliser('cli', actif ? 'compte.activation' : 'compte.desactivation', identifiant, null);
  console.log(r.rowCount ? `« ${identifiant} » ${actif ? 'activé' : 'désactivé'}.` : `« ${identifiant} » introuvable.`);
}

/* -------------------------------------------------------------------------- */
const AIDE = `
  node outils/atl.mjs init
  node outils/atl.mjs classes
  node outils/atl.mjs classe <nom> [ordre]
  node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--mdp X] [--court|--prononcable]
  node outils/atl.mjs liste [classe]
  node outils/atl.mjs mdp <identifiant> [--mdp X] [--court|--prononcable]
  node outils/atl.mjs activer|desactiver <identifiant>
  node outils/atl.mjs supprimer <identifiant> --oui
  node outils/atl.mjs importer <fichier.csv> [--court]
  node outils/atl.mjs purger [--mois 24] [--oui]
  node outils/atl.mjs entropie
`;

const fn = commandes[commande];
let code = 0;

if (!fn) {
  if (commande) { console.error(`\n  Commande inconnue : « ${commande} »`); code = 1; }
  console.log(AIDE);
} else {
  try {
    await fn();
  } catch (e) {
    console.error('\n  Erreur : ' + e.message + '\n');
    code = 1;
  }
}

/* On ferme la réserve AVANT de sortir : process.exit() ne laisse pas tourner un bloc
   finally, et une connexion PostgreSQL abandonnée reste comptée un moment. */
await db.pool.end().catch(() => {});
process.exit(code);
