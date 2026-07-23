# Synthèse vocale de l'atelier

Sur chaque popup, un bouton 🔊 : **clic** pour lire, **re-clic** (ou re-clic pendant la
lecture) pour arrêter ; l'icône devient ⏹ au survol pendant la lecture. La fermeture
d'une popup coupe automatiquement l'audio en cours. Voix **fr-FR-DeniseNeural** (Azure
via `edge-tts`), **pré-générée** puis jouée hors-ligne — l'application finale ne
nécessite aucune connexion.

Équipé : `le-clavier.html`, `la-souris.html`, `dossiers-fichiers.html`,
`traitement-texte.html`, `naviguer-internet.html`. `index.html` n'a pas de popup, rien
à faire.

## Pièces

| Fichier | Rôle |
|---|---|
| `tts-atelier.js` | Runtime (partagé par tous les fichiers) : injecte le 🔊, gère clic/lecture/arrêt, repli voix navigateur. |
| ↳ `ttsDecorateModal` | Popups classiques : lit `modal.dataset.ttsText`. |
| ↳ `ttsDecorateCard` | Cartes **hors `#modal`** (tutoriels de boss dessinés dans le terrain) : déduit le texte lu des sélecteurs passés. |
| `engine.mjs` | Moteur de build partagé : génération edge-tts, compression ffmpeg (Opus), cache, écriture `<page>.clips.js` + manifest. |
| `build-tts.mjs` | Dispatcher : trouve l'extracteur du fichier demandé (`extractors/<base>.mjs`) et appelle le moteur. |
| `extractors/<page>.mjs` | Un par fichier de l'atelier : sait extraire SES textes lus (structure de popups propre à chaque jeu). |
| `build-on-edit.mjs` | Hook `PostToolUse` : relance le build du fichier édité s'il a un extracteur. |
| `<page>.clips.js` | **Généré.** `window.TTS_CLIPS` = clips base64 indexés par hash de contenu. Versionné. |
| `.tts-cache/` | Cache mp3/ogg intermédiaire, **partagé entre tous les fichiers** (non versionné). |

## Principe : zéro resynchro manuelle

Chaque clip est indexé par le **hash de son texte** (`ttsKey`, identique dans le runtime
et le build). Si un texte lu change, son hash change → le build régénère ce clip, et le
runtime retrouve automatiquement le bon. Le hook `PostToolUse` déclenche ce build à chaque
édition d'un fichier équipé : **aucune remise à jour manuelle n'est jamais nécessaire.**

⚠️ `ttsNormalize` / `ttsKey` doivent rester **identiques** entre `tts-atelier.js` et
`engine.mjs`.

⚠️ Le cache `.tts-cache/` est **partagé** entre tous les fichiers : la purge des clips
obsolètes ne doit supprimer que ce qu'AUCUN manifest (`*.tts-manifest.json`) ne référence
— jamais se baser sur le seul `wanted` du fichier en cours de build (ça détruirait le
cache des autres fichiers).

## Ajouter un nouveau fichier

1. Repérer sa structure de popups (`openOverlay`/`closeOverlay`, textes lus : intro,
   mission, astuces, réussite/échec…).
2. Écrire `tts/extractors/<base>.mjs` — exporte `extractWanted(html, helpers)` qui
   retourne une `Map<clé, texte>`. Réutiliser `extractBalanced()`/`extractStatic()` de
   `engine.mjs`. Si le fichier référence des identifiants non définis en dehors du bloc
   extrait, les stubber individuellement ou utiliser un contexte auto-stub (voir
   `traitement-texte.mjs`/`naviguer-internet.mjs` pour l'exemple).
3. Dans le fichier HTML : ajouter `<script id="tts-static">` (JSON des textes littéraux
   réutilisables : réussite/échec/déblocage…) + `<script src="tts/tts-atelier.js">` +
   `<script src="tts/<base>.clips.js">`, **avant** le script principal du jeu et **sans**
   `defer` (la 1ʳᵉ popup peut s'afficher avant la fin du chargement).
4. Câbler `openOverlay()`/`closeOverlay()` (`ttsDecorateModal`/`ttsStopCurrent`), puis
   chaque popup : `modal.dataset.ttsText = ...` juste avant `openOverlay()`.
5. Éditer le fichier une fois (n'importe quel changement) pour déclencher le hook, qui
   génère `tts/<base>.clips.js` automatiquement.

Le hook se déclenche automatiquement dès qu'un fichier a un extracteur — pas besoin de
liste à maintenir ailleurs.

## Régénérer manuellement

```
node tts/build-tts.mjs le-clavier.html tts
```

Pré-requis : Python + `pip install edge-tts` + ffmpeg + internet (au build uniquement).

## Hors périmètre (assumé, sur tous les fichiers)

Confirmations (recommencer, mode dyslexique), sélecteur de niveaux, dialogues d'outils
secondaires, contenu strictement dynamique (score, nom de fichier tapé, propriétés
live d'un fichier), et — spécifique à `naviguer-internet.html` — le contenu web simulé.
Ces éléments basculent sur le repli voix du navigateur s'ils sont survolés/cliqués
malgré tout.

## Tutoriels de boss

Les cartes de tutoriel/briefing des boss ne vivent **pas** dans `#modal` : chaque jeu les
dessine dans son terrain. Elles passent donc par `ttsDecorateCard(carte, sélecteurHôte,
[sélecteursDeTexte])`, qui **déduit le texte lu du contenu affiché** — aucune carte ne
duplique son texte, il suit automatiquement le HTML.

| Fichier | Carte | Sélecteurs lus |
|---|---|---|
| `le-clavier.html` | `showTutoCard` / `hbTutoCard` | `.tc-title` + `.tc-text` |
| `la-souris.html` | `showBriefing` (`.boss-brief`) | `.bf-story` + `.bf-title` + `.bf-how` |
| `naviguer-internet.html` | `pzTutorial` (`.pz-tuto`), `pzPhaseCard` | `.pt-t`+`.pt-s`, `.pc-t`+`.pc-s` |
| `la-messagerie.html` | `phWaveIntro` / `phWaveFailed` (`.ph-wavecard`) | `.wc-t` + `.wc-s` |
| `dossiers-fichiers.html` | `showPhaseBriefing` | (dans `#modal`, voie normale) |

⚠️ Le texte lu est la concaténation des sélecteurs joints par `« . »`, chaque sélecteur
rassemblant **tous** ses éléments (`querySelectorAll`) joints par un espace. Les
extracteurs doivent reproduire exactement cette formule, sinon le hash ne correspond pas
et la carte retombe sur la voix du navigateur.

Comme ces cartes se ferment sans passer par `closeOverlay()`, le runtime coupe l'audio
tout seul dès que le bouton 🔊 quitte le DOM.

## Poids

Clips compressés en Opus mono ~24 kbps (déjà optimisé). Poids par fichier (2026-07-22) :
le-clavier 6,7 Mo (189 clips), la-souris 1,9 Mo (68), dossiers-fichiers 4,9 Mo (142),
traitement-texte 10,2 Mo (197 — le plus gros, 94 définitions de mission),
naviguer-internet 3,6 Mo (117), la-messagerie 8,2 Mo (201).

`le-clavier` a gonflé de 4,4 à 6,7 Mo en équipant les tutoriels de boss : la leçon
« Les MAJUSCULES comptent ! » est rendue **par lettre** (26 variantes d'un texte long).
Si le poids devient gênant, c'est le premier candidat à repenser (texte générique).
