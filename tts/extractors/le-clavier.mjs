/* Extracteur de textes lus pour le-clavier.html : LEVELS + tipFor + astuces
   + cartes de tutoriel de boss (showTutoCard / hbTutoCard). */
import vm from 'node:vm';
import { extractBalanced } from '../engine.mjs';

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
  vm.runInContext(block + '\n; var __tts = { LEVELS, tipFor, fjReminderHTML, kbd, keyHint, buildKeyboard };', ctx);
  return ctx.__tts;
}

// Cartes de tutoriel de boss : showTutoCard(html) / hbTutoCard(html) reçoivent un HTML
// littéral concaténé. Le runtime (ttsDecorateCard) lit « .tc-title. .tc-text », donc on
// reconstitue exactement la même chaîne. Une seule carte est dynamique : celle des vagues
// du labyrinthe, qui interpole `w` depuis HB_MAZE_WAVE — on l'évalue pour chaque vague.
function extractMazeWaves(html){
  const i = html.indexOf('[', html.indexOf('const HB_MAZE_WAVE'));
  if (i < 0) return [];
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext('var __W = ' + extractBalanced(html, i) + ';', ctx);
  return (ctx.__W || []).filter(Boolean);
}
// La leçon de majuscule ne se déclenche que sur un alien porteur d'une LETTRE majuscule :
// inutile de générer la carte pour les chiffres, la ponctuation ou les minuscules.
function majLetters(chars){
  const up = new Set();
  for (const c of chars) if (c.length === 1 && c !== c.toLowerCase()) up.add(c);
  return [...up];
}
function extractTutoCards(html, pure, chars){
  const waves = extractMazeWaves(html);
  // helpers de la page utilisés dans les cartes dynamiques
  const base = {
    kbd: pure.kbd, keyHint: pure.keyHint, buildKeyboard: pure.buildKeyboard,
    escapeHtml: (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  };
  const out = [];
  const re = /\b(?:showTutoCard|hbTutoCard)\(/g;
  let m;
  while ((m = re.exec(html))){
    const args = extractBalanced(html, re.lastIndex - 1).slice(1, -1).trim();
    if (!args || args === 'html') continue;              // la définition de la fonction elle-même
    // Deux cartes sont dynamiques : celle des vagues du labyrinthe (interpole `w`) et la
    // leçon de majuscule (interpole `ch`, la lettre ratée) — on rend chaque variante.
    const binds = /\bw\./.test(args) ? waves.map(w=>({w}))
                : /\bch\b/.test(args) ? majLetters(chars).map(ch=>({ch, hl:{...pure.keyHint(ch).hl, caps:true}}))
                : [{}];
    for (const scope of binds){
      let rendered;
      try {
        const ctx = { ...base, ...scope }; vm.createContext(ctx);
        vm.runInContext('var __H = (' + args + ');', ctx);
        rendered = ctx.__H;
      } catch(e){ continue; }                            // carte non littérale : repli voix au runtime
      if (typeof rendered !== 'string') continue;
      // ttsDecorateCard lit TOUS les éléments d'une classe (querySelectorAll) et les joint
      // par un espace : on fait pareil, sinon le hash ne correspondrait pas au runtime.
      const grab = (cls)=>[...rendered.matchAll(new RegExp('<div class="'+cls+'"[^>]*>([\\s\\S]*?)</div>','g'))]
        .map(x=>x[1]).filter(Boolean).join(' ');
      const parts = [grab('tc-title'), grab('tc-text')].filter(Boolean);
      if (parts.length) out.push(parts.join('. '));
    }
  }
  return out;
}

export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const pure = extractPure(html);
  const { LEVELS, tipFor, fjReminderHTML } = pure;
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
  for (const txt of extractTutoCards(html, pure, chars)) add(txt);   // cartes de tuto des boss (hors #modal)
  for (const v of Object.values(STATIC)) add(v);

  return wanted;
}
