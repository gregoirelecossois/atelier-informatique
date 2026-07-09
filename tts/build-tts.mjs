#!/usr/bin/env node
/* Génère les clips de synthèse vocale (voix Denise / edge-tts) pour un fichier
 * de l'atelier.
 *
 *   node tts/build-tts.mjs <chemin.html> [dossier-sortie]
 *
 * Dispatcher générique : chaque fichier a son propre extracteur de textes dans
 * tts/extractors/<base>.mjs (structure de popups différente par fichier), mais
 * tous partagent le même moteur (tts/engine.mjs) pour génération/cache/compression.
 *
 * - Clé par CONTENU (hash FNV-1a) : le runtime (tts-atelier.js) recalcule la même
 *   clé -> correspondance garantie, aucune resynchro manuelle.
 * - Cache incrémental (.tts-cache) : ne régénère un clip que si son texte a changé.
 * - Sortie : <sortie>/<base>.clips.js  (window.TTS_CLIPS = {...})  + manifest.
 *
 * Pré-requis : Python + edge-tts (`pip install edge-tts`), ffmpeg, et une connexion
 * internet AU MOMENT DE LA GÉNÉRATION uniquement. L'application finale est 100% hors-ligne.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateClips, ttsKey, ttsNormalize, extractStatic } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function hasExtractor(base){
  return fs.existsSync(path.join(HERE, 'extractors', base + '.mjs'));
}

export async function build(htmlPath, outDir){
  outDir = outDir || path.dirname(htmlPath);
  const base = path.basename(htmlPath).replace(/\.html?$/i,'');
  const extractorPath = path.join(HERE, 'extractors', base + '.mjs');
  if (!fs.existsSync(extractorPath)){
    throw new Error(`Pas d'extracteur pour "${base}" (attendu : tts/extractors/${base}.mjs)`);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const { extractWanted } = await import(pathToFileURL(extractorPath).href);
  const wanted = extractWanted(html, { ttsKey, ttsNormalize, extractStatic });
  return generateClips(base, outDir, wanted);
}

// exécution directe en ligne de commande
if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href)){
  const htmlPath = process.argv[2];
  if (!htmlPath){ console.error('usage: node tts/build-tts.mjs <html> [outdir]'); process.exit(1); }
  build(htmlPath, process.argv[3]).catch(e=>{ console.error('[tts] échec:', e.message); process.exit(1); });
}
