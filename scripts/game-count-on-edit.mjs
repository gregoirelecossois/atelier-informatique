#!/usr/bin/env node
/* Hook PostToolUse : recalcule AUTOMATIQUEMENT le nombre de jeux affiché sur la page
 * d'accueil (index.html) dès qu'un fichier d'atelier (ou index.html lui-même) est édité.
 * Lit l'événement du hook sur stdin. Ne bloque jamais l'édition (sort en code 0). */
import path from 'node:path';
import { computeTotal, updateIndex, GAMES } from './game-count.mjs';

function readStdin(){
  return new Promise(res=>{
    let d=''; process.stdin.setEncoding('utf8');
    process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>res(d));
    setTimeout(()=>res(d), 2000); // garde-fou si pas de stdin
  });
}

const RELEVANT = new Set(GAMES.map(g=>g.file).concat(['index.html']));

try {
  const raw = await readStdin();
  let evt = {}; try { evt = JSON.parse(raw||'{}'); } catch(e){}
  const fp = evt?.tool_input?.file_path || evt?.tool_input?.path || '';
  const bn = path.basename(fp);
  if (fp && RELEVANT.has(bn)){
    const { total } = computeTotal();
    updateIndex(total);
  }
} catch(e){
  console.error('[game-count hook] ignoré :', e.message);
}
process.exit(0);
