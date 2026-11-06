# Suivi de commandes en temps réel

Dépôt Git : https://github.com/Nadiro11/tp-web-temps-reel

## Lancement avec Docker

Prérequis : Docker et Docker Compose, avec le moteur Docker démarré.

```sh
docker compose up --build -d
```

Ouvrir http://localhost:3000.

Pour suivre une commande existante, ouvrir par exemple
http://localhost:3000/?orderId=1 (après avoir créé cette commande via l'API).
Sans identifiant valide ou si la commande n'existe pas, la page affiche une erreur.
Elle charge initialement la commande et le nom du produit via REST, puis écoute
uniquement `/api/orders/:id/events` avec `EventSource`.
L'expédition, l'annulation et la livraison automatique actualisent l'affichage
sans rechargement ni nouvelle requête REST. La page indique l'état de connexion,
laisse le navigateur se reconnecter en cas de coupure et ferme le flux sur `pagehide`.

Le volume nommé `jsondb-data` est monté dans `/app/data` pour le stockage JsonDB.
Il est conservé après un arrêt ou une recréation du conteneur.
La base est enregistrée dans `data/db.json` (donc `/app/data/db.json` dans Docker).
Au premier lancement, elle contient deux utilisateurs, trois produits et aucune commande.
Les données existantes sont conservées aux lancements suivants.
La commande `docker compose down -v` supprime aussi ce volume.

Pour arrêter le projet en conservant le volume :

```sh
docker compose down
```

## Lancement local

Prérequis : Node.js 18 ou supérieur et npm.

```sh
npm ci
npm run build
npm start
```

## Routes disponibles

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/health` | HTTP 200, JSON `{"status":"ok"}` |
| GET | `/` | Page HTML statique du dossier `public` |
| GET | `/api/users` | 200 : liste des utilisateurs |
| GET | `/api/products` | 200 : liste des produits avec leur stock |
| GET | `/api/orders` | 200 : liste des commandes, y compris les commandes annulées |
| GET | `/api/orders/:id` | 200 : détail d'une commande |
| POST | `/api/orders` | 201 : commande créée et stock diminué |
| PATCH | `/api/orders/:id/ship` | 200 : commande expédiée |
| PATCH | `/api/orders/:id/cancel` | 200 : commande annulée et stock restitué |

`:id` désigne l'identifiant numérique d'une commande.
Les réponses REST sont en JSON. Les routes de modification renvoient la commande.

Pour créer une commande, envoyer un JSON avec l'en-tête `Content-Type: application/json` :

```json
{"userId": 1, "productId": 1, "quantity": 2}
```

Ces trois champs sont obligatoires et doivent être des nombres entiers positifs
(les chaînes numériques ne sont pas acceptées). Le serveur attribue un ID unique,
le statut `preparing` et une date `createdAt` au format ISO.

Seule une commande `preparing` peut être expédiée ou annulée. L'annulation
restitue le stock une seule fois et conserve la commande avec le statut `cancelled`.
Une commande expédiée passe automatiquement à `delivered` après 20 secondes,
sans appel supplémentaire du client. Les transitions inverses sont interdites.
Les délais sont gérés en mémoire : si le serveur est arrêté pendant l'attente,
la commande reste persistée en `shipped`, mais son délai n'est pas repris au redémarrage.

Les refus utilisent le format `{"error":"Message explicatif"}` :

- 400 : champ absent ou invalide, identifiant de commande invalide, JSON mal formé ;
- 404 : utilisateur, produit ou commande introuvable ;
- 409 : stock insuffisant ou transition de statut interdite ;
- 500 : erreur interne, notamment une erreur de stockage.

Vérification du serveur :

```sh
curl http://localhost:3000/health
```

## Flux SSE

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/api/events` | 200 : flux global des commandes et stocks |
| GET | `/api/orders/:id/events` | 200 : flux de cette commande uniquement ; 400 si ID invalide, 404 si absente |

Les connexions restent ouvertes avec le type `text/event-stream`.
Chaque message contient `id:`, `event:` et `data:` (JSON), suivi d'une ligne vide.
Les identifiants d'événements sont incrémentés en mémoire, sans historique ni rejeu.

| Événement | Données | Destinataires |
| --- | --- | --- |
| `order-created` | Commande créée complète | Flux global et flux de cette commande |
| `order-updated` | Commande complète après expédition, annulation ou livraison | Flux global et flux de cette commande |
| `stock-updated` | Produit complet avec son stock actualisé après création ou annulation | Flux global uniquement |

La diffusion intervient après la réussite de la sauvegarde JsonDB.
Le filtrage est effectué par le serveur. Les abonnés sont retirés à la déconnexion,
et les groupes de commandes sans abonnés sont supprimés.
Les flux restent ouverts après livraison ou annulation ; les bonus ne sont pas implémentés.

Pour observer les événements dans un terminal :

```sh
curl -N http://localhost:3000/api/events
curl -N http://localhost:3000/api/orders/1/events
```

La seconde commande suppose que la commande 1 existe. Depuis un autre terminal,
utiliser les routes REST de création, d'expédition et d'annulation pour produire les événements.
