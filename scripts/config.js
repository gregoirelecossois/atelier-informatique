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
  api: '',

  /* Nom affiché dans l'écran de connexion (juste cosmétique). */
  etablissement: '',

  /* true  → un élève non connecté voit un avertissement bien visible.
     false → l'avertissement reste discret (utile en démo ou en classe sans comptes). */
  insisterConnexion: true
};
