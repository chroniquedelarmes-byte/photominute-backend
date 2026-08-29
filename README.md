# Photo Minute — Backend

API qui reçoit une photo, supprime le fond (via Replicate), et la recadre au format
CNI/Passeport (4×4cm) ou Concours (4×6cm), prête à imprimer à 300 DPI.

## Installation locale

```bash
npm install
cp .env.example .env
# Colle ta clé Replicate dans .env (REPLICATE_API_TOKEN=r8_...)
npm run dev
```

Le serveur tourne sur `http://localhost:3000`.

## Déployer sur Render (gratuit)

1. Pousse ce dossier sur un dépôt GitHub (voir plus bas)
2. Va sur https://render.com → connecte-toi avec GitHub
3. Clique "New" → "Web Service" → choisis ton dépôt
4. Configure :
   - **Build command** : `npm install`
   - **Start command** : `npm start`
5. Dans l'onglet "Environment", ajoute la variable :
   - `REPLICATE_API_TOKEN` = ta clé Replicate (`r8_...`)
6. Clique "Create Web Service" — Render te donne une URL du type
   `https://photo-minute-xxxx.onrender.com`

⚠️ Sur le plan gratuit de Render, le serveur s'endort après 15 min d'inactivité.
Le premier appel après une pause peut prendre 30-50 secondes le temps qu'il redémarre.

## Pousser sur GitHub

```bash
git init
git add .
git commit -m "Premier commit backend Photo Minute"
git branch -M main
git remote add origin https://github.com/TON-USERNAME/photo-minute.git
git push -u origin main
```

## Vérifier le modèle Replicate

Avant le premier lancement, vérifie que l'ID de version du modèle dans `index.js`
(`BG_REMOVER_MODEL`) est bien à jour sur :
https://replicate.com/851-labs/background-remover → onglet "API"

## Structure

- `index.js` — serveur Express + endpoint `/api/process-photo`
- `formats.js` — dimensions des formats de photo (px à 300 DPI)
- `.env` — ta clé API (ne jamais pousser sur GitHub, déjà dans .gitignore)
