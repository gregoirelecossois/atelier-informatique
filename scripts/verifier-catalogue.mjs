#!/usr/bin/env node
/* Vérifie que scripts/ateliers.js dit la vérité sur le nombre de niveaux.
 *
 * Pourquoi ce script existe : le catalogue vivait en double, dans le raccourci
 * développeur de index.html et dans les pastilles des cartes. Le jour où un neuvième
 * niveau est arrivé dans « Dossiers et fichiers », une seule des deux copies a suivi —
 * et personne ne l'a vu, parce qu'une liste trop courte ne casse rien : elle ment,
 * c'est tout. Le tableau de bord enseignant, lui, s'en sert comme dénominateur de
 * l'avancement : un élève ayant tout terminé s'y afficherait à 89 %.
 *
 *   node scripts/verifier-catalogue.mjs
 *
 * Sort en code 1 si un compte diverge. À lancer après avoir ajouté ou retiré un niveau.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* On lit ateliers.js comme du texte plutôt que de l'importer : c'est un script de
   navigateur, il pose window.ATELIERS et n'exporte rien. */
const source = fs.readFileSync(path.join(RACINE, 'scripts/ateliers.js'), 'utf8');
const bac = { window: {} };
new Function('window', source)(bac.window);
const ATELIERS = bac.window.ATELIERS;

/* Nombre de niveaux réellement définis dans un atelier. Deux structures coexistent :
   un LEVELS=[{n:1,…},…] pour cinq des six, et des LEVEL<N>_DEFS séparés pour le
   traitement de texte (cf. le commentaire de scripts/game-count.mjs). */
function niveauxReels(fichier) {
  const s = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
  const i = s.indexOf('const LEVELS=[');
  if (i >= 0) {
    const m = s.slice(i, i + 400000).match(/\{\s*n\s*:\s*\d+\s*,\s*title\s*:/g);
    if (m && m.length) return m.length;
  }
  const defs = s.match(/const\s+LEVEL\d+_DEFS\s*=/g);
  if (defs && defs.length) return defs.length;
  return null;
}

let souci = 0;
for (const a of ATELIERS) {
  const reel = niveauxReels(a.fichier);
  const dit = a.niveaux.length;

  /* Les cartes de la page d'accueil portent une pastille par niveau : troisième copie
     de la même information, donc troisième occasion de diverger. */
  const idx = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const bloc = idx.slice(idx.indexOf(`id="${a.id}Levels"`));
  const pastilles = (bloc.slice(0, bloc.indexOf('</div>')).match(/lvl-chip/g) || []).length;

  const ok = reel === dit && pastilles === dit;
  if (!ok) souci++;
  console.log(`  ${ok ? 'ok  ' : 'ÉCART'} ${a.id}  ${a.nom.padEnd(24)} ` +
    `atelier ${reel} · catalogue ${dit} · pastilles ${pastilles}`);
}

console.log(souci
  ? `\n  ${souci} atelier(s) à corriger dans scripts/ateliers.js ou index.html.\n`
  : `\n  Les trois sources concordent.\n`);
process.exit(souci ? 1 : 0);
