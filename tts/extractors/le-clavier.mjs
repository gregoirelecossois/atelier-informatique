/* Extracteur de textes lus pour le-clavier.html : LEVELS + tipFor + astuces. */
import vm from 'node:vm';

// Évalue le bloc PUR (sans DOM) de la page — de `function kbd` jusqu'à la fin de
// LEVELS — pour récupérer LEVELS, tipFor et fjReminderHTML tels que la page les utilise.
function extractPure(html){
  const kbdStart = html.search(/function\s+kbd\s*\(/);
  if (kbdStart < 0) throw new Error('bloc kbd introuvable');
  const lb = html.indexOf('[', html.indexOf('const LEVELS'));
  if (lb < 0) throw new Error('LEVELS introuvable');
  let depth=0, i=lb, q=null;                     // scanner qui respecte les chaînes
  for (; i<html.length; i++){
    const c = html[i];
    if (q){ if (c==='\\'){ i++; continue; } if (c===q) q=null; continue; }
    if (c==='"'||c==="'"||c==='`'){ q=c; continue; }
    if (c==='['||c==='{'||c==='(') depth++;
    else if (c===']'||c==='}'||c===')'){ depth--; if (depth===0){ i++; break; } }
  }
  const block = html.slice(kbdStart, i);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(block + '\n; var __tts = { LEVELS, tipFor, fjReminderHTML };', ctx);
  return ctx.__tts;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const { LEVELS, tipFor, fjReminderHTML } = extractPure(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  const chars = new Set();
  for (const lvl of LEVELS){
    const it = lvl.intro;
    if (it && (it.lead || it.teach)) add(lvl.title + '. ' + (it.lead||'') + (it.teach ? ' ' + it.teach : ''));
    for (const r of (lvl.rounds||[])){
      if (r.title || r.desc) add((r.title||'') + '. ' + (r.desc||''));
      if (Array.isArray(r.pool)) r.pool.forEach(c=>chars.add(c));
    }
  }
  for (const c of chars) add(tipFor(c));
  add('Les touches de cette mission sont surlignées ci-dessous.<br>' + fjReminderHTML());
  for (const lvl of LEVELS) if (lvl.intro && lvl.intro.teach) add(lvl.intro.teach);
  for (const v of Object.values(STATIC)) add(v);

  return wanted;
}
