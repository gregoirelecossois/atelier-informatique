/* Extracteur de textes lus pour index.html.
 *
 * La page d'accueil n'a ni niveaux ni popups de jeu : son seul texte lu est celui de la
 * visite guidée de la vitrine de trophées (bulle d'aide affichée une fois, au premier
 * trophée gagné). Il vit donc entièrement dans le bloc #tts-static, et cet extracteur
 * se contente de le remonter — comme le font les autres extracteurs pour leur propre
 * bloc statique, en plus de leurs textes de jeu.
 *
 * Le texte DOIT rester identique à TOUR_TEXT dans scripts/badges.js : la clé du clip est
 * un hash du contenu, donc la moindre différence de ponctuation rendrait le clip
 * introuvable au runtime (repli sur la voix du navigateur). */
export function extractWanted(html, { ttsKey, ttsNormalize, extractStatic }){
  const STATIC = extractStatic(html);
  const wanted = new Map();
  for (const raw of Object.values(STATIC)){
    if (!raw) continue;
    const k = ttsKey(raw);
    if (!wanted.has(k)) wanted.set(k, ttsNormalize(raw));
  }
  return wanted;
}
