#!/usr/bin/env node
/* Outil d'administration en ligne de commande.
 *
 * C'est lui qui crée les comptes tant que le tableau de bord (phase 2) n'existe pas.
 * Il tourne sur le serveur, jamais dans un navigateur : les mots de passe en clair
 * n'apparaissent qu'une seule fois, à l'écran ou dans le fichier à imprimer, et ne
 * sont plus jamais récupérables ensuite — la base ne contient que leur empreinte.
 *
 *   node outils/atl.mjs init
 *   node outils/atl.mjs classes
 *   node outils/atl.mjs classe <nom> [ordre]
 *   node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--mdp X] [--fort]
 *   node outils/atl.mjs liste [classe]
 *   node outils/atl.mjs mdp <identifiant> [--mdp X] [--fort]
 *   node outils/atl.mjs activer|desactiver <identifiant>
 *   node outils/atl.mjs supprimer <identifiant>
 *   node outils/atl.mjs importer <fichier.csv> [--fort]
 *   node outils/atl.mjs purger --avant AAAA-MM-JJ
 */
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as db from '../db.js';
import * as auth from '../auth.js';
import { MOTS, ALPHABET } from './mots.js';

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
for (const cle of ['mdp', 'avant']) {
  if (options[cle] === true) {
    const i = args.indexOf('--' + cle);
    if (args[i + 1] && !args[i + 1].startsWith('--')) {
      options[cle] = args[i + 1];
      positionnels.splice(positionnels.indexOf(args[i + 1]), 1);
    }
  }
}

/* --------------------------------------------------------------------------
   Mots de passe
   -------------------------------------------------------------------------- */
function motDePasse(fort) {
  if (fort) {
    /* ~50 bits : le palier « mot de passe seul + restriction d'accès » de la CNIL.
       Réservé au compte enseignant et aux établissements qui veulent la conformité
       stricte pour tout le monde. */
    const c = Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]);
    return `${c.slice(0, 4).join('')}-${c.slice(4, 7).join('')}-${c.slice(7).join('')}`;
  }
  /* ~30 bits, recopiable par un élève de 6e. Face à une attaque EN LIGNE — la seule
     possible ici, la base n'étant pas publique — la limitation à 10 essais par quart
     d'heure rend ce niveau très largement hors de portée. Voir README.md. */
  const m = () => MOTS[crypto.randomInt(MOTS.length)];
  return `${m()}-${m()}-${m()}${crypto.randomInt(10)}${crypto.randomInt(10)}`;
}

function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function identifiantLibre(prenom, nom) {
  const p = sansAccent(prenom).toLowerCase().replace(/[^a-z]/g, '');
  const n = sansAccent(nom).toLowerCase().replace(/[^a-z]/g, '');
  if (!p || !n) throw new Error('Prénom et nom doivent contenir des lettres.');

  const essais = [`${p}.${n[0]}`, `${p}.${n.slice(0, 3)}`, `${p}.${n}`];
  for (let i = 2; i <= 30; i++) essais.push(`${p}.${n[0]}${i}`);
  for (const id of essais) {
    const pris = await db.une('select 1 from comptes where identifiant = $1', [id]);
    if (!pris) return id;
  }
  throw new Error('Impossible de trouver un identifiant libre.');
}

async function classeId(nom) {
  if (!nom) return null;
  const c = await db.une('select id from classes where lower(nom) = lower($1)', [nom]);
  if (c) return c.id;
  const neuf = await db.une('insert into classes(nom) values ($1) returning id', [nom]);
  console.log(`  (classe « ${nom} » créée)`);
  return neuf.id;
}

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
    console.log('  node outils/atl.mjs creer Prenom Nom --prof --fort');
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
    if (!prenom || !nom) throw new Error('Usage : creer <prenom> <nom> [classe] [--prof] [--mdp X] [--fort]');

    const role = options.prof ? 'prof' : 'eleve';
    const clair = typeof options.mdp === 'string' ? options.mdp : motDePasse(options.fort || role === 'prof');
    if (role === 'prof' && clair.length < 12) {
      throw new Error('Le compte enseignant voit toute la base : 12 caractères minimum.');
    }

    const identifiant = await identifiantLibre(prenom, nom);
    const c = await db.une(
      `insert into comptes(identifiant, prenom, nom, classe_id, role, mdp, doit_changer_mdp)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [identifiant, prenom, nom, await classeId(classe), role, await auth.hacher(clair), role === 'eleve']);
    await db.q('insert into progressions(compte_id) values ($1) on conflict do nothing', [c.id]);
    await db.journaliser('cli', 'compte.creation', identifiant, { role, classe: classe || null });

    console.log('');
    console.log(`  ${role === 'prof' ? 'ENSEIGNANT' : 'Élève'} : ${prenom} ${nom}${classe ? ' · ' + classe : ''}`);
    console.log(`  Identifiant   : ${identifiant}`);
    console.log(`  Mot de passe  : ${clair}`);
    console.log('');
    console.log('  Note-le maintenant : il n’est plus affiché ensuite.');
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
    if (!identifiant) throw new Error('Usage : mdp <identifiant> [--mdp X] [--fort]');
    const c = await db.une('select id, role from comptes where identifiant = $1', [identifiant]);
    if (!c) throw new Error(`Compte « ${identifiant} » introuvable.`);

    const clair = typeof options.mdp === 'string' ? options.mdp : motDePasse(options.fort || c.role === 'prof');
    await db.q('update comptes set mdp = $2, doit_changer_mdp = $3 where id = $1',
      [c.id, await auth.hacher(clair), c.role === 'eleve']);
    /* Toutes les sessions ouvertes tombent : c'est le but d'une réinitialisation. */
    await db.q('delete from sessions where compte_id = $1', [c.id]);
    await db.journaliser('cli', 'compte.mdp', identifiant, null);
    console.log(`\n  ${identifiant} → nouveau mot de passe : ${clair}\n`);
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

      const identifiant = await identifiantLibre(prenom, nom);
      const clair = motDePasse(options.fort);
      const c = await db.une(
        `insert into comptes(identifiant, prenom, nom, classe_id, role, mdp, doit_changer_mdp)
         values ($1,$2,$3,$4,'eleve',$5,true) returning id`,
        [identifiant, prenom, nom, await classeId(classe), await auth.hacher(clair)]);
      await db.q('insert into progressions(compte_id) values ($1) on conflict do nothing', [c.id]);
      sortie.push([classe || '', prenom, nom, identifiant, clair]);
    }

    const nomSortie = path.join(path.dirname(path.resolve(fichier)),
      `identifiants-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.writeFileSync(nomSortie,
      '﻿classe;prenom;nom;identifiant;motdepasse\n' + sortie.map((l) => l.join(';')).join('\n') + '\n',
      { encoding: 'utf8', mode: 0o600 });

    await db.journaliser('cli', 'comptes.import', null, { crees: sortie.length, ignorees });
    console.log(`\n  ${sortie.length} compte(s) créé(s)${ignorees ? `, ${ignorees} ligne(s) ignorée(s)` : ''}.`);
    console.log(`  Identifiants à imprimer : ${nomSortie}`);
    console.log('  ⚠ Ce fichier contient les mots de passe EN CLAIR : imprime-le, distribue-le, puis SUPPRIME-LE.\n');
  },

  /* Conservation limitée dans le temps (RGPD art. 5.1.e). À passer chaque fin d'année. */
  async purger() {
    const avant = options.avant;
    if (typeof avant !== 'string') throw new Error('Usage : purger --avant AAAA-MM-JJ [--oui]');
    const vises = await db.q(
      `select identifiant from comptes
        where role = 'eleve'
          and coalesce(derniere_connexion, cree_le) < $1::date`, [avant]);

    if (!vises.rows.length) return console.log('Aucun compte concerné.');
    if (!options.oui) {
      console.log(`${vises.rows.length} compte(s) élève sans connexion depuis le ${avant} :`);
      for (const c of vises.rows.slice(0, 20)) console.log('  ' + c.identifiant);
      if (vises.rows.length > 20) console.log(`  … et ${vises.rows.length - 20} autre(s)`);
      console.log('\nConfirme la suppression définitive en ajoutant --oui.');
      return;
    }
    const r = await db.q(
      `delete from comptes where role = 'eleve' and coalesce(derniere_connexion, cree_le) < $1::date`, [avant]);
    await db.journaliser('cli', 'comptes.purge', null, { avant, supprimes: r.rowCount });
    console.log(`${r.rowCount} compte(s) supprimé(s).`);
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
  node outils/atl.mjs creer <prenom> <nom> [classe] [--prof] [--mdp X] [--fort]
  node outils/atl.mjs liste [classe]
  node outils/atl.mjs mdp <identifiant> [--mdp X] [--fort]
  node outils/atl.mjs activer|desactiver <identifiant>
  node outils/atl.mjs supprimer <identifiant> --oui
  node outils/atl.mjs importer <fichier.csv> [--fort]
  node outils/atl.mjs purger --avant AAAA-MM-JJ [--oui]
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

/* On ferme la reserve AVANT de sortir : process.exit() ne laisse pas tourner un
   bloc finally, et une connexion PostgreSQL abandonnee reste comptee un moment. */
await db.pool.end().catch(() => {});
process.exit(code);
