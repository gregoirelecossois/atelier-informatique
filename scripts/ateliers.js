/* Catalogue des six ateliers — source unique de vérité pour tout ce qui a besoin de
 * connaître la liste des niveaux : le raccourci développeur de la page d'accueil, et le
 * tableau de bord enseignant.
 *
 * Ces données vivaient en double dans index.html. Deux copies d'une même liste finissent
 * toujours par diverger le jour où un niveau est ajouté — et c'est le tableau de bord,
 * celui qui sert à repérer un élève en difficulté, qui afficherait alors un avancement
 * faux. D'où ce fichier.
 *
 * `id` est le préfixe des clés de stockage (ms_unlocked, ms_curlevel, ms_step_l3…) ET la
 * clé d'atelier des trophées dans scripts/badges.js : les trois se recoupent, ne pas le
 * renommer. Les teintes reprennent celles de la vitrine des trophées.
 */
window.ATELIERS = [
  { id:'ms', fichier:'la-souris.html', nom:'La souris', ic:'🖱️', hue:'#2563eb',
    niveaux:['Clique !','Glisse-dépose','Le double-clic','Le clic droit','Sélectionner','La molette','👑 Combat de Boss'],
    missions:[6,5,5,6,4,4,1] },

  { id:'kb', fichier:'le-clavier.html', nom:'Le clavier', ic:'⌨️', hue:'#7c3aed',
    niveaux:['Les lettres','Les majuscules','Les accents','Les chiffres','Les symboles','Frappe libre','La chasse à la lave'],
    missions:[5,4,5,2,5,10,8] },

  { id:'tt', fichier:'traitement-texte.html', nom:'Traitement de texte', ic:'📝', hue:'#dc2626',
    niveaux:['Les bases','Paragraphes & Alignements','Listes & Structure','Le clavier magique','Écrire et déplacer','Les tableaux','Images & Objets'],
    missions:[13,12,9,9,12,15,24] },

  { id:'df', fichier:'dossiers-fichiers.html', nom:'Dossiers et fichiers', ic:'🗂️', hue:'#d97706',
    niveaux:['Le Bureau et les fenêtres','Naviguer dans les dossiers','Créer et nommer','Ranger : déplacer et copier','Supprimer et la corbeille','Rechercher et trier','Les extensions de fichiers','Propriétés des fichiers','👾 CORRUPTUS (Boss)'],
    missions:[4,4,4,8,6,4,9,6,1] },

  { id:'nv', fichier:'naviguer-internet.html', nom:'Naviguer sur internet', ic:'🌐', hue:'#0891b2',
    niveaux:['Ton navigateur','Les liens et les adresses','Chercher sur internet','Favoris et historique','Pubs et pop-ups (🪟 POPZILLA)','Sécurité et fiabilité','Les téléchargements','Les mots de passe','👾 INFOX (Boss final)'],
    missions:[4,4,4,4,4,4,4,4,2] },

  { id:'ml', fichier:'la-messagerie.html', nom:'La messagerie', ic:'✉️', hue:'#16a34a',
    niveaux:['Ton premier mail','À, Cc et Cci','Le carnet d\'adresses','Les pièces jointes','Mise en forme & signature','Range ta boîte !','Retrouve tes mails','L\'agenda','🎣 LE PHISHER (Boss final)'],
    missions:[3,7,4,8,4,4,4,3,2] }
];

/* Retrouve l'atelier auquel appartient une page, par son nom de fichier. Sert au
   battement de présence : scripts/store.js sait ainsi dire « Léa est dans La souris »
   sans que le moindre atelier ait à s'en occuper. */
window.ATELIER_PAR_FICHIER = function(chemin){
  var f = String(chemin || '').split('/').pop().split('?')[0];
  for (var i = 0; i < window.ATELIERS.length; i++) {
    if (window.ATELIERS[i].fichier === f) return window.ATELIERS[i];
  }
  return null;
};

/* Nombre total de niveaux, tous ateliers confondus — le dénominateur de l'avancement
   global affiché dans le tableau de bord. */
window.ATELIERS_TOTAL_NIVEAUX = window.ATELIERS.reduce(function(n, a){ return n + a.niveaux.length; }, 0);
