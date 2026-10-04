/* Fabrication de fichiers Word (.docx) et Excel (.xlsx) dans le navigateur.
 *
 * Sans bibliothèque, et c'est voulu : la page qui s'en sert manipule des mots de passe
 * en clair, et une dépendance chargée depuis un CDN serait du code tiers exécuté à côté
 * d'eux. Un .docx et un .xlsx ne sont que des archives zip de quelques fichiers XML ; les
 * écrire à la main tient en deux cents lignes qu'on peut relire.
 *
 * Le zip est écrit SANS compression (méthode « stored ») : pour quelques dizaines de Ko
 * de XML, compresser ne gagne rien d'utile, et Word comme Excel l'acceptent sans broncher.
 */
(function(){
'use strict';

/* ---- Zip ---------------------------------------------------------------- */
var TABLE_CRC = (function(){
  var t = new Uint32Array(256);
  for(var n = 0; n < 256; n++){
    var c = n;
    for(var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(octets){
  var c = 0xFFFFFFFF;
  for(var i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* fichiers : [{ nom: 'word/document.xml', texte: '<?xml…' }] → Uint8Array */
function zip(fichiers){
  var utf8 = new TextEncoder();
  var d = new Date();
  var heure = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  var jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  var morceaux = [], central = [], position = 0;
  fichiers.forEach(function(f){
    var nom = utf8.encode(f.nom), data = utf8.encode(f.texte), crc = crc32(data);

    var local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);              /* noms en UTF-8 */
    local.setUint16(8, 0, true);                   /* stored */
    local.setUint16(10, heure, true);
    local.setUint16(12, jour, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);

    var cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, heure, true);
    cd.setUint16(14, jour, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nom.length, true);
    cd.setUint32(42, position, true);

    morceaux.push(new Uint8Array(local.buffer), nom, data);
    central.push(new Uint8Array(cd.buffer), nom);
    position += 30 + nom.length + data.length;
  });

  var tailleCentral = central.reduce(function(t, m){ return t + m.length; }, 0);
  var fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, position, true);

  var tout = morceaux.concat(central, [new Uint8Array(fin.buffer)]);
  var sortie = new Uint8Array(position + tailleCentral + 22), o = 0;
  tout.forEach(function(m){ sortie.set(m, o); o += m.length; });
  return sortie;
}

/* Échappement XML. Les caractères de contrôle sont retirés : un seul d'entre eux, venu
   d'un copier-coller, suffit à ce que Word déclare le fichier corrompu. */
function x(s){
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
var NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
var NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
var NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/* ---- Word : fiches d'identifiants à projeter ----------------------------
 *
 * Une page par classe, en paysage — c'est le format d'un vidéoprojecteur. Gros
 * caractères, une ligne sur deux grisée pour que l'œil ne saute pas de ligne en suivant
 * son nom jusqu'à son mot de passe, et la ligne d'en-tête répétée en haut de chaque page
 * quand une classe déborde.
 *
 * classes : [{ nom: '5eA', eleves: [{ nom, prenom, identifiant, motdepasse }] }]
 * options : { titre, adresse, consignes: ['…', …] }
 */
var PAGE_L = 16838, PAGE_H = 11906, MARGE = 850;       /* A4 paysage, marges 1,5 cm */
var LARGEUR = PAGE_L - 2 * MARGE;
var COLS = [6100, 3900, LARGEUR - 6100 - 3900];

function run(texte, o){
  o = o || {};
  var pr = (o.police ? '<w:rFonts w:ascii="' + o.police + '" w:hAnsi="' + o.police + '" w:cs="' + o.police + '"/>' : '') +
    (o.gras ? '<w:b/><w:bCs/>' : '') +
    (o.couleur ? '<w:color w:val="' + o.couleur + '"/>' : '') +
    (o.taille ? '<w:sz w:val="' + o.taille * 2 + '"/><w:szCs w:val="' + o.taille * 2 + '"/>' : '');
  return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') +
    '<w:t xml:space="preserve">' + x(texte) + '</w:t></w:r>';
}

function para(contenu, o){
  o = o || {};
  /* L'ordre des éléments est imposé par le schéma : Word refuse le fichier sinon. */
  var pr = (o.garder ? '<w:keepNext/>' : '') +
    (o.sautAvant ? '<w:pageBreakBefore/>' : '') +
    '<w:spacing w:before="' + (o.avant || 0) + '" w:after="' + (o.apres == null ? 120 : o.apres) + '"/>' +
    (o.centre ? '<w:jc w:val="center"/>' : '');
  return '<w:p><w:pPr>' + pr + '</w:pPr>' + contenu + '</w:p>';
}

function cellule(largeur, contenu, fond){
  return '<w:tc><w:tcPr><w:tcW w:w="' + largeur + '" w:type="dxa"/>' +
    (fond ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fond + '"/>' : '') +
    '<w:vAlign w:val="center"/></w:tcPr>' + contenu + '</w:tc>';
}

function ligne(cellules, o){
  o = o || {};
  return '<w:tr><w:trPr><w:cantSplit/>' + (o.entete ? '<w:tblHeader/>' : '') +
    '<w:trHeight w:val="' + (o.hauteur || 560) + '" w:hRule="atLeast"/></w:trPr>' + cellules + '</w:tr>';
}

function tableauClasse(eleves){
  var bord = function(cote){ return '<w:' + cote + ' w:val="single" w:sz="8" w:space="0" w:color="9AA9BB"/>'; };
  var t = '<w:tbl><w:tblPr><w:tblW w:w="' + LARGEUR + '" w:type="dxa"/>' +
    '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bord).join('') + '</w:tblBorders>' +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid>' + COLS.map(function(l){ return '<w:gridCol w:w="' + l + '"/>'; }).join('') + '</w:tblGrid>';

  var tete = function(txt){ return para(run(txt, { gras: true, taille: 16, couleur: 'FFFFFF' }), { apres: 0 }); };
  t += ligne(
    cellule(COLS[0], tete('Élève'), '1F4FD1') +
    cellule(COLS[1], tete('Identifiant'), '1F4FD1') +
    cellule(COLS[2], tete('Mot de passe provisoire'), '1F4FD1'), { entete: true, hauteur: 480 });

  eleves.forEach(function(e, i){
    var fond = i % 2 ? 'EEF2F8' : null;
    t += ligne(
      cellule(COLS[0], para(run(e.nom + ' ', { gras: true, taille: 18 }) + run(e.prenom, { taille: 18 }), { apres: 0 }), fond) +
      cellule(COLS[1], para(run(e.identifiant, { police: 'Consolas', gras: true, taille: 22 }), { apres: 0 }), fond) +
      cellule(COLS[2], para(run(e.motdepasse, { police: 'Consolas', gras: true, taille: 22, couleur: '1F2A44' }), { apres: 0 }), fond));
  });
  return t + '</w:tbl>';
}

function docxIdentifiants(classes, options){
  options = options || {};
  var corps = classes.map(function(c, i){
    var html = para(run(options.titre || 'Atelier informatique', { gras: true, taille: 26, couleur: '1F4FD1' }) +
                    run('  —  ' + c.nom, { gras: true, taille: 26 }),
                    { sautAvant: i > 0, apres: 60, garder: true });
    if(options.adresse) html += para(run('Adresse : ', { taille: 14, couleur: '5E6778' }) +
                                     run(options.adresse, { taille: 14, gras: true }), { apres: 60, garder: true });
    (options.consignes || []).forEach(function(txt, k){
      html += para(run((k + 1) + '. ', { gras: true, taille: 14, couleur: '1F4FD1' }) + run(txt, { taille: 14 }),
                   { apres: 40, garder: true });
    });
    return html + para('', { apres: 80, garder: true }) + tableauClasse(c.eleves);
  }).join('');

  var doc = ENTETE_XML + '<w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:body>' + corps +
    '<w:sectPr><w:pgSz w:w="' + PAGE_L + '" w:h="' + PAGE_H + '" w:orient="landscape"/>' +
    '<w:pgMar w:top="' + MARGE + '" w:right="' + MARGE + '" w:bottom="' + MARGE + '" w:left="' + MARGE +
    '" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>';

  var styles = ENTETE_XML + '<w:styles xmlns:w="' + NS_W + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '</w:styles>';

  return new Blob([zip([
    { nom: '[Content_Types].xml', texte: ENTETE_XML + '<Types xmlns="' + NS_CT + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>' },
    { nom: '_rels/.rels', texte: ENTETE_XML + '<Relationships xmlns="' + NS_REL + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>' },
    { nom: 'word/_rels/document.xml.rels', texte: ENTETE_XML + '<Relationships xmlns="' + NS_REL + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { nom: 'word/document.xml', texte: doc },
    { nom: 'word/styles.xml', texte: styles }
  ])], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---- Excel : un tableau simple, une ligne d'en-tête -----------------------
 *
 * Les textes passent par la table des chaînes partagées (sharedStrings) plutôt qu'en
 * « inlineStr » : c'est la forme qu'Excel écrit lui-même, donc celle que tous les
 * lecteurs comprennent, y compris les plus rudimentaires, qui ignorent les chaînes en
 * ligne.
 *
 * entetes : ['NOM', 'Prénom', …] ; lignes : [['DUPONT', 'Léa', …], …] ; largeurs en caractères
 */
function colonne(i){ var s = ''; i++; while(i > 0){ var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function xlsxTableau(nomFeuille, entetes, lignes, largeurs){
  var chaines = [], index = {};
  function si(v){
    v = String(v == null ? '' : v);
    if(!(v in index)){ index[v] = chaines.length; chaines.push(v); }
    return index[v];
  }
  var toutes = [entetes].concat(lignes);
  var donnees = toutes.map(function(l, r){
    return '<row r="' + (r + 1) + '">' + l.map(function(v, c){
      var ref = colonne(c) + (r + 1);
      if(v == null || v === '') return '<c r="' + ref + '"' + (r ? '' : ' s="1"') + '/>';
      return '<c r="' + ref + '" t="s"' + (r ? '' : ' s="1"') + '><v>' + si(v) + '</v></c>';
    }).join('') + '</row>';
  }).join('');
  var derniere = colonne(entetes.length - 1) + toutes.length;

  var feuille = ENTETE_XML + '<worksheet xmlns="' + NS_S + '" xmlns:r="' + NS_R + '">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + entetes.map(function(e, i){
      var l = (largeurs && largeurs[i]) || 16;
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + l + '" customWidth="1"/>';
    }).join('') + '</cols>' +
    '<sheetData>' + donnees + '</sheetData>' +
    '<autoFilter ref="A1:' + derniere + '"/></worksheet>';

  var styles = ENTETE_XML + '<styleSheet xmlns="' + NS_S + '">' +
    '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4FD1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  var partage = ENTETE_XML + '<sst xmlns="' + NS_S + '" count="' + chaines.length + '" uniqueCount="' + chaines.length + '">' +
    chaines.map(function(v){ return '<si><t xml:space="preserve">' + x(v) + '</t></si>'; }).join('') + '</sst>';

  /* Un nom de feuille : 31 caractères au plus, et aucun de : \ / ? * [ ] */
  var nom = String(nomFeuille || 'Feuille1').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31);

  return new Blob([zip([
    { nom: '[Content_Types].xml', texte: ENTETE_XML + '<Types xmlns="' + NS_CT + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>' },
    { nom: '_rels/.rels', texte: ENTETE_XML + '<Relationships xmlns="' + NS_REL + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { nom: 'xl/workbook.xml', texte: ENTETE_XML + '<workbook xmlns="' + NS_S + '" xmlns:r="' + NS_R + '">' +
      '<sheets><sheet name="' + x(nom) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + x(nom.replace(/'/g, "''")) + '\'!$A$1:$' +
        colonne(entetes.length - 1) + '$' + toutes.length + '</definedName></definedNames></workbook>' },
    { nom: 'xl/_rels/workbook.xml.rels', texte: ENTETE_XML + '<Relationships xmlns="' + NS_REL + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>' },
    { nom: 'xl/worksheets/sheet1.xml', texte: feuille },
    { nom: 'xl/styles.xml', texte: styles },
    { nom: 'xl/sharedStrings.xml', texte: partage }
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function telecharger(blob, nom){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

window.Bureautique = { zip: zip, crc32: crc32, docxIdentifiants: docxIdentifiants, xlsxTableau: xlsxTableau, telecharger: telecharger };
})();
