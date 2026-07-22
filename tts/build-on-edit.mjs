#!/usr/bin/env node
/* Hook PostToolUse : régénère AUTOMATIQUEMENT la synthèse vocale quand un fichier
 * de l'atelier portant un extracteur (tts/extractors/<base>.mjs) est édité.
 * Lit l'événement du hook sur stdin.
 *
 * L'édition a DÉJÀ eu lieu quand ce hook tourne : on ne peut donc rien « bloquer ».
 * En revanche un échec ici veut dire que l'audio est PÉRIMÉ — et un audio périmé
 * qui ne dit rien est le pire cas (l'appli part en production avec des voix qui ne
 * correspondent plus aux textes). On sort donc en code 2 : stderr est alors renvoyé
 * à l'assistant, qui voit l'erreur et peut corriger dans la foulée.
 *
 * Le bruit est maîtrisé en amont : engine.mjs ne réclame Python que s'il faut
 * réellement générer un clip, donc une reconstruction 100 % cache ne fait pas de
 * bruit sur un poste sans edge-tts. */
import path from 'node:path';
import { build, hasExtractor } from './build-tts.mjs';

function readStdin(){
  return new Promise(res=>{
    let d=''; process.stdin.setEncoding('utf8');
    process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>res(d));
    setTimeout(()=>res(d), 2000); // garde-fou si pas de stdin
  });
}

/* Aide au diagnostic : on nomme la cause probable plutôt que de recracher la trace. */
function diagnose(err, base){
  const m = String(err && err.message || err);
  if (/Unexpected token|Unexpected end|Invalid or unexpected/i.test(m)){
    return [
      'L\'extraction des textes a produit du JavaScript invalide : le découpage de',
      '`const G={...}` ou `const LEVELS=[...]` a été tronqué.',
      'CAUSE LA PLUS FRÉQUENTE : une apostrophe dans un COMMENTAIRE JS à l\'intérieur',
      'de ces deux blocs (ex. /* l\'anniversaire */). extractBalanced() suit les chaînes',
      'mais ignore les commentaires : l\'apostrophe ouvre une chaîne fantôme et',
      'désynchronise le comptage des accolades.',
      'CORRECTIF : reformuler le commentaire sans apostrophe.'
    ].join('\n  ');
  }
  if (/#tts-static/i.test(m)) return 'Le bloc <script id="tts-static"> ne contient pas du JSON valide.';
  if (/edge_tts|edge-tts|Python/i.test(m)) return 'Un clip manquant doit être généré, mais Python + edge-tts sont introuvables :\n  pip install edge-tts';
  if (/ffmpeg/i.test(m)) return 'ffmpeg a échoué pendant la compression du clip.';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(m)) return 'La génération edge-tts a besoin d\'internet (uniquement à la génération).';
  return null;
}

let failed = false;
try {
  const raw = await readStdin();
  let evt = {}; try { evt = JSON.parse(raw||'{}'); } catch(e){}
  const fp = evt?.tool_input?.file_path || evt?.tool_input?.path || '';
  const projDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const bn = path.basename(fp).replace(/\.html?$/i,'');
  if (fp && hasExtractor(bn)){
    try {
      await build(path.join(projDir, bn + '.html'), path.join(projDir, 'tts'));
    } catch(e){
      failed = true;
      const hint = diagnose(e, bn);
      console.error('');
      console.error('[tts] ÉCHEC de la régénération audio pour ' + bn + '.html');
      console.error('  → ' + (e && e.message ? e.message.split('\n')[0] : String(e)));
      if (hint) console.error('  ' + hint);
      console.error('  L\'AUDIO EST DÉSORMAIS PÉRIMÉ : les textes modifiés n\'ont pas de clip.');
      console.error('  Rejouer après correction :');
      console.error('    node tts/build-tts.mjs ' + bn + '.html tts');
      console.error('');
    }
  }
} catch(e){
  /* défaillance du hook lui-même (stdin, import…) : on le dit aussi */
  failed = true;
  console.error('[tts] le hook a échoué avant même de construire : ' + (e && e.message));
}
process.exit(failed ? 2 : 0);
