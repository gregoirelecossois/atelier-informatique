#!/usr/bin/env node
/* Hook PostToolUse : remet à jour les totaux de missions par niveau dans
 * scripts/ateliers.js dès qu'un fichier d'atelier est édité.
 *
 * Sans lui, ajouter ou retirer une mission ne casse rien — et c'est bien le problème :
 * le tableau de bord enseignant continue d'annoncer « mission 2 sur 5 » alors qu'il y en
 * a six. Une donnée fausse qui ne lève aucune erreur ne se découvre que par hasard, des
 * semaines plus tard. Autant qu'elle se corrige toute seule.
 *
 * Même façon de faire que scripts/game-count-on-edit.mjs : lit l'événement du hook sur
 * stdin, ne s'active que sur les fichiers d'atelier, et ne bloque jamais l'édition. */
import path from 'node:path';
import { compter, ecrire, SOURCES } from './compter-missions.mjs';

function lireStdin() {
  return new Promise((res) => {
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
    setTimeout(() => res(d), 2000);            /* garde-fou si rien n'arrive */
  });
}

const CONCERNES = new Set(Object.values(SOURCES).map((s) => s.fichier));

try {
  const brut = await lireStdin();
  let evt = {};
  try { evt = JSON.parse(brut || '{}'); } catch { /* événement illisible : on passe */ }

  const fichier = evt?.tool_input?.file_path || evt?.tool_input?.path || '';
  if (fichier && CONCERNES.has(path.basename(fichier))) {
    const changes = ecrire(compter());
    if (changes.length) {
      console.error('[missions] totaux mis à jour dans scripts/ateliers.js : ' + changes.join(', '));
    }
  }
} catch (e) {
  /* Un découpage incohérent doit se voir, mais jamais interrompre une édition. */
  console.error('[missions] ' + e.message);
}
process.exit(0);
