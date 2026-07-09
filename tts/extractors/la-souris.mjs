/* Extracteur de textes lus pour la-souris.html : LEVELS + gameHintLine + phases de boss + échecs. */
import vm from 'node:vm';

function extractBalanced(html, openIdx){
  let depth=0, i=openIdx, q=null;
  for (; i<html.length; i++){
    const c = html[i];
    if (q){ if (c==='\\'){ i++; continue; } if (c===q) q=null; continue; }
    if (c==='"'||c==="'"||c==='`'){ q=c; continue; }
    if (c==='['||c==='{'||c==='(') depth++;
    else if (c===']'||c==='}'||c===')'){ depth--; if (depth===0){ i++; break; } }
  }
  return html.slice(openIdx, i);
}

function extractLevels(html){
  const lb = html.indexOf('[', html.indexOf('const LEVELS'));
  const block = extractBalanced(html, lb);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __LEVELS = ' + block + ';', ctx);
  return ctx.__LEVELS;
}

// gameHintLine() ne dépend que d'un objet littéral statique {game: texte} — on l'isole.
function extractGameHintLine(html){
  const m = html.match(/function\s+gameHintLine\(\)\{[\s\S]*?return\s*\(\{/);
  if (!m) return {};
  const ob = m.index + m[0].lastIndexOf('{');
  const obj = extractBalanced(html, ob);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __M = ' + obj + ';', ctx);
  return ctx.__M;
}

// buildPhaseSequence() calcule des champs numériques via bd()/bCount() et référence des
// fonctions de phase (phaseAssault, etc.) comme valeurs — on les stubbe : seuls les champs
// texte (banner/brief/story) nous intéressent.
function extractBossPhases(html){
  const m = html.match(/function\s+buildPhaseSequence\(\)\{[\s\S]*?\n\}/);
  if (!m) return [];
  const ctx = {
    bd: ()=>({fairyMul:1, speedMul:1, fireMul:1}),
    bCount: (a)=>a,
  };
  vm.createContext(ctx);
  // stub les identifiants phaseXxx référencés comme valeurs dans le tableau retourné
  const phaseNames = [...m[0].matchAll(/start\s*:\s*(phase\w+)/g)].map(x=>x[1]);
  const stubs = [...new Set(phaseNames)].map(n=>`var ${n}=function(){};`).join('\n');
  vm.runInContext(stubs + '\n' + m[0] + '\nvar __phases = buildPhaseSequence();', ctx);
  return ctx.__phases;
}

// onFail(reason,tip) / clickFail(reason,tip) : tous les appels réels (hors définitions de
// fonction) utilisent des littéraux simples → on les récupère par une recherche de motif,
// en réutilisant `vm` pour interpréter les guillemets/échappements exactement comme le JS le ferait.
function extractFailCalls(html){
  const out = [];
  const re = /\b(?:clickFail|onFail)\(([\s\S]*?)\)/g;
  let m;
  while ((m = re.exec(html))){
    const args = m[1].trim();
    if (!args.startsWith("'") && !args.startsWith('"')) continue;   // ignore déclarations (reason, tip)
    try {
      const ctx = {}; vm.createContext(ctx);
      vm.runInContext('var __a = [' + args + '];', ctx);
      const [reason, tip] = ctx.__a;
      if (typeof reason === 'string') out.push(tip ? reason + '. ' + tip : reason);
    } catch(e){ /* appel non littéral (variable) : ignoré, repli voix au runtime */ }
  }
  return out;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const LEVELS = extractLevels(html);
  const HINTS = extractGameHintLine(html);
  const PHASES = extractBossPhases(html);
  const FAILS = extractFailCalls(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  for (const lvl of LEVELS){
    const it = lvl.intro;
    if (it && (it.lead || it.teach)) add(lvl.title + '. ' + (it.lead||'') + (it.teach ? ' ' + it.teach : ''));
    for (const r of (lvl.rounds||[])){
      if (r.title || r.desc) add((r.title||'') + '. ' + (r.desc||''));
    }
  }
  for (const txt of Object.values(HINTS)) add(txt);          // « comment jouer » par type de jeu
  for (const ph of PHASES) add((ph.banner||'') + '. ' + (ph.brief || ph.sub || '')); // astuce pendant le combat de boss
  for (const txt of FAILS) add(txt);                          // messages d'échec (littéraux)
  for (const v of Object.values(STATIC)) add(v);              // réussite, déblocage, fin, boss…

  return wanted;
}
