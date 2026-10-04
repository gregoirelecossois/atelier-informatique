/* Import d'une liste Pronote dans le tableau de bord enseignant.
 *
 * On colle le tableau des élèves copié depuis Pronote, on coche les classes voulues, et
 * les comptes sont créés d'un coup. À la fin, deux fichiers :
 *   - un Word à PROJETER : une page par classe, identifiant et mot de passe provisoire
 *     en gros caractères, avec la marche à suivre pour choisir son propre mot de passe ;
 *   - un Excel pour l'application « Comptes élèves » (import-mdp-reseau-educonnect), qui
 *     sait en recopier les identifiants dans les colonnes « Atelier Informatique » du
 *     classeur, avant l'export vers KeePass.
 *
 * Aucune route nouvelle côté serveur : chaque compte passe par POST /api/prof/eleves,
 * exactement comme « ＋ Nouveau compte ». Même identifiant fabriqué, même mot de passe,
 * même trace au journal — et rien à redéployer chez alwaysdata. Les comptes partent UN
 * PAR UN et jamais en parallèle : deux homonymes créés en même temps pourraient se voir
 * proposer le même identifiant libre, et le second échouerait.
 *
 * Les mots de passe en clair ne vivent QUE dans la mémoire de cette fenêtre. Rien n'est
 * écrit dans le navigateur ; fermer la fenêtre sans avoir téléchargé les fichiers les
 * perd (il reste « 🔑 Nouveau mot de passe » dans la fiche de chaque élève), d'où la
 * confirmation demandée avant de la fermer.
 *
 * Dépend de prof.html, chargé avant : api(), ouvrir(), fermer(), esc(), plat(), etat,
 * chargerTableau(). Et de scripts/bureautique.js pour les fichiers.
 */
(function(){
'use strict';

var CLE_CORRESPONDANCES = 'atl_import_pronote_classes';   /* classe Pronote → classe de l'atelier */

/* ---- Lecture du collage ------------------------------------------------- */
function propre(s){ return String(s == null ? '' : s).replace(/[  \s]+/g, ' ').trim(); }
function entete(s){ return plat(propre(s)).replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim(); }

/* Tabulation (copier-coller depuis Pronote), point-virgule ou virgule (export CSV) :
   on prend le séparateur le plus fréquent dans les premières lignes. */
function decouper(texte){
  var echantillon = texte.split(/\r?\n/).slice(0, 15).join('\n');
  var sep = ['\t', ';', ','].map(function(d){ return [d, echantillon.split(d).length]; })
    .sort(function(a, b){ return b[1] - a[1]; })[0][0];
  var lignes = [], ligne = [], champ = '', guillemets = false;
  for(var i = 0; i < texte.length; i++){
    var c = texte[i];
    if(guillemets){
      if(c === '"'){ if(texte[i + 1] === '"'){ champ += '"'; i++; } else guillemets = false; }
      else champ += c;
    }else if(c === '"' && champ === '') guillemets = true;
    else if(c === sep){ ligne.push(champ); champ = ''; }
    else if(c === '\n'){ ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if(c !== '\r') champ += c;
  }
  if(champ || ligne.length){ ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

/* Cherche la ligne d'en-tête (Nom, Prénom, Classe) dans les trente premières lignes :
   selon ce qu'on a sélectionné dans Pronote, le collage commence parfois par un titre. */
function lirePronote(texte){
  var lignes = decouper(texte);
  for(var r = 0; r < Math.min(lignes.length, 30); r++){
    var t = lignes[r].map(entete);
    var iNom = t.indexOf('nom'), iPrenom = t.indexOf('prenom');
    var iClasse = t.indexOf('classe') >= 0 ? t.indexOf('classe') : t.indexOf('classes');
    if(iNom < 0 || iPrenom < 0 || iClasse < 0) continue;

    var eleves = [], vus = {}, ignorees = 0;
    for(var i = r + 1; i < lignes.length; i++){
      var l = lignes[i];
      var nom = propre(l[iNom]), prenom = propre(l[iPrenom]), classe = propre(l[iClasse]);
      if(!nom && !prenom) continue;
      if(!nom || !prenom || !classe){ ignorees++; continue; }   /* incomplète : on ne devine pas */
      var cle = cleEleve(prenom, nom) + '|' + plat(classe);
      if(vus[cle]) continue;                     /* même élève collé deux fois */
      vus[cle] = true;
      eleves.push({ uid: i, nom: nom.toLocaleUpperCase('fr'), prenom: prenom, classe: classe });
    }
    return { eleves: eleves, ignorees: ignorees };
  }
  throw new Error('Je ne trouve pas les colonnes « Nom », « Prénom » et « Classe ». ' +
    'Copie le tableau de Pronote avec sa ligne de titres.');
}

/* Rapprochement tolérant : accents, casse, tirets et espaces ne comptent pas. */
function cleEleve(prenom, nom){ return plat(prenom).replace(/[^a-z]/g, '') + '|' + plat(nom).replace(/[^a-z]/g, ''); }

/* « 5EME A », « 5ème A », « 5eA » → « 5ea » : de quoi reconnaître une classe déjà créée
   dans l'atelier sous un nom un peu différent de celui de Pronote. */
function cleClasse(s){
  return plat(s).replace(/[^a-z0-9]/g, '').replace(/^(\d)(?:ieme|eme|e)/, '$1e');
}

/* La classe de l'atelier qui correspond le mieux : même nom d'abord, sinon la classe de
   NIVEAU qui la contient — un établissement démarre avec « 5e » ou « CAP1 » (cf.
   CLASSES_DE_BASE côté serveur), et la « 5EME A » de Pronote y a sa place. */
function classeProche(k){
  var exacte = etat.classes.filter(function(c){ return cleClasse(c.nom) === k; })[0];
  if(exacte) return exacte;
  return etat.classes.filter(function(c){
    var kc = cleClasse(c.nom);
    return kc.length >= 2 && k.indexOf(kc) === 0;
  }).sort(function(a, b){ return cleClasse(b.nom).length - cleClasse(a.nom).length; })[0] || null;
}

function lireCorrespondances(){ try{ return JSON.parse(localStorage.getItem(CLE_CORRESPONDANCES) || '{}') || {}; }catch(e){ return {}; } }
function ecrireCorrespondance(cle, cible){
  try{ var m = lireCorrespondances(); m[cle] = cible; localStorage.setItem(CLE_CORRESPONDANCES, JSON.stringify(m)); }catch(e){}
}

/* ---- État de la fenêtre --------------------------------------------------- */
var imp = null;

function preparer(eleves){
  var existants = {};
  etat.eleves.forEach(function(e){ if(e.role !== 'prof') existants[cleEleve(e.prenom, e.nom)] = e; });
  var memo = lireCorrespondances();

  var parClasse = {};
  var classes = [];
  eleves.forEach(function(e){
    e.existant = existants[cleEleve(e.prenom, e.nom)] || null;
    e.coche = !e.existant;
    var k = cleClasse(e.classe) || plat(e.classe);
    if(!parClasse[k]){
      var connue = classeProche(k);
      var cible = memo[k] && (memo[k].charAt(0) === '+' ||
                  etat.classes.some(function(c){ return c.nom === memo[k]; }))
        ? memo[k] : (connue ? connue.nom : '+' + e.classe);
      parClasse[k] = { cle: k, nom: e.classe, eleves: [], coche: false, cible: cible, ouvert: false };
      classes.push(parClasse[k]);
    }
    parClasse[k].eleves.push(e);
  });
  var tri = function(a, b){ return a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'); };
  classes.forEach(function(c){ c.eleves.sort(tri); });
  classes.sort(function(a, b){ return a.nom.localeCompare(b.nom, 'fr', { numeric: true }); });
  return classes;
}

function nomCible(c){ return c.cible.charAt(0) === '+' ? c.cible.slice(1) : c.cible; }
function aCreer(){
  var l = [];
  imp.classes.forEach(function(c){
    if(c.coche) c.eleves.forEach(function(e){ if(e.coche) l.push({ e: e, classe: c }); });
  });
  return l;
}

/* ---- Écran 1 : coller --------------------------------------------------- */
function ecranCollage(){
  imp = { classes: [], crees: [], erreurs: [], enCours: false, stop: false, telecharge: false };
  var b = ouvrir(
    '<h2>📋 Importer une liste Pronote</h2>' +
    '<div class="id">Dans Pronote, affiche la liste des élèves, sélectionne tout le tableau ' +
      '(<b>Ctrl+A</b>), copie-le (<b>Ctrl+C</b>) et colle-le ci-dessous (<b>Ctrl+V</b>). ' +
      'Seules les colonnes <b>Nom</b>, <b>Prénom</b> et <b>Classe</b> servent ; les autres sont ignorées.</div>' +
    '<div id="msg"></div>' +
    '<textarea id="iColle" class="imp-colle" spellcheck="false" ' +
      'placeholder="Nom&#9;Prénom&#9;Né(e) le&#9;…&#9;Classe"></textarea>' +
    '<div class="actes"><button class="btn" id="iAnnuler">Annuler</button>' +
    '<button class="btn primaire pousse" id="iLire">Lire la liste →</button></div>', 'large', retenir);

  var zone = b.querySelector('#iColle');
  function lire(){
    try{
      var lu = lirePronote(zone.value);
      if(!lu.eleves.length) throw new Error('Aucun élève sous la ligne de titres.');
      imp.classes = preparer(lu.eleves);
      imp.ignorees = lu.ignorees;
      ecranChoix();
    }catch(err){
      b.querySelector('#msg').innerHTML = '<div class="msg ko">' + esc(err.message) + '</div>';
    }
  }
  b.querySelector('#iAnnuler').onclick = fermer;
  b.querySelector('#iLire').onclick = lire;
  /* Un collage se lit tout seul : c'est le geste qu'on vient d'expliquer. */
  zone.addEventListener('paste', function(){ setTimeout(function(){ if(zone.value.trim()) lire(); }, 0); });
  setTimeout(function(){ zone.focus(); }, 30);
}

/* ---- Écran 2 : cocher les classes --------------------------------------- */
function optionsCible(c){
  var neuve = '+' + c.nom;
  var opts = etat.classes.map(function(k){
    return '<option value="' + esc(k.nom) + '"' + (c.cible === k.nom ? ' selected' : '') + '>' + esc(k.nom) + '</option>';
  });
  /* « créer » n'est proposé que si aucune classe de l'atelier ne porte déjà ce nom. */
  if(!etat.classes.some(function(k){ return plat(k.nom) === plat(c.nom); })){
    opts.unshift('<option value="' + esc(neuve) + '"' + (c.cible === neuve ? ' selected' : '') +
      '>＋ créer la classe « ' + esc(c.nom) + ' »</option>');
  }
  return opts.join('');
}

function ecranChoix(){
  var total = imp.classes.reduce(function(n, c){ return n + c.eleves.length; }, 0);
  var b = ouvrir(
    '<h2>Quelles classes ajouter ?</h2>' +
    '<div class="id">' + total + ' élève' + (total > 1 ? 's' : '') + ' lu' + (total > 1 ? 's' : '') +
      ' dans ' + imp.classes.length + ' classe' + (imp.classes.length > 1 ? 's' : '') +
      (imp.ignorees ? ' (' + imp.ignorees + ' ligne' + (imp.ignorees > 1 ? 's' : '') + ' ignorée' +
        (imp.ignorees > 1 ? 's' : '') + ' : nom, prénom ou classe manquant)' : '') +
      '. Coche celles dont tu veux créer les comptes. Un élève qui a <b>déjà un compte</b> ' +
      'est décoché d\'office.</div>' +
    '<div class="imp-outils"><button class="btn petit" id="iTout">Tout cocher</button>' +
      '<button class="btn petit" id="iRien">Tout décocher</button></div>' +
    '<div id="iListe" class="imp-liste"></div>' +
    '<div class="actes"><button class="btn" id="iRetour">← Retour</button>' +
      '<span class="qui imp-bilan" id="iBilan"></span>' +
      '<button class="btn primaire pousse" id="iCreer">Créer les comptes</button></div>', 'large', retenir);

  function peindreListe(){
    b.querySelector('#iListe').innerHTML = imp.classes.map(function(c, i){
      var deja = c.eleves.filter(function(e){ return e.existant; }).length;
      var n = c.eleves.filter(function(e){ return e.coche; }).length;
      return '<div class="imp-cl' + (c.coche ? ' on' : '') + '" data-i="' + i + '">' +
        '<div class="imp-tete">' +
          '<label class="imp-coche"><input type="checkbox" data-cl' + (c.coche ? ' checked' : '') + '>' +
            '<b>' + esc(c.nom) + '</b></label>' +
          '<span class="imp-nb">' + n + '/' + c.eleves.length + ' élève' + (c.eleves.length > 1 ? 's' : '') +
            (deja ? ' · <span class="imp-deja">' + deja + ' déjà inscrit' + (deja > 1 ? 's' : '') + '</span>' : '') + '</span>' +
          '<span class="imp-fleche">→</span>' +
          '<select data-cible title="Classe de l\'atelier où ranger ces élèves">' + optionsCible(c) + '</select>' +
          '<button class="btn petit" data-voir>' + (c.ouvert ? 'Masquer' : 'Voir les élèves') + '</button>' +
        '</div>' +
        (c.ouvert ? '<div class="imp-eleves">' + c.eleves.map(function(e, j){
          return '<label class="imp-el' + (e.existant ? ' deja' : '') + '"><input type="checkbox" data-el="' + j + '"' +
            (e.coche ? ' checked' : '') + '> ' + esc(e.nom + ' ' + e.prenom) +
            (e.existant ? ' <small>déjà un compte : ' + esc(e.existant.identifiant) +
              (e.existant.classe ? ' (' + esc(e.existant.classe) + ')' : '') + '</small>' : '') + '</label>';
        }).join('') + '</div>' : '') +
      '</div>';
    }).join('');
    var n = aCreer().length;
    b.querySelector('#iBilan').textContent = n ? n + ' compte' + (n > 1 ? 's' : '') + ' à créer' : 'Aucune classe cochée';
    b.querySelector('#iCreer').disabled = !n;
  }

  var liste = b.querySelector('#iListe');
  liste.addEventListener('change', function(e){
    var bloc = e.target.closest('.imp-cl');
    if(!bloc) return;
    var c = imp.classes[+bloc.getAttribute('data-i')];
    if(e.target.hasAttribute('data-cl')) c.coche = e.target.checked;
    else if(e.target.hasAttribute('data-el')) c.eleves[+e.target.getAttribute('data-el')].coche = e.target.checked;
    else if(e.target.hasAttribute('data-cible')){ c.cible = e.target.value; ecrireCorrespondance(c.cle, c.cible); }
    peindreListe();
  });
  liste.addEventListener('click', function(e){
    if(!e.target.hasAttribute('data-voir')) return;
    var c = imp.classes[+e.target.closest('.imp-cl').getAttribute('data-i')];
    c.ouvert = !c.ouvert;
    peindreListe();
  });
  b.querySelector('#iTout').onclick = function(){ imp.classes.forEach(function(c){ c.coche = true; }); peindreListe(); };
  b.querySelector('#iRien').onclick = function(){ imp.classes.forEach(function(c){ c.coche = false; }); peindreListe(); };
  b.querySelector('#iRetour').onclick = ecranCollage;
  b.querySelector('#iCreer').onclick = function(){
    var l = aCreer();
    if(!l.length) return;
    var neuves = {};
    imp.classes.forEach(function(c){ if(c.coche && c.cible.charAt(0) === '+') neuves[nomCible(c)] = true; });
    var nn = Object.keys(neuves);
    if(!confirm('Créer ' + l.length + ' compte' + (l.length > 1 ? 's' : '') + ' élève' + (l.length > 1 ? 's' : '') +
        (nn.length ? '\net ' + nn.length + ' nouvelle' + (nn.length > 1 ? 's' : '') + ' classe' + (nn.length > 1 ? 's' : '') +
          ' (' + nn.join(', ') + ')' : '') + ' ?')) return;
    creer(l, nn);
  };
  peindreListe();
}

/* ---- Écran 3 : création --------------------------------------------------- */
function creer(liste, neuves){
  imp.enCours = true; imp.stop = false; imp.crees = []; imp.erreurs = [];
  var b = ouvrir(
    '<h2>Création des comptes…</h2>' +
    '<div class="id">Ne ferme pas cette page pendant la création.</div>' +
    '<div class="imp-piste"><div class="imp-jus" id="iJus"></div></div>' +
    '<div class="imp-etape" id="iEtape">Préparation…</div>' +
    '<div class="actes"><button class="btn pousse" id="iStop">Interrompre</button></div>', 'large', retenir);
  b.querySelector('#iStop').onclick = function(){ imp.stop = true; this.disabled = true; this.textContent = 'Arrêt après ce compte…'; };

  /* Les classes neuves d'abord, rangées APRÈS celles qui existent : sans ordre, elles
     arriveraient en tête des pastilles du tableau de bord. */
  var rang = etat.classes.reduce(function(m, c){ return Math.max(m, c.ordre || 0); }, 0);
  var suite = Promise.resolve();
  neuves.forEach(function(nom, i){
    suite = suite.then(function(){
      return api('POST', '/api/prof/classes', { nom: nom, ordre: rang + i + 1 }).then(function(r){ etat.classes = r.classes; });
    });
  });

  var i = 0;
  function suivant(){
    if(imp.stop || i >= liste.length) return Promise.resolve();
    var it = liste[i++];
    b.querySelector('#iEtape').textContent = 'Compte ' + i + ' sur ' + liste.length + ' — ' + it.e.nom + ' ' + it.e.prenom;
    return api('POST', '/api/prof/eleves', { prenom: it.e.prenom, nom: it.e.nom, classe: nomCible(it.classe) })
      .then(function(c){
        imp.crees.push({ nom: it.e.nom, prenom: it.e.prenom, classePronote: it.e.classe,
                         classe: nomCible(it.classe), identifiant: c.identifiant, motdepasse: c.motdepasse });
        it.e.coche = false;            /* un retour en arrière ne le recréerait pas */
      }, function(err){
        /* Session tombée : inutile d'insister sur les suivants, tous échoueraient. */
        if(err.statut === 401 || err.statut === 403) { imp.stop = true; imp.motifArret = err.message; }
        imp.erreurs.push({ nom: it.e.nom, prenom: it.e.prenom, classe: it.e.classe, message: err.message });
      })
      .then(function(){
        b.querySelector('#iJus').style.width = Math.round(i * 100 / liste.length) + '%';
        return suivant();
      });
  }

  suite.then(suivant).catch(function(err){
    imp.erreurs.push({ nom: '', prenom: '', classe: '', message: 'Création des classes : ' + err.message });
  }).then(function(){
    imp.enCours = false;
    imp.interrompu = imp.stop && i < liste.length;
    imp.restants = liste.length - i;
    chargerTableau().catch(function(){});
    ecranResultat();
  });
}

/* ---- Écran 4 : résultat et fichiers ------------------------------------- */
function adresseAtelier(){
  if(!/^https?:$/.test(location.protocol)) return '';
  return location.host + location.pathname.replace(/[^\/]*$/, '');
}

function consignes(){
  var regles = (window.ATL_REGLES_MDP || []).join(', ');
  return [
    adresseAtelier() ? 'Ouvre l\'Atelier informatique à l\'adresse ci-dessus.' : 'Ouvre l\'Atelier informatique.',
    'Clique sur « Non connecté·e » en haut de l\'écran, puis tape ton identifiant et ton mot de passe provisoire.',
    'Choisis ton propre mot de passe' + (regles ? ' : ' + regles : '') + '. Tape-le deux fois.',
    'Retiens-le bien : le mot de passe provisoire ne marchera plus jamais.'
  ];
}

function parClasse(){
  var groupes = {}, ordre = [];
  imp.crees.forEach(function(c){
    if(!groupes[c.classe]){ groupes[c.classe] = { nom: c.classe, eleves: [] }; ordre.push(c.classe); }
    groupes[c.classe].eleves.push(c);
  });
  var tri = function(a, b){ return a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'); };
  /* Dans l'ordre des pastilles du tableau de bord, c'est celui de l'année. */
  var rang = {};
  etat.classes.forEach(function(c, i){ rang[c.nom] = i; });
  ordre.sort(function(a, b){ return (rang[a] == null ? 1e6 : rang[a]) - (rang[b] == null ? 1e6 : rang[b]) || a.localeCompare(b, 'fr', { numeric: true }); });
  return ordre.map(function(k){ groupes[k].eleves.sort(tri); return groupes[k]; });
}

function jour(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

function fichierWord(){
  var blob = window.Bureautique.docxIdentifiants(parClasse(), {
    titre: 'Atelier informatique', adresse: adresseAtelier(), consignes: consignes()
  });
  window.Bureautique.telecharger(blob, 'Identifiants Atelier informatique ' + jour() + '.docx');
  imp.telecharge = true;
}

/* Colonnes lues par l'étape « Atelier informatique » de l'application Comptes élèves.
   La classe PRONOTE y figure telle quelle : c'est elle que l'application sait associer
   aux feuilles de son classeur (« 5EME A » → feuille 5eme). */
function fichierExcel(){
  var lignes = [];
  parClasse().forEach(function(g){
    g.eleves.forEach(function(c){ lignes.push([c.nom, c.prenom, c.classePronote, c.classe, c.identifiant, c.motdepasse]); });
  });
  var blob = window.Bureautique.xlsxTableau('Atelier informatique',
    ['NOM', 'Prénom', 'Classe', 'Classe Atelier', 'Identifiant Atelier', 'Mot de passe provisoire'],
    lignes, [22, 20, 12, 14, 20, 26]);
  window.Bureautique.telecharger(blob, 'Comptes Atelier informatique ' + jour() + '.xlsx');
  imp.telecharge = true;
}

function ecranResultat(){
  var n = imp.crees.length;
  var erreurs = imp.erreurs.map(function(e){
    return '<li>' + esc((e.nom + ' ' + e.prenom).trim() || '—') + (e.classe ? ' (' + esc(e.classe) + ')' : '') +
      ' : ' + esc(e.message) + '</li>';
  }).join('');
  var apercu = parClasse().map(function(g){
    return '<tr><th colspan="3">' + esc(g.nom) + '</th></tr>' + g.eleves.map(function(c){
      return '<tr><td>' + esc(c.nom + ' ' + c.prenom) + '</td><td><code>' + esc(c.identifiant) +
        '</code></td><td><code>' + esc(c.motdepasse) + '</code></td></tr>';
    }).join('');
  }).join('');

  var b = ouvrir(
    '<h2>' + (n ? '✅ ' + n + ' compte' + (n > 1 ? 's' : '') + ' créé' + (n > 1 ? 's' : '') : 'Aucun compte créé') + '</h2>' +
    '<div class="id">' + (imp.interrompu
      ? 'Création interrompue' + (imp.motifArret ? ' (' + esc(imp.motifArret) + ')' : '') + ' : ' +
        imp.restants + ' élève' + (imp.restants > 1 ? 's' : '') + ' restent à créer — relance l\'import, ' +
        'ceux qui viennent d\'être créés seront reconnus et décochés.'
      : 'Les comptes apparaissent dans le tableau de bord.') + '</div>' +
    (erreurs ? '<div class="msg ko">Échecs :<ul class="imp-err">' + erreurs + '</ul></div>' : '') +
    (n ? '<div class="msg imp-alerte">⚠️ Les mots de passe provisoires ne sont affichés <b>qu\'ici, une seule fois</b>. ' +
      'Télécharge les fichiers avant de fermer. Ils contiennent les mots de passe en clair : supprime-les une ' +
      'fois tes élèves connectés — à la première connexion, chacun choisit le sien et le provisoire ne sert plus.</div>' +
      '<div class="imp-fichiers">' +
        '<button class="btn primaire" id="iWord">📄 Fiches à projeter (Word)</button>' +
        '<button class="btn" id="iExcel">📊 Tableau pour « Comptes élèves » (Excel)</button>' +
      '</div>' +
      '<p class="aide imp-aide">Le fichier Excel s\'importe dans l\'application <b>Comptes élèves</b>, ' +
        'étape facultative « Atelier informatique », avant l\'export vers KeePass.</p>' +
      '<details class="imp-apercu"><summary>Voir les identifiants à l\'écran</summary>' +
        '<table>' + apercu + '</table></details>' : '') +
    '<div class="actes"><button class="btn primaire pousse" id="iFermer">Fermer</button></div>', 'large', retenir);

  if(n){
    b.querySelector('#iWord').onclick = fichierWord;
    b.querySelector('#iExcel').onclick = fichierExcel;
  }
  b.querySelector('#iFermer').onclick = fermer;
}

/* Fermer la fenêtre (Échap, clic à côté, bouton) : jamais pendant la création, et pas
   sans confirmation tant que des mots de passe n'ont été téléchargés nulle part. */
function retenir(){
  if(!imp) return true;
  if(imp.enCours) return false;
  if(imp.crees.length && !imp.telecharge &&
     !confirm('Les mots de passe provisoires n\'ont pas été téléchargés.\n\n' +
              'Si tu fermes, ils seront perdus : il faudra en refaire un pour chaque élève ' +
              'depuis sa fiche. Fermer quand même ?')) return false;
  imp = null;
  return true;
}

window.addEventListener('beforeunload', function(e){
  if(imp && (imp.enCours || (imp.crees.length && !imp.telecharge))){ e.preventDefault(); e.returnValue = ''; }
});

window.ImportPronote = { ouvrir: ecranCollage, retenir: retenir, lirePronote: lirePronote, cleClasse: cleClasse };
})();
