#!/usr/bin/env node
/* Hook PostToolUse : régénère AUTOMATIQUEMENT la synthèse vocale quand un fichier
 * de l'atelier portant un extracteur (tts/extractors/<base>.mjs) est édité.
 * Lit l'événement du hook sur stdin. Ne bloque jamais l'édition (sort en code 0). */
import path from 'node:path';
import { build, hasExtractor } from './build-tts.mjs';

function readStdin(){
  return new Promise(res=>{
    let d=''; process.stdin.setEncoding('utf8');
    process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>res(d));
    setTimeout(()=>res(d), 2000); // garde-fou si pas de stdin
  });
}

try {
  const raw = await readStdin();
  let evt = {}; try { evt = JSON.parse(raw||'{}'); } catch(e){}
  const fp = evt?.tool_input?.file_path || evt?.tool_input?.path || '';
  const projDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const bn = path.basename(fp).replace(/\.html?$/i,'');
  if (fp && hasExtractor(bn)){
    await build(path.join(projDir, bn + '.html'), path.join(projDir, 'tts'));
  }
} catch(e){
  console.error('[tts hook] ignoré :', e.message);
}
process.exit(0);
