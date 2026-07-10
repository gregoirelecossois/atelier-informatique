/* Extracteur de textes lus pour la-messagerie.html :
 * LEVELS (intro de niveau / popup de mission / astuces des rounds et des objectifs) + tts-static.
 * Les clés doivent reproduire EXACTEMENT ce que le runtime pose dans modal.dataset.ttsText :
 *  - intro de niveau : title + '. ' + lead + ' ' + teach
 *  - popup de round  : title + '. ' + intro + ' ' + objectifs (t) joints par espace
 *  - astuce 💡       : title + '. ' + (hint du round « game » | goal.hint | stripTags(o.t))
 * HORS PÉRIMÈTRE (assumé) : contenu des mails simulés, toasts, verdicts dynamiques du boss
 * (score/crédits), bulles du PHISHER — repli voix navigateur si survolés. Voir tts/README.md. */
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

const strip = s => String(s).replace(/<[^>]+>/g, '');
const GAME_HINT_FALLBACK = 'Suis la consigne affichée sur l\'écran !';

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const LEVELS = extractCore(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  for (const lvl of LEVELS){
    const it = lvl.intro;
    if (it && (it.lead || it.teach)) add(lvl.title + '. ' + (it.lead||'') + (it.teach ? ' ' + it.teach : ''));
    for (const r of (lvl.rounds||[])){
      const list = (r.objectives||[]).map(o=>o.t||'').join(' ');
      add((r.title||'') + '. ' + (r.intro||'') + ' ' + list);
      const title = r.title || 'Astuce';
      if (r.kind==='game') add(title + '. ' + (r.hint || GAME_HINT_FALLBACK));
      for (const o of (r.objectives||[])){
        const hint = (o.goal && o.goal.hint) ? o.goal.hint : strip(o.t||'');
        if (hint) add(title + '. ' + hint);
      }
    }
  }
  for (const v of Object.values(STATIC)) add(v);

  return wanted;
}
