#!/usr/bin/env node
/* Compte les missions jouables de CHAQUE niveau, et injecte le résultat dans
 * scripts/ateliers.js.
 *
 * Le tableau de bord enseignant a besoin de dire « niveau 3, mission 2 sur 5 » : le
 * numéro seul ne renseigne pas. Ces totaux ne peuvent pas être saisis à la main — ils
 * changent dès qu'une mission est ajoutée à un niveau — d'où cette génération.
 *
 * Même repérage que scripts/game-count.mjs, qui compte les mêmes rounds mais par
 * fichier : chaque atelier étiquette ses rounds jouables avec un `kind` qui lui est
 * propre, ce n'est pas uniforme d'un jeu à l'autre. La différence ici est qu'on
 * découpe d'abord par niveau.
 *
 *   node scripts/compter-missions.mjs           écrit dans scripts/ateliers.js
 *   node scripts/compter-missions.mjs --verifie n'écrit rien, sort en 1 si un écart
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBalanced } from '../tts/engine.mjs';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIE = process.argv.includes('--verifie');

/* `kinds` : les étiquettes de rounds qui comptent comme jouables, atelier par atelier.
   `multi` : le traitement de texte range les rounds de chaque niveau dans une const
   LEVEL<N>_DEFS séparée plutôt que dans LEVELS. */
const SOURCES = {
  ms: { fichier: 'la-souris.html',         kinds: ['mission', 'jalon'] },
  kb: { fichier: 'le-clavier.html',        kinds: ['mission', 'jalon'] },
  df: { fichier: 'dossiers-fichiers.html', kinds: ['mission', 'jalon'] },
  nv: { fichier: 'naviguer-internet.html', kinds: ['mission', 'game'] },
  ml: { fichier: 'la-messagerie.html',     kinds: ['mission', 'game'] },
  tt: { fichier: 'traitement-texte.html',  kinds: ['mission', 'test'], multi: true }
};

function compterKinds(bloc, kinds) {
  const re = /kind\s*:\s*'([^']+)'/g;
  let m, n = 0;
  while ((m = re.exec(bloc))) if (kinds.includes(m[1])) n++;
  return n;
}

/* Découpe LEVELS en blocs de premier niveau : chaque niveau commence par « { n: <chiffre> ». */
function missionsParNiveau(id) {
  const s = SOURCES[id];
  const src = fs.readFileSync(path.join(RACINE, s.fichier), 'utf8');

  if (s.multi) {
    const out = [];
    const re = /const\s+LEVEL(\d+)_DEFS\s*=\s*\[/g;
    let m;
    while ((m = re.exec(src))) {
      out[Number(m[1]) - 1] = compterKinds(extractBalanced(src, src.indexOf('[', m.index)), s.kinds);
    }
    return out;
  }

  const i = src.indexOf('const LEVELS=[');
  if (i < 0) throw new Error('const LEVELS=[ introuvable dans ' + s.fichier);
  const tableau = extractBalanced(src, src.indexOf('[', i));

  /* Bornes de chaque niveau : la position de son « { n: <chiffre>, title: ». On ne
     peut pas se contenter d'un découpage naïf sur « { n: », qui existe aussi dans les
     rounds imbriqués — d'où l'exigence du `title` qui suit. */
  const debuts = [];
  const re = /\{\s*n\s*:\s*(\d+)\s*,\s*title\s*:/g;
  let m;
  while ((m = re.exec(tableau))) debuts.push({ n: Number(m[1]), i: m.index });

  return debuts.map((d, k) =>
    compterKinds(tableau.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : tableau.length), s.kinds));
}

/* -------------------------------------------------------------------------- */
const compte = {};
for (const id of Object.keys(SOURCES)) compte[id] = missionsParNiveau(id);

/* Recoupement indépendant : la somme des niveaux doit retomber sur le total que
   scripts/game-count.mjs calcule pour le même fichier, sans découpage. Un écart
   signalerait un niveau mal délimité — le genre d'erreur qui passerait inaperçue
   et fausserait tous les « mission 2 sur 5 » du tableau de bord. */
const { computeTotal } = await import('./game-count.mjs');
const { detail } = computeTotal();
for (const [id, s] of Object.entries(SOURCES)) {
  const somme = compte[id].reduce((a, b) => a + b, 0);
  if (somme !== detail[s.fichier]) {
    console.error(`\n  Découpage incohérent pour ${id} : ${somme} missions réparties, ` +
      `mais game-count.mjs en compte ${detail[s.fichier]} dans ${s.fichier}.\n`);
    process.exit(1);
  }
}

const cheminCat = path.join(RACINE, 'scripts/ateliers.js');
let cat = fs.readFileSync(cheminCat, 'utf8');
const crlf = cat.includes('\r\n');
let ecarts = 0, lignes = [];

for (const [id, missions] of Object.entries(compte)) {
  const re = new RegExp(`(\\{ id:'${id}',[\\s\\S]*?niveaux:\\[[^\\]]*\\])(,\\s*missions:\\[[^\\]]*\\])?`, 'm');
  const m = cat.match(re);
  if (!m) throw new Error('entrée « ' + id + " » introuvable dans scripts/ateliers.js");

  const niveaux = (m[1].match(/'(?:[^'\\]|\\.)*'/g) || []).length - 1;   /* - l'id lui-même */
  const actuel = m[2] ? m[2].match(/\d+/g).map(Number) : null;
  const attendu = missions;

  if (attendu.length !== niveaux + 1) {
    /* le -1 ci-dessus retire l'id, pas le fichier ni le nom : on recompte proprement */
  }
  const pareil = actuel && actuel.length === attendu.length && actuel.every((v, k) => v === attendu[k]);
  if (!pareil) ecarts++;
  lignes.push(`  ${id}  ${attendu.join(', ')}` + (pareil ? '' : '   (mis à jour)'));

  if (!VERIFIE) {
    const remplacement = m[1] + ',\n    missions:[' + attendu.join(',') + ']';
    cat = cat.replace(re, remplacement.replace(/\n/g, crlf ? '\r\n' : '\n'));
  }
}

console.log('\n  Missions par niveau :');
lignes.forEach((l) => console.log(l));

if (VERIFIE) {
  console.log(ecarts ? `\n  ${ecarts} atelier(s) à regénérer : node scripts/compter-missions.mjs\n`
                     : '\n  Les totaux du catalogue sont à jour.\n');
  process.exit(ecarts ? 1 : 0);
}

fs.writeFileSync(cheminCat, cat, 'utf8');
console.log(ecarts ? '\n  scripts/ateliers.js mis à jour.\n' : '\n  scripts/ateliers.js était déjà à jour.\n');
