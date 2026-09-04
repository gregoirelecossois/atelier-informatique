# Polices — tout est servi en local, rien ne sort du serveur

**Règle absolue de ce dossier : aucune page de l'atelier ne doit charger une police
depuis un CDN.** Un simple `<link href="https://fonts.googleapis.com/...">` fait
contacter Google par le navigateur de chaque élève, et lui transmet son adresse IP et
son user-agent — un transfert vers un tiers hors UE, sans base légale ni consentement.
C'est précisément ce qu'un DPO académique regarde en premier. Les polices sont donc
toutes dans ce dossier, et chargées par `fonts.css`.

## Polices de texte — `fonts.css`

| Famille | Fichiers | Usage |
|---|---|---|
| **Fredoka** | `fredoka-latin.woff2`, `fredoka-latin-ext.woff2` | titres |
| **Nunito** | `nunito-latin.woff2`, `nunito-latin-ext.woff2` | texte courant |
| **Pixelify Sans** | `pixelify-sans-*.woff2` | boss de `la-souris.html` |

Licence **SIL Open Font License 1.1** pour les trois, qui autorise explicitement
l'auto-hébergement. Ce sont les fichiers variables que Google sert lui-même, repris
tels quels, découpés par sous-ensemble : on garde `latin` et `latin-ext`, on jette
hébreu / cyrillique / vietnamien dont l'atelier n'a pas l'usage (~126 Ko au total).

`fonts.css` est appelé par les neuf pages HTML, chacune avec un seul
`<link rel="stylesheet" href="assets/fonts/fonts.css">`. Pixelify Sans n'est
téléchargée que par les pages qui s'en servent réellement : déclarer une `@font-face`
ne déclenche aucune requête tant qu'aucune règle CSS n'utilise la famille.

### Mettre à jour ou ajouter une famille

```bash
# 1. récupérer la CSS de Google AVEC un user-agent moderne (sinon il sert du .ttf)
curl -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
  (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;700&display=swap"

# 2. y relever les blocs « latin » et « latin-ext » : télécharger les .woff2 dans ce
#    dossier, puis recopier dans fonts.css la unicode-range de chaque bloc à
#    l'identique — c'est elle qui évite de charger une police pour rien.
```

Une seule règle par famille et par sous-ensemble suffit : ces polices sont variables,
`font-weight:400 700` couvre toute la plage de graisses.

## Police d'emojis — `fluent-emoji.woff2`

Force le **même rendu d'emojis sur tous les systèmes** (Windows, macOS, Linux,
Android, iOS) au lieu de laisser chaque OS utiliser sa propre police (Segoe UI Emoji,
Apple Color Emoji, Noto…). C'est le style 2D coloré de Microsoft, le plus proche des
emojis de Windows 11. Elle est déclarée en `@font-face` directement dans chaque page.

- Source : [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (licence **MIT**)
- Build webfont : [tetunori/fluent-emoji-webfont](https://github.com/tetunori/fluent-emoji-webfont)
  (`FluentEmojiColor.ttf`, COLRv1, licence **MIT**)
- **Sous-ensemble** : seul le jeu d'emojis réellement utilisé dans l'atelier
  (~165 glyphes) a été conservé. Tables bitmap (CBDT/CBLC) et SVG retirées,
  on ne garde que le COLR vectoriel → 87 Mo réduits à ~120 Ko.

### Régénérer / ajouter un emoji

Si on ajoute un nouvel emoji dans une des pages HTML, il faut régénérer le
sous-ensemble pour qu'il soit inclus :

```bash
# 1. installer l'outillage
python -m pip install "fonttools[woff]" brotli

# 2. télécharger la police complète
curl -L -o FluentEmojiColor.ttf \
  https://tetunori.github.io/fluent-emoji-webfont/dist/FluentEmojiColor.ttf

# 3. sous-ensembler aux codepoints voulus (liste séparée par des virgules,
#    forme U+XXXX), puis remplacer assets/fonts/fluent-emoji.woff2
python -m fontTools.subset FluentEmojiColor.ttf \
  --unicodes="U+1F5B1,U+1F388,..." \
  --flavor=woff2 --output-file=fluent-emoji.woff2 \
  --drop-tables+=SVG,CBDT,CBLC,sbix --layout-features='*'
```

Les emojis qui n'existent pas dans Fluent (symboles d'interface comme
✓ ➜ ⌫ ⏎ ★ ☰) ne sont volontairement pas dans la police : ils restent rendus
par la police de texte normale.

## Police dyslexie — `opendyslexic-*.woff2`

`OpenDyslexic` (licence **SIL OFL 1.1**), déclarée dans chaque page et activée par
l'option d'accessibilité. Rien à régénérer.
