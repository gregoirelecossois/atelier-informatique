# Police d'emojis — Fluent Emoji

`fluent-emoji.woff2` force le **même rendu d'emojis sur tous les systèmes**
(Windows, macOS, Linux, Android, iOS) au lieu de laisser chaque OS utiliser sa
propre police (Segoe UI Emoji, Apple Color Emoji, Noto…). C'est le style 2D
coloré de Microsoft, le plus proche des emojis de Windows 11.

## D'où vient ce fichier

- Source : [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (licence **MIT**)
- Build webfont : [tetunori/fluent-emoji-webfont](https://github.com/tetunori/fluent-emoji-webfont)
  (`FluentEmojiColor.ttf`, COLRv1, licence **MIT**)
- **Sous-ensemble** : seul le jeu d'emojis réellement utilisé dans l'atelier
  (~165 glyphes) a été conservé. Tables bitmap (CBDT/CBLC) et SVG retirées,
  on ne garde que le COLR vectoriel → 87 Mo réduits à ~120 Ko.

## Régénérer / ajouter un emoji

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
