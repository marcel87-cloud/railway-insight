# Deploying UCU Lost & Found on Railway

One Railway service runs everything: Express serves the API (`/api`) and the built React site.
A second Railway service (MySQL) holds the data.

## 1. Push to GitHub
The repo root must contain `package.json`, `backend/` and `frontend/`.

## 2. Add MySQL (you already have this)
Project canvas > + New > Database > MySQL. Keep it named `MySQL`.

## 3. Add the app
+ New > GitHub Repo > pick the repo. Railway builds it with `npm run build` and starts it with `npm start`.

## 4. Variables (app service > Variables > Raw Editor, paste, Save)
```
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
JWT_SECRET=<a long random string you invent>
NODE_ENV=production
UPLOAD_DIR=/data/uploads
ADMIN_NAME=Your Name
ADMIN_EMAIL=you@ucu.ac.ug
ADMIN_PASSWORD=<at least 12 characters>
```
If your database service is not called `MySQL`, replace that word in the references.
The app talks to the database over Railway's private network, so no public database access is needed.

## 5. Photos survive redeploys only with a Volume
App service > right-click / Settings > Volumes > Add Volume, mount path `/data`.

## 6. Public URL
App service > Settings > Networking > Generate Domain. Open it and log in with ADMIN_EMAIL / ADMIN_PASSWORD
(the admin account is created automatically on startup).
