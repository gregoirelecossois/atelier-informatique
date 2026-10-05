/* Configuration de la synchronisation en ligne — le SEUL fichier à modifier pour brancher
 * l'atelier sur un serveur. Il n'y a aucun secret ici : l'adresse de l'API est publique,
 * c'est le serveur qui garde les mots de passe et décide qui a le droit de faire quoi.
 *
 *   api : ''                       → mode LOCAL. L'atelier se comporte exactement comme
 *                                    avant : progression dans le navigateur du poste, pas
 *                                    de compte, pas de réseau. C'est la valeur livrée.
 *   api : 'https://…alwaysdata.net' → mode EN LIGNE. Un élève peut se connecter et
 *                                    retrouver sa progression sur n'importe quel poste.
 *
 * Ouvert en file:// (double-clic sur le fichier), le mode en ligne est TOUJOURS désactivé :
 * l'atelier doit rester utilisable sans réseau, clé USB à la main.
 */
window.ATELIER_CONFIG = {
  api: 'https://progression-informatique.alwaysdata.net',

  /* Nom affiché dans l'écran de connexion, AVANT toute connexion — juste cosmétique.
     À laisser vide dès que le serveur sert plusieurs collèges : ce fichier est le même
     pour tout le monde, et y écrire le nom d'un établissement serait faux pour les
     autres. Une fois connecté, le nom du collège vient du serveur avec le profil, et
     c'est celui-là qui fait foi. */
  etablissement: '',

  /* Adresse du tableau de bord enseignant. Absolue, et pas « prof.html » en relatif :
     ce même fichier est chargé par des applications publiées AILLEURS (« Le PC »), d'où
     un lien relatif tomberait sur une page qui n'existe pas chez elles.
     Vide → lien relatif « prof.html », ce qui suffit quand l'atelier est seul. */
  tableauBord: 'https://gregoirelecossois.github.io/atelier-informatique/prof.html',

  /* Adresse de l'espace administrateur — les établissements et les comptes enseignants.
     Même raison d'être absolue que ci-dessus. Vide → lien relatif « admin.html ». */
  espaceAdmin: 'https://gregoirelecossois.github.io/atelier-informatique/admin.html',

  /* true  → un élève non connecté voit un avertissement bien visible.
     false → l'avertissement reste discret (utile en démo ou en classe sans comptes). */
  insisterConnexion: true
};
