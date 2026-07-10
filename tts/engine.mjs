/* Moteur partagé de génération TTS (voix Denise / edge-tts + compression ffmpeg).
 * Utilisé par build-tts.mjs pour chaque fichier de l'atelier : chaque fichier a
 * son propre « extracteur » de textes (structure de popups différente), mais
 * tous passent par ce même moteur pour la génération/cache/compression/écriture.
 *
 * ttsNormalize/ttsKey DOIVENT rester identiques à tts/tts-atelier.js (runtime). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const VOICE = 'fr-FR-DeniseNeural';

export function ttsNormalize(s){
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    // On NE lit PAS les emojis : on les retire avant la synthèse vocale.
    // (doit rester identique à tts/tts-atelier.js pour que les hash de clips concordent)
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, ' ')
    .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu, ' ')
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s+/g, ' ').trim();
}
export function ttsKey(s){
  const t = ttsNormalize(s);
  let h = 0x811c9dc5;
  for (let i=0;i<t.length;i++){ h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h>>>0).toString(16).padStart(8,'0') + '_' + t.length;
}

// Retourne la sous-chaîne allant de `openIdx` (un [, { ou ( ouvrant) jusqu'à sa
// fermeture équilibrée correspondante, en respectant les chaînes de caractères.
// Utilisé par les extracteurs pour isoler un bloc JS précis (tableau/objet/fonction)
// sans évaluer tout le fichier (évite les effets de bord des blocs alentour).
export function extractBalanced(src, openIdx){
  let depth=0, i=openIdx, q=null;
  for (; i<src.length; i++){
    const c = src[i];
    if (q){ if (c==='\\'){ i++; continue; } if (c===q) q=null; continue; }
    if (c==='"'||c==="'"||c==='`'){ q=c; continue; }
    if (c==='['||c==='{'||c==='(') depth++;
    else if (c===']'||c==='}'||c===')'){ depth--; if (depth===0){ i++; break; } }
  }
  return src.slice(openIdx, i);
}

function resolvePython(){
  for (const c of ['python','py','python3']){
    try { execFileSync(c, ['-c','import edge_tts'], {stdio:'ignore'}); return c; } catch(e){}
  }
  throw new Error("Python + edge-tts introuvables. Installe-les : pip install edge-tts");
}
function hasFfmpeg(){ try { execFileSync('ffmpeg',['-version'],{stdio:'ignore'}); return true; } catch(e){ return false; } }

/** wanted : Map<clé, texte normalisé>. Génère/compresse/cache, écrit <base>.clips.js + manifest. */
export function generateClips(base, outDir, wanted){
  const cacheDir = path.join(outDir, '.tts-cache');
  fs.mkdirSync(cacheDir, { recursive:true });

  const PY = resolvePython();
  const FF = hasFfmpeg();
  const ext = FF ? 'ogg' : 'mp3';
  const mime = FF ? 'audio/ogg' : 'audio/mpeg';

  let generated=0, cached=0;
  const clips = {};
  for (const [key, text] of wanted){
    const out = path.join(cacheDir, key + '.' + ext);
    if (!fs.existsSync(out)){
      const tmp = path.join(cacheDir, key + '.src.mp3');
      execFileSync(PY, ['-m','edge_tts','--voice',VOICE,'--text',text,'--write-media',tmp],
                   {stdio:['ignore','ignore','inherit']});
      if (FF){   // compression Opus mono ~24 kbps : nette pour la parole, très léger
        execFileSync('ffmpeg', ['-y','-i',tmp,'-c:a','libopus','-b:a','24k','-ac','1','-application','voip',out], {stdio:'ignore'});
        fs.rmSync(tmp);
      } else fs.renameSync(tmp, out);
      generated++;
    } else cached++;
    clips[key] = 'data:'+mime+';base64,' + fs.readFileSync(out).toString('base64');
  }

  // Purge des clips en cache devenus inutiles (texte supprimé/modifié) — SANS toucher
  // aux clips encore utilisés par les AUTRES fichiers (le cache est partagé entre tous
  // les fichiers de l'atelier). On ne supprime que ce qui n'apparaît dans le manifest
  // d'AUCUN fichier (celui qu'on vient d'écrire + tous les manifests voisins existants).
  const keep = new Set(wanted.keys());
  for (const f of fs.readdirSync(outDir)){
    if (!f.endsWith('.tts-manifest.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
      Object.keys(m.keys || {}).forEach(k => keep.add(k));
    } catch(e){}
  }
  for (const f of fs.readdirSync(cacheDir)){
    const k = f.replace(/\.(ogg|mp3)$/,'');
    if (/\.(ogg|mp3)$/.test(f) && !keep.has(k)) fs.rmSync(path.join(cacheDir,f));
  }

  const outJs = path.join(outDir, base + '.clips.js');
  fs.writeFileSync(outJs, 'window.TTS_CLIPS=Object.assign(window.TTS_CLIPS||{},' + JSON.stringify(clips) + ');');
  fs.writeFileSync(path.join(outDir, base + '.tts-manifest.json'),
                   JSON.stringify({ voice:VOICE, generatedAt:new Date().toISOString(),
                                    count:wanted.size, keys:Object.fromEntries([...wanted]) }, null, 2));

  const kb = (fs.statSync(outJs).size/1024)|0;
  console.log(`[tts] ${base}: ${wanted.size} clips (${generated} générés, ${cached} en cache) -> ${base}.clips.js (${kb} Ko)`);
  return { count:wanted.size, generated, cached };
}

// Catalogue de textes lus « statiques » : <script type="application/json" id="tts-static">.
// Source unique lue par le runtime ET le build — convention commune à tous les fichiers.
export function extractStatic(html){
  const m = html.match(/<script[^>]*id=["']tts-static["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return {};
  try { return JSON.parse(m[1].trim()); }
  catch(e){ throw new Error('bloc #tts-static : JSON invalide — ' + e.message); }
}
