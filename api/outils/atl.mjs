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
 * L'ÉTABLISSEMENT EST LA FRONTIÈRE, ici comme dans l'API : toute commande qui touche
 * une classe ou un compte élève sait dans quel collège elle travaille. `--etab` accepte
 * un numéro ou un nom. Tant qu'il n'y a qu'UN établissement dans la base, on peut
 * l'omettre : il n'y a pas d'ambiguïté à lever. Dès qu'il y en a deux, l'omettre est une
 * erreur et non un choix par défaut — c'est exactement le moment où se glisserait un
 * élève créé dans le mauvais collège.
 *
 *   node outils/atl.mjs init
 *   node outils/atl.mjs etablissements
 *   node outils/atl.mjs etablissement <nom> [ville]
 *   node outils/atl.mjs renommer <id> <nom> [ville]
 *   node outils/atl.mjs fermer|rouvrir <id>
 *   node outils/atl.mjs admin <prenom> <nom> [--mdp X]
 *   node outils/atl.mjs classes [--etab X]
 *   node outils/atl.mjs classe <nom> [ordre] [--etab X]
 *   node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--etab X] [--mdp X] [--court|--prononcable]
 *   node outils/atl.mjs liste [classe] [--etab X]
 *   node outils/atl.mjs mdp <identifiant> [--mdp X] [--court|--prononcable]
 *   node outils/atl.mjs activer|desactiver <identifiant>
 *   node outils/atl.mjs supprimer <identifiant> --oui
 *   node outils/atl.mjs importer <fichier.csv> [--etab X] [--court]
 *   node outils/atl.mjs purger [--mois 24] [--oui]
 *   node outils/atl.mjs entropie
 */
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../db.js';
import { creerCompte, reinitialiserMdp, poserClassesDeBase } from '../comptes.js';
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
for (const cle of ['mdp', 'mois', 'etab']) {
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
   L'établissement de travail

   Passé par `--etab`, en numéro ou en nom. S'il n'y en a qu'un dans la base, il est
   pris tout seul : imposer l'option à quelqu'un qui n'a qu'un collège n'ajoute aucune
   sécurité, seulement de la friction. Au deuxième, en revanche, on refuse de deviner —
   un élève créé dans le mauvais établissement est invisible de son professeur et
   visible d'un autre, et rien à l'écran ne le signale.
   -------------------------------------------------------------------------- */
async function etablissementDeTravail() {
  const demande = typeof options.etab === 'string' ? options.etab.trim() : '';

  if (demande) {
    const e = /^\d+$/.test(demande)
      ? await db.une('select id, nom, ville from etablissements where id = $1', [Number(demande)])
      : await db.une(
          'select id, nom, ville from etablissements where lower(nom) = lower($1)', [demande]);
    if (!e) throw new Error(`Établissement « ${demande} » introuvable (voir « etablissements »).`);
    return e;
  }

  const tous = (await db.q('select id, nom, ville from etablissements order by id')).rows;
  if (!tous.length) {
    throw new Error('Aucun établissement. Crée-le d\'abord :\n' +
      '    node outils/atl.mjs etablissement "Collège Jean Moulin" "Ville"');
  }
  if (tous.length > 1) {
    throw new Error('Plusieurs établissements : précise lequel avec --etab <numéro|nom>.\n' +
      tous.map((e) => `    ${String(e.id).padStart(3)}  ${e.nom}${e.ville ? ' · ' + e.ville : ''}`).join('\n'));
  }
  return tous[0];
}

function etiquette(e) { return `${e.nom}${e.ville ? ' · ' + e.ville : ''}`; }

/* --------------------------------------------------------------------------
   Commandes
   -------------------------------------------------------------------------- */
const commandes = {
  /* `init` ne crée plus de classes : une classe appartient à un établissement, et il
     n'y en a pas encore. L'ordre est désormais établissement → enseignant → élèves. */
  async init() {
    await db.migrer();
    console.log('Schéma appliqué.');
    console.log('');
    console.log('Dans l\'ordre :');
    console.log('  node outils/atl.mjs admin Prenom Nom                        (gère les établissements)');
    console.log('  node outils/atl.mjs etablissement "Collège Jean Moulin" "Ville"');
    console.log('  node outils/atl.mjs creer Prenom Nom --prof                 (enseignant du collège)');
  },

  async etablissements() {
    const r = await db.q(
      `select e.id, e.nom, e.ville, e.actif,
              count(*) filter (where c.role = 'eleve')::int as eleves,
              count(*) filter (where c.role = 'prof')::int  as profs,
              (select count(*)::int from classes cl where cl.etablissement_id = e.id) as classes
         from etablissements e
         left join comptes c on c.etablissement_id = e.id
        group by e.id order by e.id`);
    if (!r.rows.length) return console.log('Aucun établissement.');
    console.log('');
    console.log('   ID  ÉTABLISSEMENT                        CLASSES  PROFS  ÉLÈVES');
    for (const e of r.rows) {
      console.log(`  ${String(e.id).padStart(3)}  ${etiquette(e).padEnd(36)} ` +
        `${String(e.classes).padStart(7)} ${String(e.profs).padStart(6)} ${String(e.eleves).padStart(7)}` +
        (e.actif ? '' : '   (fermé)'));
    }
    console.log('');
  },

  async etablissement() {
    const [nom, ville] = positionnels;
    if (!nom) throw new Error('Usage : etablissement <nom> [ville]');
    const deja = await db.une(
      'select id from etablissements where lower(nom) = lower($1) and lower(ville) = lower($2)',
      [nom, ville || '']);
    if (deja) throw new Error(`« ${nom} » existe déjà (numéro ${deja.id}).`);

    const e = await db.une(
      'insert into etablissements(nom, ville) values ($1,$2) returning id', [nom, ville || '']);
    await poserClassesDeBase(e.id);
    await db.journaliser('cli', 'etablissement.creation', nom, { ville: ville || '' }, e.id);
    console.log(`\n  Établissement « ${nom} » créé, numéro ${e.id}, classes de base en place.`);
    console.log(`  node outils/atl.mjs creer Prenom Nom --prof --etab ${e.id}\n`);
  },

  async renommer() {
    const [id, nom, ville] = positionnels;
    if (!id || !nom) throw new Error('Usage : renommer <id> <nom> [ville]');
    const champs = ville != null ? 'nom = $2, ville = $3' : 'nom = $2';
    const vals = ville != null ? [Number(id), nom, ville] : [Number(id), nom];
    const r = await db.q(`update etablissements set ${champs} where id = $1`, vals);
    if (!r.rowCount) throw new Error(`Établissement ${id} introuvable.`);
    await db.journaliser('cli', 'etablissement.modification', nom, { ville }, Number(id));
    console.log(`Établissement ${id} → « ${nom}${ville ? ' · ' + ville : ''} ».`);
  },

  async fermer() { await basculerEtablissement(false); },
  async rouvrir() { await basculerEtablissement(true); },

  /* Le compte qui gère les établissements et les comptes enseignants — et qui ne voit
     aucun élève. Il n'appartient à aucun établissement : c'est la seule exception, et
     elle est portée par une contrainte de la base, pas par une convention. */
  async admin() {
    const [prenom, nom] = positionnels;
    if (!prenom || !nom) throw new Error('Usage : admin <prenom> <nom> [--mdp X]');
    const c = await creerCompte({ prenom, nom, role: 'admin', mdp: mdpImpose, forme, acteur: 'cli' });
    console.log('');
    console.log(`  ADMINISTRATEUR : ${prenom} ${nom}`);
    console.log(`  Identifiant   : ${c.identifiant}`);
    console.log(`  Mot de passe  : ${c.motdepasse}`);
    console.log('');
    console.log('  Note-le maintenant : il n\'est plus affiché ensuite.');
    console.log('  Ce compte ouvre admin.html, pas le tableau de bord des élèves.');
    console.log('');
  },

  async classes() {
    const e = await etablissementDeTravail();
    const r = await db.q(
      `select cl.nom, cl.ordre, count(c.id)::int as eleves
         from classes cl left join comptes c on c.classe_id = cl.id
        where cl.etablissement_id = $1
        group by cl.id order by cl.ordre, cl.nom`, [e.id]);
    console.log(`\n  ${etiquette(e)}`);
    if (!r.rows.length) return console.log('  Aucune classe.\n');
    for (const c of r.rows) console.log(`  ${c.nom.padEnd(10)} ${String(c.eleves).padStart(3)} élève(s)`);
    console.log('');
  },

  async classe() {
    const [nom, ordre] = positionnels;
    if (!nom) throw new Error('Usage : classe <nom> [ordre] [--etab X]');
    const e = await etablissementDeTravail();
    await db.q(
      `insert into classes(nom, ordre, etablissement_id) values ($1,$2,$3)
       on conflict (etablissement_id, lower(nom)) do update set ordre = excluded.ordre`,
      [nom, Number(ordre || 0), e.id]);
    console.log(`Classe « ${nom} » enregistrée dans ${etiquette(e)}.`);
  },

  async creer() {
    const [prenom, nom, classe] = positionnels;
    if (!prenom || !nom) throw new Error('Usage : creer <prenom> <nom> [classe] [--prof] [--etab X] [--mdp X] [--court]');

    const role = options.prof ? 'prof' : 'eleve';
    const e = await etablissementDeTravail();
    const c = await creerCompte({ prenom, nom, classe, role, etablissement_id: e.id,
                                  mdp: mdpImpose, forme, acteur: 'cli' });

    console.log('');
    console.log(`  ${etiquette(e)}`);
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
    const e = await etablissementDeTravail();
    const r = await db.q(
      `select c.identifiant, c.prenom, c.nom, c.role, c.actif, c.derniere_connexion,
              cl.nom as classe, coalesce(p.version,0) as version
         from comptes c
         left join classes cl on cl.id = c.classe_id
         left join progressions p on p.compte_id = c.id
        where c.etablissement_id = $2 and ($1::text is null or lower(cl.nom) = lower($1))
        order by cl.ordre nulls last, cl.nom, c.nom, c.prenom`, [classe || null, e.id]);

    if (!r.rows.length) return console.log(`Aucun compte dans ${etiquette(e)}.`);
    console.log('');
    console.log(`  ${etiquette(e)}`);
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
    const c = await db.une('select etablissement_id from comptes where identifiant = $1', [identifiant]);
    const r = await db.q('delete from comptes where identifiant = $1', [identifiant]);
    await db.journaliser('cli', 'compte.suppression', identifiant, null, c && c.etablissement_id);
    console.log(r.rowCount ? `« ${identifiant} » supprimé.` : `« ${identifiant} » introuvable.`);
  },

  async importer() {
    const [fichier] = positionnels;
    if (!fichier) throw new Error('Usage : importer <fichier.csv> [--etab X]   (colonnes : prenom;nom;classe)');
    const etab = await etablissementDeTravail();

    const lignes = fs.readFileSync(fichier, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
      .map((l) => l.trim()).filter(Boolean);
    const sortie = [];
    let ignorees = 0;

    for (const ligne of lignes) {
      const champs = ligne.split(/[;,\t]/).map((s) => s.trim());
      if (/^pr[ée]nom$/i.test(champs[0])) continue;                 /* en-tête */
      const [prenom, nom, classe] = champs;
      if (!prenom || !nom) { ignorees++; continue; }

      const c = await creerCompte({ prenom, nom, classe, role: 'eleve',
                                    etablissement_id: etab.id, forme, acteur: 'cli' });
      sortie.push([classe || '', prenom, nom, c.identifiant, c.motdepasse]);
    }

    const nomSortie = path.join(path.dirname(path.resolve(fichier)),
      `identifiants-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.writeFileSync(nomSortie,
      '﻿classe;prenom;nom;identifiant;motdepasse\n' + sortie.map((l) => l.join(';')).join('\n') + '\n',
      { encoding: 'utf8', mode: 0o600 });

    await db.journaliser('cli', 'comptes.import', null,
      { crees: sortie.length, ignorees }, etab.id);
    console.log(`\n  ${etiquette(etab)}`);
    console.log(`  ${sortie.length} compte(s) créé(s)${ignorees ? `, ${ignorees} ligne(s) ignorée(s)` : ''}.`);
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
      `delete from comptes where role = 'eleve' and cree_le < now() - ($1 || ' months')::interval
        returning etablissement_id`, [String(mois)]);
    /* Une ligne de journal par établissement : un chef d'établissement doit pouvoir
       savoir ce qui a été effacé chez lui sans qu'on lui montre le reste. */
    const parEtab = new Map();
    for (const l of r.rows) parEtab.set(l.etablissement_id, (parEtab.get(l.etablissement_id) || 0) + 1);
    for (const [etab, n] of parEtab) {
      await db.journaliser('cli', 'comptes.purge', null, { mois, supprimes: n }, etab);
    }
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
  const c = await db.une('select etablissement_id from comptes where identifiant = $1', [identifiant]);
  const r = await db.q('update comptes set actif = $2 where identifiant = $1', [identifiant, actif]);
  if (!actif) await db.q(
    'delete from sessions where compte_id = (select id from comptes where identifiant = $1)', [identifiant]);
  await db.journaliser('cli', actif ? 'compte.activation' : 'compte.desactivation', identifiant, null,
    c && c.etablissement_id);
  console.log(r.rowCount ? `« ${identifiant} » ${actif ? 'activé' : 'désactivé'}.` : `« ${identifiant} » introuvable.`);
}

/* Fermer un établissement n'efface rien : plus personne ne s'y connecte, et les sessions
   en cours tombent tout de suite. C'est ce qu'il faut d'une fin de contrat — le temps de
   restituer les données avant de les supprimer, sans qu'elles restent accessibles. */
async function basculerEtablissement(actif) {
  const [id] = positionnels;
  if (!id) throw new Error(`Usage : ${actif ? 'rouvrir' : 'fermer'} <id>`);
  const e = await db.une('select nom, ville from etablissements where id = $1', [Number(id)]);
  if (!e) throw new Error(`Établissement ${id} introuvable.`);
  await db.q('update etablissements set actif = $2 where id = $1', [Number(id), actif]);
  if (!actif) await db.q(
    'delete from sessions where compte_id in (select id from comptes where etablissement_id = $1)',
    [Number(id)]);
  await db.journaliser('cli', actif ? 'etablissement.ouverture' : 'etablissement.fermeture',
    e.nom, null, Number(id));
  console.log(`${etiquette(e)} ${actif ? 'rouvert' : 'fermé'}.`);
}

/* -------------------------------------------------------------------------- */
const AIDE = `
  node outils/atl.mjs init
  node outils/atl.mjs etablissements
  node outils/atl.mjs etablissement <nom> [ville]
  node outils/atl.mjs renommer <id> <nom> [ville]
  node outils/atl.mjs fermer|rouvrir <id>
  node outils/atl.mjs admin <prenom> <nom> [--mdp X]
  node outils/atl.mjs classes [--etab X]
  node outils/atl.mjs classe <nom> [ordre] [--etab X]
  node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--etab X] [--mdp X] [--court|--prononcable]
  node outils/atl.mjs liste [classe] [--etab X]
  node outils/atl.mjs mdp <identifiant> [--mdp X] [--court|--prononcable]
  node outils/atl.mjs activer|desactiver <identifiant>
  node outils/atl.mjs supprimer <identifiant> --oui
  node outils/atl.mjs importer <fichier.csv> [--etab X] [--court]
  node outils/atl.mjs purger [--mois 24] [--oui]
  node outils/atl.mjs entropie

  --etab : numéro ou nom. Facultatif tant qu'il n'y a qu'un établissement.
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
