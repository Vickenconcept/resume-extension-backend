# Forgot Password – Production 404 Fix

If `POST /api/forgot-password` returns **404** on production, the running app doesn’t have the new route. Follow these steps on the server.

## 1. Confirm you’re in the right app directory

```bash
cd /home/forge/onpagecv.on-forge.com/current
```

(If you use Envoyer/releases, `current` is a symlink to the active release; make sure the latest release has the code that includes `forgot-password`.)

## 2. Make sure latest code is there

```bash
git fetch origin
git log -1 --oneline
# Optional: git pull origin main   # or your deploy branch
```

Ensure the latest commit includes the forgot-password changes (e.g. “Add forgot password and reset password”).

## 3. Check that source has the route

```bash
grep -n "forgot-password" src/routes/index.ts
```

You should see at least:

- `router.post('/forgot-password', ...`
- `router.get('/forgot-password', ...`   (verification route)

If nothing appears, the code on the server is old. Pull/deploy the correct branch and repeat.

## 4. Rebuild and restart

```bash
npm install
npm run build
```

Then check that the built file contains the route:

```bash
grep "forgot-password" dist/routes/index.js
```

You should see the string `forgot-password` in the output. If not, the build is wrong or the source wasn’t updated.

Restart the app:

```bash
pm2 restart onpagecv-express
# or: pm2 restart all
pm2 save
```

## 5. Test from the server

```bash
# GET (verification) – should return JSON
curl -s https://onpagecv.on-forge.com/api/forgot-password

# POST (real flow) – should return JSON, not 404
curl -s -X POST https://onpagecv.on-forge.com/api/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

- If **GET** returns something like `{"ok":true,"message":"Use POST with body..."}` → new code is live.
- If **POST** returns JSON (e.g. “If that email is registered…”) → forgot-password is working.
- If either returns **404** → app wasn’t rebuilt/restarted correctly or request isn’t reaching this Node app (e.g. nginx/proxy).

## 6. If you still get 404

- Confirm the process PM2 runs is the one you just rebuilt:
  - `pm2 show onpagecv-express` and check the script path (e.g. `dist/server.js` under `current`).
- Confirm nginx (or any reverse proxy) forwards `/api` to the Node app and doesn’t block or rewrite `/api/forgot-password`.
- Check logs: `pm2 logs onpagecv-express --lines 50` and look for errors on startup or when you send the request.

## 7. After it works

You can remove the GET verification route from `src/routes/index.ts` (the block that returns `Use POST with body...`) if you don’t want it in production.

---

## 8. Table `password_reset_tokens` does not exist

If you see:

```text
The table `password_reset_tokens` does not exist in the current database.
```

the migration for the new table was not run on production. Do one of the following.

### Option A: Run Prisma migrate (recommended)

From the app directory on the server (e.g. `current` or the active release):

```bash
cd /home/forge/onpagecv.on-forge.com/current
npx prisma migrate deploy
```

This applies pending migrations (including `20260227000000_add_password_reset_tokens`) and creates `password_reset_tokens`. Then restart the app:

```bash
pm2 restart onpagecv-express
pm2 save
```

### Option B: Create the table manually (MySQL)

If you prefer not to use migrations, run this SQL on the **production** database (same DB as `DATABASE_URL`):

```sql
CREATE TABLE `password_reset_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_token_key`(`token`),
    INDEX `password_reset_tokens_user_id_idx`(`user_id`),
    INDEX `password_reset_tokens_token_idx`(`token`),
    INDEX `password_reset_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

Then restart the app:

```bash
pm2 restart onpagecv-express
pm2 save
```

After that, “Forgot password” should work.
