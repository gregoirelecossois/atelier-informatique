#!/usr/bin/env node
/* Compte le nombre total de missions/défis/boss jouables dans l'atelier (tous les
 * fichiers, tous les niveaux) et l'écrit dans le <h1> de index.html.
 *
 * Chaque atelier étiquette ses rounds jouables avec un `kind` différent — ce n'est PAS
 * uniforme d'un fichier à l'autre (historique propre à chaque jeu) :
 *   la-souris / le-clavier / dossiers-fichiers : kind 'mission' + 'jalon' (jalon = défi
 *     ET boss, cf. mode:'boss' sur l'entrée finale — un boss est un jalon).
 *   naviguer-internet / la-messagerie          : kind 'mission' + 'game' (les boss y sont
 *     repérés par bossmode:true, mais restent kind:'game').
 *   traitement-texte                            : structure différente — chaque niveau a
 *     ses rounds dans une const LEVEL<N>_DEFS séparée (référencée depuis LEVELS via
 *     `defs:LEVEL<N>_DEFS`), avec kind 'mission' + 'test' (le défi final de chaque niveau).
 *
 * On ne scanne QUE l'intérieur du tableau balancé (via extractBalanced, qui respecte les
 * chaînes de caractères) : un simple grep plein-fichier accrocherait par exemple le
 * commentaire de naviguer-internet.html qui contient littéralement "kind:'game'" en texte.
 *
 * Si un niveau ajoute/retire une mission, un défi ou un boss, ce compte se remet à jour
 * tout seul au prochain passage — cf. game-count-on-edit.mjs (hook PostToolUse). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBalanced } from '../tts/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');

export const GAMES = [
  { file:'la-souris.html',         arrayName:'LEVELS', kinds:['mission','jalon'] },
  { file:'le-clavier.html',        arrayName:'LEVELS', kinds:['mission','jalon'] },
  { file:'dossiers-fichiers.html', arrayName:'LEVELS', kinds:['mission','jalon'] },
  { file:'naviguer-internet.html', arrayName:'LEVELS', kinds:['mission','game'] },
  { file:'la-messagerie.html',     arrayName:'LEVELS', kinds:['mission','game'] },
  { file:'traitement-texte.html',  arrayName:'LEVEL\\d+_DEFS', kinds:['mission','test'], multi:true }
];

function countKinds(block, kinds){
  const re=/kind\s*:\s*'([^']+)'/g;
  let m, n=0;
  while((m=re.exec(block))) if(kinds.includes(m[1])) n++;
  return n;
}

function countFile(game){
  const full=fs.readFileSync(path.join(ROOT, game.file), 'utf8');
  const declRe=new RegExp('const\\s+'+game.arrayName+'\\s*=\\s*\\[', game.multi?'g':'');
  let total=0, m;
  if(game.multi){
    while((m=declRe.exec(full))){
      total += countKinds(extractBalanced(full, full.indexOf('[', m.index)), game.kinds);
    }
    if(total===0) throw new Error(game.arrayName+' introuvable dans '+game.file);
  } else {
    m=declRe.exec(full);
    if(!m) throw new Error(game.arrayName+' introuvable dans '+game.file);
    total = countKinds(extractBalanced(full, full.indexOf('[', m.index)), game.kinds);
  }
  return total;
}

export function computeTotal(){
  let total=0; const detail={};
  for(const g of GAMES){ const n=countFile(g); detail[g.file]=n; total+=n; }
  return { total, detail };
}

export function updateIndex(total){
  const idxPath=path.join(ROOT,'index.html');
  const idx=fs.readFileSync(idxPath,'utf8');
  const h1Re=/<h1>[\s\S]*?<\/h1>/;
  if(!h1Re.test(idx)) throw new Error('<h1> introuvable dans index.html');
  const newH1='<h1><span class="pop">'+total+'</span> jeux pour apprendre à maîtriser son ordinateur.</h1>';
  const next=idx.replace(h1Re, newH1);
  if(next!==idx){ fs.writeFileSync(idxPath, next); return true; }
  return false;
}

// Exécution directe : `node scripts/game-count.mjs`
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {total, detail}=computeTotal();
  const changed=updateIndex(total);
  console.log('[game-count] total='+total, JSON.stringify(detail), changed?'(index.html mis à jour)':'(déjà à jour)');
}
