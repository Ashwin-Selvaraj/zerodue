# Deploying ZeroDue

One small server runs everything: Postgres, the API, the web app and Caddy (which gets HTTPS certificates by itself). A VPS with 1 GB of memory is enough for one person.

> The images are built by CI on every push, but this exact stack has not been started end to end by the author yet. Expect to read a log or two the first time.

## 1. Before you start

- A server with Docker and the Compose plugin, ports 80 and 443 open, nothing else public.
- A domain with two DNS **A records** pointing at the server: one for the app (`app.example.com`) and one for the API (`api.example.com`). Keep them under one domain so the sign-in cookie stays same-site.

## 2. Set it up

```bash
git clone https://github.com/Ashwin-Selvaraj/zerodue.git
cd zerodue/deploy
cp .env.example .env
```

Edit `.env`:

| Setting                                   | What to put                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `WEB_DOMAIN`, `API_DOMAIN`                | your two names                                                                             |
| `POSTGRES_PASSWORD`                       | `openssl rand -base64 32`                                                                  |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different values from `openssl rand -base64 48`; the API refuses placeholders          |
| `VAPID_*` (optional)                      | `npx web-push generate-vapid-keys`; without them reminders show in the app but not as push |

Then start it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps        # everything should be "running" / "healthy"
curl https://api.example.com/health                 # {"service":"ZeroDue API","status":"ok"}
```

The API applies database migrations every time it starts.

## 3. First use

1. Open `https://app.example.com`, create your account.
2. Set `ALLOW_SIGNUP=false` in `.env` and run the `up -d` command again, so nobody else can register.
3. In the app, install it (browser menu → Install, or Add to Home Screen on iPhone). Notifications need this on iPhone.

## 4. Back up the database

The app has an encrypted backup (**More → Your data**). Keep that too, but also copy the database off the server regularly. A nightly dump:

```bash
# crontab -e
15 2 * * * cd /path/to/zerodue/deploy && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U zerodue zerodue | gzip > /var/backups/zerodue-$(date +\%F).sql.gz
```

Copy those files somewhere that is not this server. To restore into an empty database:

```bash
gunzip -c zerodue-2026-11-05.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U zerodue zerodue
```

Try a restore once before you need it.

## 5. Update

```bash
cd zerodue && git pull
cd deploy && docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Migrations run on start. Take a dump first if the update touches the database (check the commit messages for `prisma`).

## 6. The Android app

Every push builds an APK in GitHub Actions (**Actions → the latest run → Artifacts**).

- `zerodue-debug-apk` is for trying things. It also allows plain `http`, so it can talk to a server on your home network.
- `zerodue-release-apk` appears once you add the signing secrets below. It only talks to `https`, so use it with the deployment above.

Install either by copying the file to the phone and allowing installs from that source. In the app: **More → Phone capture** on the web gives a code; type the API address (`https://api.example.com`) and the code into the phone.

### Signing the release APK with your own key

Do this once and keep the key forever: Android will not update an app that was signed with a different key.

```bash
keytool -genkeypair -v -keystore zerodue-release.keystore -alias zerodue \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -i zerodue-release.keystore | pbcopy   # macOS; on Linux: base64 -w0 zerodue-release.keystore
```

In the GitHub repository, **Settings → Secrets and variables → Actions**, add:

| Secret                      | Value                           |
| --------------------------- | ------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | the base64 text you just copied |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS`         | `zerodue`                       |
| `ANDROID_KEY_PASSWORD`      | the key password you chose      |

Store the keystore file and both passwords in your password manager. Then re-run the workflow. Anyone with read access to a public repository can download its artifacts, but the APK holds no secrets: your server address and data only go in after you pair.

## Notes

- **One API instance.** The reminder and due-date jobs run inside the API. If you ever run a second instance, set `SCHEDULER=false` on it.
- **Reverse proxy.** `TRUST_PROXY=true` is already set in the compose file, which tells the API to read the client address from Caddy. Leave it off if you put the API directly on the internet.
- **Logs.** `docker compose -f docker-compose.prod.yml logs -f api`. The API's own log lines carry no amounts or message text.
