/* Catalogue des travaux à la maison — source unique de vérité pour la page d'entrée des
 * élèves (maison.html) ET pour la page de suivi de l'enseignant (travail-maison.html).
 *
 * Un « travail à la maison » est une page d'exercices pour téléphone, où l'élève entre
 * SANS COMPTE (un prénom, une classe) et dont l'avancée remonte au serveur de l'Atelier
 * (POST /api/devoir/passage, voir api/README.md § 4 bis). La page elle-même peut vivre
 * dans n'importe quel dépôt : ce fichier dit seulement où elle est et comment la lire.
 *
 * LES ÉLÈVES N'ONT QU'UN LIEN POUR TOUTE L'ANNÉE : maison.html?c=CODE. Ils y donnent leur
 * prénom et leur classe une fois, puis voient une tuile par travail de ce catalogue
 * destiné à leur classe.
 *
 * AJOUTER UN TRAVAIL DANS L'ANNÉE, c'est ajouter une entrée ici — sa tuile apparaît chez
 * les élèves des classes visées, et sa fiche dans le suivi. Rien d'autre à toucher, et
 * rien à redéployer côté serveur :
 *
 *   id        l'identifiant que la page envoie dans `devoir` ([a-z0-9-], 30 caractères
 *             au plus). C'est LUI qui range les lignes : ne jamais le renommer une fois
 *             le travail distribué, les lignes déjà reçues resteraient sous l'ancien.
 *   titre     le nom affiché, à l'élève comme à l'enseignant
 *   ic        un emoji
 *   matiere   « Technologie », « Sciences »… — sert à regrouper quand la liste grandit
 *   niveaux   les classes à qui la tuile s'affiche : ['5e', '3e']. [] = toutes.
 *   duree     ce qu'on annonce à l'élève
 *   resume    une phrase : ce que l'élève y fait
 *   url       l'adresse de la page, SANS le code — la page d'entrée ajoute « ?c=CODE »
 *   etapes    le nom de chaque étape, dans l'ordre. Leur nombre doit être celui que la
 *             page envoie dans `etapes` : il sert à lire « 3 / 5 » en clair.
 *   masque    (facultatif) true = la tuile disparaît chez les élèves, la fiche reste
 *             dans le suivi. Pour clore un travail sans perdre ses résultats.
 *
 * Un travail dont des lignes arrivent mais qui n'est PAS listé ici s'affiche quand même
 * dans le suivi, sous son identifiant brut : mieux vaut un nom laid qu'un travail
 * invisible.
 *
 * L'ordre du tableau est l'ordre d'affichage : le plus récent en premier.
 */
window.TRAVAUX = [
  {
    id: 'pc-1',
    titre: 'Le PC à la maison',
    ic: '🖥️',
    matiere: 'Technologie',
    niveaux: ['5e', '3e'],
    duree: '20 min',
    resume: 'Réviser les 12 pièces de l\'ordinateur : cinq missions, une petite leçon puis un jeu.',
    url: 'https://gregoirelecossois.github.io/le-pc/maison.html',
    etapes: ['Les trois grands', 'Le cerveau du PC', 'Garder les fichiers', 'Chacun à sa place', 'Le défi final']
  }
];
