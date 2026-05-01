# Rocket League Win/Lose Overlay

Overlay OBS Win/Lose compatible EAC via la Stats API officielle de Rocket League. Il ne hook pas le jeu et n'utilise pas BakkesMod. Le MMR optionnel vient de Tracker.gg.

## Installation

```bash
cd /root/rocket-league-winlose-overlay
npm install
npm start
```

Verification rapide du code :

```bash
npm test
```

Pages locales :

- Overlay : `http://localhost:5177/overlay.html`
- Dashboard : `http://localhost:5177/control.html`

Sur Windows, lance simplement `START-WINDOWS.bat`.

L'overlay est fait pour OBS en Browser Source. Un overlay externe visible au-dessus du plein ecran exclusif demanderait un hook/injection dans le rendu du jeu, donc ce n'est pas le bon chemin avec EAC.

## Rocket League

Avant de lancer le jeu, edite :

```txt
<Install Dir>\TAGame\Config\DefaultStatsAPI.ini
```

Mets par exemple :

```ini
PacketSendRate=30
Port=49123
```

Redemarre Rocket League apres modification.

## Dashboard

Ouvre `http://localhost:5177/control.html`. En usage normal tu n'as rien a regler : lance l'app, ajoute le lien OBS, puis joue. L'ecran principal sert seulement a surveiller :

- statut de connexion, joueur detecte, equipe, score, mode MMR et MMR Tracker ;
- compteur de session ;
- historique session ;
- logs de diagnostic.

Tout le reste est replie dans `Depannage manuel` : pseudo force, equipe de secours, URL Stats API, mode MMR force, correction `+ WIN` / `+ LOSE`, reset et tests. L'URL Stats API par defaut est `tcp://127.0.0.1:49123`. Les anciennes valeurs `ws://127.0.0.1:49123` sont migrees vers TCP au chargement.

L'app detecte ton equipe dans les paquets `UpdateState`, puis au `MatchEnded` compare ton `TeamNum` avec `WinnerTeamNum`. Si Rocket League envoie seulement `MatchDestroyed` apres un abandon/FF, l'app deduit aussi le resultat depuis le dernier score connu quand le match a un `MatchGuid`.

## MMR Tracker

Le MMR n'est pas fourni par la Stats API officielle. L'app utilise donc Tracker.gg avec le `PrimaryId` du joueur vu dans la Stats API.

Detection du mode :

- si Rocket League envoie un champ playlist/mode non documente, l'app l'utilise ;
- sinon l'app deduit 1v1/2v2/3v3 depuis le nombre de joueurs ;
- ranked vs casual n'est pas fiable si Rocket League ne l'envoie pas ;
- si l'auto se trompe, force le mode dans `Depannage manuel`.

Tracker peut avoir du delai, renvoyer `403`, ou ne pas trouver certains profils.

## Logs

Le panneau de controle affiche les logs en direct. Les messages importants :

- `ECONNREFUSED 127.0.0.1:49123` : Rocket League ne fournit pas encore la Stats API. Lance le jeu avec `PacketSendRate` actif, ou verifie le port.
- `Match state` : la connexion Stats API marche et un etat de match est arrive.
- `Score update` : les scores Blue/Orange sont lus correctement.
- `Joueur detecte` : le pseudo ou `PrimaryId` correspond bien.
- `Mode MMR detecte` : le mode utilise pour choisir le MMR Tracker.
- `MMR Tracker recu` : le MMR a ete lu depuis Tracker.
- `Aucun joueur ne correspond` : le pseudo configure ne matche pas les joueurs vus par l'API.
- `MatchEnded recu` : la fin de match est bien detectee.
- `Resultat deduit sur MatchDestroyed` : Rocket League n'a pas envoye `MatchEnded`, donc l'app compte le resultat depuis le score final connu.

Le fichier complet est aussi dans `data/overlay.log`.

## Diagnostic Windows

Lance `DIAG-WINDOWS.bat` si le panneau reste en `connecting` ou `disconnected`.

Le point cle :

- `OK 127.0.0.1:49123 ouvert` : Rocket League ecoute, l'overlay doit pouvoir se connecter.
- `RIEN n'ecoute sur 49123` ou `ECHEC 127.0.0.1:49123` : Rocket League n'a pas charge la Stats API. Verifie le bon fichier `DefaultStatsAPI.ini`, sauvegarde avec les droits admin si le jeu est dans `Program Files`, puis redemarre completement le jeu.

Le panneau a aussi un bouton `Test connexion`. Il ecrit dans les logs :

- test TCP simple vers `49123`
- test lecture TCP pendant quelques secondes

## Si Rocket League envoie des donnees vides

Si les logs affichent `Match state {"players":0,"teams":0}` puis `MatchEnded` sans `WinnerTeamNum`, l'API officielle est connectee mais ne donne pas assez d'information pour calculer automatiquement le resultat. Dans ce cas :

- choisis `Bleu` ou `Orange` dans `Equipe si auto echoue` pour garder ton equipe en memoire ;
- utilise `+ WIN` ou `+ LOSE` en fin de match si `WinnerTeamNum` reste absent.

Les boutons de test d'animation servent seulement a verifier l'overlay.

Si tu FF a `0-0` et que Rocket League n'envoie pas `MatchEnded`, l'app ne peut pas savoir le gagnant avec certitude. Dans ce cas utilise `+ LOSE`.

## OBS

Ajoute une Browser Source :

```txt
http://localhost:5177/overlay.html
```

Largeur conseillee : `1920`, hauteur : `1080`. Pas besoin de CSS perso dans OBS.

Le rendu affiche une petite barre en haut a droite avec MMR, wins, losses et winstreak, puis un toast WIN/LOSE compact en fin de match. La barre utilise un asset SVG transparent dans `public/assets/rocketstats-strip.svg`, donc OBS n'a pas besoin de CSS perso.

Si OBS affiche encore un ancien fond, clique `Refresh cache of current page` dans les proprietes de la Browser Source.

Options :

- Cacher le petit HUD session : `http://localhost:5177/overlay.html?hud=0`
- Changer la duree d'animation : `http://localhost:5177/overlay.html?duration=9000`

## Structure

- `server.js` : point d'entree HTTP/API.
- `src/app-state.js` : configuration, session, detection joueur, calcul WIN/LOSE.
- `src/stats-client.js` : connexion Stats API TCP, diagnostics.
- `src/utils.js` : normalisation des payloads Rocket League.
- `public/control.html` : dashboard.
- `public/overlay.html` : overlay transparent OBS.
- `config.json` : cree automatiquement au premier lancement.
- `data/session.json` : compteur de session.
