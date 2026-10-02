# Fiche Chrome Web Store — à copier dans le tableau de bord développeur

## Infos produit
- **Nom** : Course Downloader for Moodle™
- **Catégorie** : Éducation (ou Outils)
- **Langue** : Français (ajouter l'anglais avec la description EN ci-dessous)
- **Paquet** : `dist/course-downloader-<version>.zip` (généré par `node scripts/build.js`)
- **Icône** : `extension/icons/icon128.png`
- **Captures 1280×800** : `store/screenshots/*.png` (générées par `node test/screenshots.js`)
- **Site** : https://github.com/GrosBiceps/Moodle-scrapper
- **Politique de confidentialité** : https://github.com/GrosBiceps/Moodle-scrapper/blob/main/PRIVACY.md

## Résumé (≤ 132 caractères)
Télécharge et synchronise les fichiers de tes cours Moodle dans le dossier de ton choix. Sync incrémentale, index hors-ligne.

## Description (FR)
Récupère en un clic tous les supports de tes cours Moodle et garde-les à jour dans le dossier de ton choix
(y compris un dossier Google Drive pour ordinateur).

• Fonctionne avec n'importe quel Moodle (université, école, entreprise), y compris avec connexion SSO/CAS.
• Choisis tes cours : filtres En cours / Passés, recherche, « ce cours ».
• Récupère fichiers, dossiers (avec sous-dossiers), pages et livres en HTML, consignes et fichiers de devoirs.
• Synchronisation incrémentale : seuls les fichiers nouveaux ou modifiés sont téléchargés ; un journal
  « Nouveautés » liste ce qui a changé.
• Un index.html par cours pour naviguer hors-ligne dans le plan du cours.
• Écriture directe dans un dossier : aucune fenêtre « Enregistrer sous » pour chaque fichier.
• Pause, reprise, annulation, nouvel essai des échecs, filtres par type de fichier.

Respect de la vie privée : aucune donnée collectée, aucun serveur. L'extension utilise ta session Moodle
déjà ouverte et n'accède qu'au site que tu synchronises.

Usage personnel : l'extension ne télécharge que ce à quoi tu as déjà accès. Les supports de cours restent
la propriété de leurs auteurs — ne les redistribue pas.

Moodle™ est une marque déposée de Moodle Pty Ltd. Extension indépendante, non affiliée à Moodle Pty Ltd.

## Description (EN)
Download all your Moodle course materials in one click and keep them in sync in a folder of your choice
(Google Drive for desktop folders work too).

• Works with any Moodle site (universities, schools, companies), including SSO/CAS logins.
• Pick your courses: in progress / past filters, search, "this course".
• Gets files, folders (with subfolders), pages and books as HTML, assignment instructions and files.
• Incremental sync: only new or changed files are downloaded; a "What's new" log lists changes.
• An offline index.html per course.
• Writes straight into a folder: no "Save as" dialog for every file.
• Pause, resume, cancel, retry failures, file-type filters.

Privacy: no data collection, no server. Uses your existing Moodle session and only accesses the site you sync.
Personal use only: course materials belong to their authors — do not redistribute them.

Moodle™ is a registered trademark of Moodle Pty Ltd. Independent extension, not affiliated with Moodle Pty Ltd.

## Onglet « Pratiques de confidentialité »
- **Objectif unique** : Télécharger et synchroniser localement les fichiers des cours Moodle auxquels
  l'utilisateur a accès.
- **Justification des permissions** :
  - `activeTab` : lire la page Moodle active quand l'utilisateur clique sur l'icône, pour détecter le site et lister ses cours.
  - `scripting` : injecter le script de lecture des cours dans l'onglet Moodle actif, uniquement après un clic de l'utilisateur.
  - `downloads` : mode optionnel « Téléchargements Chrome » qui enregistre les fichiers via le gestionnaire de téléchargements.
  - `storage` : préférences de l'utilisateur et historique local des fichiers déjà téléchargés (sync incrémentale).
  - `notifications` : prévenir de la fin d'une synchronisation.
  - Autorisations d'hôte optionnelles (`*://*/*`) : chaque établissement héberge Moodle sur son propre domaine ;
    l'accès est demandé à la volée, uniquement pour le site Moodle que l'utilisateur synchronise, afin de
    télécharger les fichiers avec sa session.
- **Code distant** : Non, aucun code distant.
- **Données collectées** : aucune. Cocher les certifications : pas de vente de données, pas d'usage hors objectif
  unique, pas d'usage pour la solvabilité/prêts.
