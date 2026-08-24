#!/usr/bin/env node
/* Compte les missions jouables de CHAQUE niveau, et injecte le résultat dans
 * scripts/ateliers.js.
 *
 * Le tableau de bord enseignant a besoin de dire « niveau 3, mission 2 sur 5 » : le
 * numéro seul ne renseigne pas. Ces totaux ne peuvent pas être saisis à la main — ils
 * changent dès qu'une mission est ajoutée à un niveau — d'où cette génération, et le
 * hook scripts/missions-on-edit.mjs qui la relance tout seul après chaque édition
 * d'atelier.
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
import { computeTotal } from './game-count.mjs';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* `kinds` : les étiquettes de rounds qui comptent comme jouables, atelier par atelier.
   `multi` : le traitement de texte range les rounds de chaque niveau dans une const
   LEVEL<N>_DEFS séparée plutôt que dans LEVELS. */
export const SOURCES = {
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

  /* Bornes de chaque niveau : la position de son « { n: <chiffre>, title: ». Un
     découpage naïf sur « { n: » accrocherait aussi les rounds imbriqués, d'où
     l'exigence du `title` qui suit. */
  const debuts = [];
  const re = /\{\s*n\s*:\s*(\d+)\s*,\s*title\s*:/g;
  let m;
  while ((m = re.exec(tableau))) debuts.push({ n: Number(m[1]), i: m.index });

  return debuts.map((d, k) =>
    compterKinds(tableau.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : tableau.length), s.kinds));
}

/* Recoupement indépendant : la somme des niveaux doit retomber sur le total que
   game-count.mjs calcule pour le même fichier, sans découpage. Un écart signalerait un
   niveau mal délimité — le genre d'erreur qui passerait inaperçue et fausserait tous
   les « mission 2 sur 5 » du tableau de bord. */
export function compter() {
  const compte = {};
  for (const id of Object.keys(SOURCES)) compte[id] = missionsParNiveau(id);

  const { detail } = computeTotal();
  for (const [id, s] of Object.entries(SOURCES)) {
    const somme = compte[id].reduce((a, b) => a + b, 0);
    if (somme !== detail[s.fichier]) {
      throw new Error(`découpage incohérent pour ${id} : ${somme} missions réparties, ` +
        `mais game-count.mjs en compte ${detail[s.fichier]} dans ${s.fichier}`);
    }
  }
  return compte;
}

/* Écrit les totaux dans scripts/ateliers.js. Renvoie la liste des ateliers modifiés. */
export function ecrire(compte, { seulementVerifier = false } = {}) {
  const chemin = path.join(RACINE, 'scripts/ateliers.js');
  let cat = fs.readFileSync(chemin, 'utf8');
  const crlf = cat.includes('\r\n');
  const changes = [];

  for (const [id, attendu] of Object.entries(compte)) {
    const re = new RegExp(`(\\{ id:'${id}',[\\s\\S]*?niveaux:\\[[^\\]]*\\])(,\\s*missions:\\[[^\\]]*\\])?`, 'm');
    const m = cat.match(re);
    if (!m) throw new Error('entrée « ' + id + " » introuvable dans scripts/ateliers.js");

    const actuel = m[2] ? m[2].match(/\d+/g).map(Number) : null;
    const pareil = actuel && actuel.length === attendu.length && actuel.every((v, k) => v === attendu[k]);
    if (!pareil) changes.push(id);

    if (!seulementVerifier && !pareil) {
      /* On n'ajoute qu'UN saut de ligne, celui d'avant `missions:`. Convertir tout le
         bloc doublerait les retours chariot déjà présents dans m[1] — à chaque passage,
         si bien que le fichier se dégradait un peu plus à chaque édition d'atelier.
         Le remplacement passe par une fonction pour que les $ éventuels du contenu ne
         soient pas interprétés comme des références de capture. */
      const bloc = m[1] + ',' + (crlf ? '\r\n' : '\n') + '    missions:[' + attendu.join(',') + ']';
      cat = cat.replace(re, () => bloc);
    }
  }

  if (!seulementVerifier && changes.length) fs.writeFileSync(chemin, cat, 'utf8');
  return changes;
}

/* -------------------------------------------------------------------------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verifie = process.argv.includes('--verifie');
  const compte = compter();
  const changes = ecrire(compte, { seulementVerifier: verifie });

  console.log('\n  Missions par niveau :');
  for (const [id, m] of Object.entries(compte)) {
    console.log(`  ${id}  ${m.join(', ')}` + (changes.includes(id) ? '   (écart)' : ''));
  }

  if (verifie) {
    console.log(changes.length
      ? `\n  ${changes.length} atelier(s) à regénérer : node scripts/compter-missions.mjs\n`
      : '\n  Les totaux du catalogue sont à jour.\n');
    process.exit(changes.length ? 1 : 0);
  }
  console.log(changes.length ? '\n  scripts/ateliers.js mis à jour.\n'
                             : '\n  scripts/ateliers.js était déjà à jour.\n');
}
