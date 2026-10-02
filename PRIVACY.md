# Politique de confidentialité — Course Downloader for Moodle™

*Dernière mise à jour : 2 octobre 2026*

**En bref : l'extension ne collecte, ne stocke sur un serveur, ni ne transmet aucune donnée personnelle.
Tout se passe sur ton ordinateur, entre ton navigateur et ton site Moodle.**

## Ce que fait l'extension
- Quand tu cliques sur son icône sur une page Moodle, elle lit la page et interroge **ton** site Moodle
  avec **ta** session déjà ouverte, pour lister tes cours et leurs fichiers.
- Elle télécharge ces fichiers dans le dossier que tu choisis (ou dans Téléchargements).

## Données stockées localement (sur ton ordinateur uniquement)
- Tes préférences (types de fichiers, options, sous-dossier).
- Un historique des fichiers déjà téléchargés (adresse du fichier, chemin local, version), pour ne
  re-télécharger que ce qui a changé.
- La référence au dossier de destination choisi.

Ces données restent dans le stockage local du navigateur. Le bouton « Vider l'historique » les efface ;
désinstaller l'extension supprime tout.

## Ce que l'extension ne fait pas
- Aucune donnée n'est envoyée au développeur ni à un tiers ; il n'y a aucun serveur.
- Pas de statistiques, de traçage, de publicité, ni de code chargé à distance.
- Tes identifiants ne sont jamais lus ni enregistrés : l'extension utilise la session Moodle déjà ouverte
  dans ton navigateur.
- L'accès à un site n'est demandé que pour le Moodle que tu synchronises, au moment où tu lances la synchro.

## Permissions
| Permission | Pourquoi |
|---|---|
| `activeTab`, `scripting` | Lire la page Moodle ouverte quand tu cliques sur l'icône. |
| `downloads` | Mode « Téléchargements Chrome ». |
| `storage` | Préférences et historique local. |
| `notifications` | Notification de fin de synchro. |
| Accès au site (optionnel, demandé à la volée) | Télécharger les fichiers de ton Moodle depuis l'onglet de synchro. |

## Contact
Questions : ouvrir une issue sur https://github.com/GrosBiceps/Moodle-scrapper/issues

*Moodle™ est une marque déposée de Moodle Pty Ltd. Ce projet n'est ni affilié à Moodle Pty Ltd ni approuvé par elle.*
