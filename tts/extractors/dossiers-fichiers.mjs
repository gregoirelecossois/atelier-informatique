/* Extracteur de textes lus pour dossiers-fichiers.html :
 * LEVELS (intro/objectives.t/goal.hint) + BOSS_PHASES + BOSS_HINTS + échecs + astuces. */
import vm from 'node:vm';
import { extractBalanced } from '../engine.mjs';

// kbd + file/folder/homeTree + G (pures, sans DOM) + LEVELS : îlots extraits séparément
// et concaténés dans l'ordre pour que G/LEVELS puissent s'évaluer (LEVELS appelle
// homeTree()/G.xxx() directement dans ses littéraux de `seed`/`objectives`).
function extractCore(html){
  const kbdSrc = extractFn(html, 'kbd');
  const fileSrc = extractFn(html, 'file');
  const folderSrc = extractFn(html, 'folder');
  const homeTreeSrc = extractFn(html, 'homeTree');
  const gStart = html.indexOf('{', html.indexOf('const G='));
  const gSrc = 'const G=' + extractBalanced(html, gStart) + ';';
  const lb = html.indexOf('[', html.indexOf('const LEVELS='));
  const levelsSrc = 'var __LEVELS=' + extractBalanced(html, lb) + ';';

  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([kbdSrc, fileSrc, folderSrc, homeTreeSrc, gSrc, levelsSrc].join('\n'), ctx);
  return { LEVELS: ctx.__LEVELS, G: ctx.G };
}
function extractFn(html, name){
  const m = html.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) throw new Error('fonction introuvable: ' + name);
  const braceStart = m.index + m[0].length - 1;
  const body = extractBalanced(html, braceStart);   // "{...}" équilibré
  return html.slice(m.index, braceStart) + body;    // signature + corps
}

// buildPhaseSequence-like : BOSS_PHASES référence des fonctions phaseXxx comme valeurs.
function extractBossPhases(html){
  const m = html.match(/const\s+BOSS_PHASES\s*=\s*\[/);
  if (!m) return [];
  const lb = m.index + m[0].length - 1;
  const arrSrc = extractBalanced(html, lb);
  const phaseNames = [...arrSrc.matchAll(/start\s*:\s*(phase\w+)/g)].map(x=>x[1]);
  const stubs = [...new Set(phaseNames)].map(n=>`var ${n}=function(){};`).join('\n');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(stubs + '\nvar __PHASES = ' + arrSrc + ';', ctx);
  return ctx.__PHASES;
}

// BOSS_HINTS : objet littéral déclaré à l'intérieur de onHint() — extraction ciblée.
function extractBossHints(html){
  const m = html.match(/const\s+BOSS_HINTS\s*=\s*\{/);
  if (!m) return {};
  const ob = m.index + m[0].length - 1;
  const obj = extractBalanced(html, ob);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __M = ' + obj + ';', ctx);
  return ctx.__M;
}

// missionFail(type) : objet `map` littéral à l'intérieur de la fonction.
function extractMissionFailMap(html){
  const m = html.match(/function\s+missionFail\([^)]*\)\{[\s\S]*?const\s+map\s*=\s*\{/);
  if (!m) return {};
  const ob = m.index + m[0].length - 1;
  const obj = extractBalanced(html, ob);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __M = ' + obj + ';', ctx);
  return ctx.__M;
}

// EXTMAP_TTS : constante lue sur l'écran des familles d'extensions (niveau 7, mission 1).
function extractExtmapTts(html){
  const m = html.match(/const\s+EXTMAP_TTS\s*=\s*([\s\S]*?);\r?\n/);
  if (!m) return '';
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __S = ' + m[1] + ';', ctx);
  return ctx.__S;
}
// execTtsText(ext, dbl) : alerte « ce fichier s'exécute » — toutes les combinaisons possibles.
function extractExecTts(html){
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(extractFn(html, 'execTtsText'), ctx);
  const out = [];
  for (const ext of ['exe','msi','bat']) for (const dbl of [false, true]) out.push(ctx.execTtsText(ext, dbl));
  return out;
}
// installTtsText / installedTtsText / dangerTtsText(ext,dbl) : simulation d'installation + alerte danger.
function extractInstallDangerTts(html){
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(extractFn(html, 'installTtsText') + '\n' + extractFn(html, 'installedTtsText') + '\n' + extractFn(html, 'dangerTtsText'), ctx);
  const out = [ctx.installTtsText(), ctx.installedTtsText()];
  for (const ext of ['exe','msi','bat']) for (const dbl of [false, true]) out.push(ctx.dangerTtsText(ext, dbl));
  return out;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const { LEVELS } = extractCore(html);
  const PHASES = extractBossPhases(html);
  const HINTS = extractBossHints(html);
  const FAIL_MAP = extractMissionFailMap(html);
  const STATIC = extractStatic(html);

  const wanted = new Map();
  const add = (raw)=>{ if(!raw) return; const k=ttsKey(raw); if(!wanted.has(k)) wanted.set(k, ttsNormalize(raw)); };

  for (const lvl of LEVELS){
    const it = lvl.intro;
    if (it && (it.lead || it.teach)) add(lvl.title + '. ' + (it.lead||'') + (it.teach ? ' ' + it.teach : ''));
    for (const r of (lvl.rounds||[])){
      if (r.title || r.intro || r.desc) add((r.title||'') + '. ' + (r.intro||r.desc||''));
      for (const o of (r.objectives||[])){
        if (o.goal && o.goal.hint) add(o.goal.hint);
        else if (o.t) add(o.t);
      }
    }
  }
  for (const ph of PHASES) add((ph.title||'') + '. ' + (ph.how||''));   // astuce pendant le combat de boss
  for (const txt of Object.values(HINTS)) add(txt);                     // astuces par phase de boss (repli)
  for (const txt of Object.values(FAIL_MAP)) add(txt);                 // messages d'échec de mission
  add("Tu as fait autre chose que l'objectif affiché en haut.");        // repli par défaut de missionFail
  add("Il faut utiliser la méthode demandée par l'objectif.");          // repli par défaut de wrongMethodFail
  add(extractExtmapTts(html));                                         // écran des familles d'extensions
  for (const txt of extractExecTts(html)) add(txt);                    // alertes .exe / .msi / .bat
  for (const txt of extractInstallDangerTts(html)) add(txt);           // simulation d'installation + alerte danger
  for (const v of Object.values(STATIC)) add(v);                       // réussite, déblocage, fin, boss…

  return wanted;
}
