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

/* ---------------------------------------------------------------------------
   Applications LIÉES — délibérément hors de window.ATELIERS.

   « Le PC » partage les comptes élèves (même origine, même session), mais ce n'est
   PAS un septième atelier : il vit dans un autre dépôt, il raisonne en chapitres et
   en étoiles plutôt qu'en niveaux et missions, et il ne compte ni dans l'avancement
   global, ni dans le compteur de jeux de la page d'accueil, ni dans les trophées.
   L'ajouter à ATELIERS aurait faussé ces trois-là d'un coup.

   Le tableau de bord l'affiche donc à part, après les six colonnes et derrière un
   séparateur. Les totaux sont ici parce que le serveur ne les connaît pas : il ne
   renvoie que des comptes bruts (cf. resumerLePc dans api/server.js).

   Les chapitres sont listés ici pour l'AFFICHAGE seulement — jamais pour écrire dans la
   progression de l'application. Si « Le PC » en renomme un, le tableau de bord l'affiche
   simplement comme non terminé : il se dégrade, il ne corrompt rien. Le déblocage, lui,
   passe par une instruction d'un seul nombre (cf. `debloquer` ci-dessous).
   --------------------------------------------------------------------------- */
window.APPS_LIEES = [
  { id:'pc', nom:'Le PC', ic:'🖥️', hue:'#0ea5e9',
    sousTitre:'monte ton ordinateur',
    url:'https://gregoirelecossois.github.io/le-pc/',
    /* Clé d'instruction : le tableau de bord y écrit un simple numéro de chapitre, que
       l'application lit à son démarrage, applique AVEC SA PROPRE LOGIQUE, puis efface.
       Le contrat entre les deux dépôts tient dans ce nombre : c'est ce qui permet à
       « Le PC » de refondre son modèle de données sans rien casser ici. */
    debloquer:'pc_debloquer',
    fiches:15, badges:10,
    chapitres:[
      { id:'decouverte',    nom:'La visite guidée' },
      { id:'nommer',        nom:'Comment ça s\'appelle ?' },
      { id:'reperer',       nom:'Trouve-le dans la tour' },
      { id:'roles',         nom:'À quoi ça sert ?' },
      { id:'montage',       nom:'Le montage' },
      { id:'cablage',       nom:'Le câblage' },
      { id:'peripheriques', nom:'Nomme les périphériques' },
      { id:'branchement',   nom:'Branche les périphériques' },
      { id:'demontage',     nom:'Le démontage' },
      { id:'defi',          nom:'Le défi du technicien' }
    ] }
];

/* Retrouve une application liée par son identifiant de présence. Même rôle que
   ATELIER_PAR_FICHIER pour les six ateliers, mais l'application se déclare elle-même
   (window.ATELIER_POSITION) : elle n'est pas servie depuis ce dépôt, son nom de
   fichier ne nous apprendrait rien. */
window.APP_LIEE = function(id){
  for (var i = 0; i < window.APPS_LIEES.length; i++) {
    if (window.APPS_LIEES[i].id === id) return window.APPS_LIEES[i];
  }
  return null;
};
