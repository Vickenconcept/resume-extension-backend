# Deploy Fix for Downloads

## Problem
Downloads are failing because:
1. PM2 is still running old code from `/releases/63074939/`
2. The new code with fixes hasn't been deployed yet

## Solution: Deploy New Code

### Step 1: Check Current Release

SSH into your server:
```bash
cd /home/forge/onpagecv.on-forge.com/current
pwd
```

This should show the current release path (not `/releases/63074939/`).

### Step 2: Pull/Upload New Code

If using Git:
```bash
cd /home/forge/onpagecv.on-forge.com/current
git pull origin main  # or your branch name
```

If uploading manually, make sure all updated files are in the current directory.

### Step 3: Install Dependencies (if needed)

```bash
cd /home/forge/onpagecv.on-forge.com/current
npm install
```

### Step 4: Build TypeScript

```bash
npm run build
```

### Step 5: Check PM2 Configuration

Verify PM2 is pointing to the current release:
```bash
pm2 show onpagecv-express
```

Check the `script path` - it should point to `/home/forge/onpagecv.on-forge.com/current/dist/server.js`

If it's pointing to an old release, update it:
```bash
pm2 delete onpagecv-express
cd /home/forge/onpagecv.on-forge.com/current
pm2 start dist/server.js --name "onpagecv-express"
pm2 save
```

### Step 6: Restart PM2

```bash
pm2 restart onpagecv-express --update-env
```

The `--update-env` flag ensures environment variables are reloaded.

### Step 7: Verify New Code is Running

Check logs:
```bash
pm2 logs onpagecv-express --lines 50
```

You should see:
- No errors about old release paths
- "Using Puppeteer bundled Chromium" (if PUPPETEER_EXECUTABLE_PATH is not set)
- Server starting successfully

### Step 8: Test Downloads

Try downloading both DOCX and PDF from the extension. They should work now.

## Important Notes

1. **Remove PUPPETEER_EXECUTABLE_PATH** from environment variables if you want to use bundled Chromium
2. **Check PM2 script path** - it must point to the current release, not an old one
3. **Always run `npm run build`** after code changes to compile TypeScript
4. **Use `--update-env`** when restarting to reload environment variables

## Troubleshooting

### If downloads still fail:

1. Check if the response is binary or JSON:
   ```bash
   curl -I https://onpagecv.on-forge.com/api/download-tailored-resume \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"resumeId":"test","format":"pdf"}'
   ```

2. Check server logs for errors:
   ```bash
   pm2 logs onpagecv-express --err
   ```

3. Verify the build was successful:
   ```bash
   ls -la dist/server.js
   ```

4. Check if the new code is actually running:
   ```bash
   pm2 show onpagecv-express | grep "script path"
   ```
