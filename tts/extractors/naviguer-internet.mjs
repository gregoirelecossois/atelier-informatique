/* Extracteur de textes lus pour naviguer-internet.html :
 * LEVELS (intro/objectives.t/goal.hint/round intro+goal+hint) + PZ_PHASE_META (astuce POPZILLA).
 * HORS PÉRIMÈTRE (assumé) : tutoriels détaillés POPZILLA/INFOX (overlays séparés, pas #modal),
 * contenu web simulé (pages/résultats de recherche fictifs), écrans de victoire/défaite de boss
 * (score dynamique). Voir tts/README.md. */
import vm from 'node:vm';
import { extractBalanced } from '../engine.mjs';

function autoStubContext(){
  const target = {};
  const proxy = new Proxy(target, {
    get(t, prop){
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol') return undefined;
      const stub = function(){ return stub; };
      t[prop] = stub;
      return stub;
    },
    has(){ return true; },
  });
  vm.createContext(proxy);
  return proxy;
}

function extractCore(html){
  const kbdM = html.match(/function\s+kbd\s*\([^)]*\)\s*\{/);
  const kbdSrc = html.slice(kbdM.index, kbdM.index + kbdM[0].length - 1) + extractBalanced(html, kbdM.index + kbdM[0].length - 1);
  const gStart = html.indexOf('{', html.indexOf('const G='));
  const gSrc = 'const G=' + extractBalanced(html, gStart) + ';';
  const lb = html.indexOf('[', html.indexOf('const LEVELS='));
  const levelsSrc = 'var __LEVELS=' + extractBalanced(html, lb) + ';';

  const ctx = autoStubContext();
  vm.runInContext([kbdSrc, gSrc, levelsSrc].join('\n'), ctx);
  return ctx.__LEVELS;
}

// PZ_PHASE_META : objet littéral pur (chip/ic/title/cry/tut.title/tut.sub) — astuce
// jouée pendant le combat POPZILLA, via le bouton 💡 standard (#modal).
function extractPzPhaseMeta(html){
  const m = html.match(/const\s+PZ_PHASE_META\s*=\s*\{/);
  if (!m) return {};
  const ob = m.index + m[0].length - 1;
  const obj = extractBalanced(html, ob);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __M = ' + obj + ';', ctx);
  return ctx.__M;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const LEVELS = extractCore(html);
  const PZ = extractPzPhaseMeta(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  for (const lvl of LEVELS){
    const it = lvl.intro;
    if (it && (it.lead || it.teach)) add(lvl.title + '. ' + (it.lead||'') + (it.teach ? ' ' + it.teach : ''));
    for (const r of (lvl.rounds||[])){
      const list = (r.objectives||[]).map(o=>o.t||'').join(' ');
      add((r.title||'') + '. ' + (r.intro||'') + ' ' + list);
      if (r.hint) add(r.hint);                      // astuce des rounds "game" (repli standard)
      for (const o of (r.objectives||[])) if (o.goal && o.goal.hint) add(o.goal.hint);
    }
  }
  for (const meta of Object.values(PZ)){
    if (meta.tut) add((meta.tut.title||'') + '. ' + (meta.tut.sub||''));
  }
  for (const v of Object.values(STATIC)) add(v);

  return wanted;
}
