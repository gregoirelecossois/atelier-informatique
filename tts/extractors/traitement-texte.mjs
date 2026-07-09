/* Extracteur de textes lus pour traitement-texte.html :
 * LEVEL{1..7}_DEFS (missions/tests) + LEVELS (intro/note) + astuces (hint.text). */
import vm from 'node:vm';
import { extractBalanced } from '../engine.mjs';

function extractArray(html, constName){
  const lb = html.indexOf('[', html.indexOf('const ' + constName));
  return 'const ' + constName + ' = ' + extractBalanced(html, lb) + ';';
}

// Les définitions de mission appellent de nombreuses fonctions de construction
// (tbMeteoEmpty(), objXxx()…) pour les champs startDoc/startTable/startScene qui ne
// nous intéressent pas (on ne veut que le TEXTE : title/intro/how/hint). Plutôt que
// de lister chaque fonction, on utilise un contexte « auto-stub » : tout identifiant
// non défini résout vers une fonction neutre (appelable, se renvoie elle-même).
function autoStubContext(){
  const target = {};
  const proxy = new Proxy(target, {
    get(t, prop){
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol' || prop === 'Symbol') return undefined;
      const stub = function(){ return stub; };
      t[prop] = stub;
      return stub;
    },
    has(){ return true; },
  });
  vm.createContext(proxy);
  return proxy;
}

// Remplace la VALEUR de chaque champ nommé (ex. `startDoc: tbMeteoFull()...`) par `null`,
// en respectant les chaînes/parenthèses imbriquées. Ces champs construisent l'état initial
// du document/tableau/scène (via des fonctions non pertinentes ici) — seul le TEXTE nous
// intéresse (title/intro/how/hint/tasks), donc on évite d'avoir à exécuter ces constructeurs.
function blankFields(src, fieldNames){
  let out = src;
  for (const field of fieldNames){
    const re = new RegExp('([{,]\\s*)' + field + '\\s*:', 'g');
    let result = '', last = 0, m;
    while ((m = re.exec(out))){
      const valStart = m.index + m[0].length;
      let depth = 0, i = valStart, q = null;
      for (; i < out.length; i++){
        const c = out[i];
        if (q){ if (c === '\\'){ i++; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === '`'){ q = c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}'){ if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) break;
      }
      result += out.slice(last, valStart) + 'null';
      last = i; re.lastIndex = i;
    }
    result += out.slice(last);
    out = result;
  }
  return out;
}

const COMPLEX_FIELDS = ['startDoc','goalDoc','startTable','goalTable','startScene','goalScene'];

function extractCore(html){
  const defsSrc = [1,2,3,4,5,6,7].map(n => blankFields(extractArray(html, 'LEVEL' + n + '_DEFS'), COMPLEX_FIELDS));
  // LEVELS référence LEVEL1_DEFS..LEVEL7_DEFS par identifiant : les consts ci-dessus
  // les définissent déjà dans le même contexte vm, donc aucune substitution nécessaire.
  const levelsSrc = 'var __LEVELS = ' + extractBalanced(html, html.indexOf('[', html.indexOf('const LEVELS'))) + ';';
  const ctx = autoStubContext();
  vm.runInContext([...defsSrc, levelsSrc].join('\n'), ctx);
  return ctx.__LEVELS;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const LEVELS = extractCore(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  for (const lvl of LEVELS){
    // intro de niveau : titre + lead fixe + note (identique à la formule de openLevelIntro)
    add(lvl.title + ". Bienvenue ! Voici les nouveaux pouvoirs que tu viens de débloquer. "
      + (lvl.note || "Ils sont apparus dans ta barre d'outils, tout en haut. À toi de jouer !"));
    for (const s of (lvl.defs||[])){
      if (s.kind === 'test'){
        add((s.title||'') + '. ' + (s.intro||'') + ' ' + (s.tasks||[]).join(' '));
      } else {
        add((s.title||'') + '. ' + (s.intro||'') + ' ' + (s.how||[]).join(' '));
      }
      if (s.hint && s.hint.text) add(s.hint.text);
    }
  }
  for (const v of Object.values(STATIC)) add(v);

  return wanted;
}
