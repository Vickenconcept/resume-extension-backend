# Fixing CORS for Vercel Admin Dashboard

## Problem
CORS error when accessing backend from `https://resume.phanrise.com`

## Solution

### Step 1: Verify Code is Updated

The code in `backend2/src/server.ts` should include:
```typescript
'https://resume.phanrise.com', // Vercel custom domain
```

### Step 2: Deploy to Server

SSH into your Laravel Forge server:

```bash
cd /home/forge/onpagecv.on-forge.com/current

# Pull latest code
git pull  # or upload the updated files

# Build TypeScript
npm run build

# Verify the build succeeded
ls -la dist/server.js
```

### Step 3: Check PM2 Configuration

Verify PM2 is pointing to the CURRENT release, not an old one:

```bash
pm2 show onpagecv-express
```

Check the `script path` - it should be:
```
/home/forge/onpagecv.on-forge.com/current/dist/server.js
```

If it's pointing to `/releases/63074939/`, you need to update it:

```bash
# Stop old process
pm2 delete onpagecv-express

# Start with current release
cd /home/forge/onpagecv.on-forge.com/current
pm2 start dist/server.js --name "onpagecv-express"
pm2 save
```

### Step 4: Restart PM2

```bash
pm2 restart onpagecv-express --update-env
```

### Step 5: Verify CORS is Working

Check logs for CORS-related errors:

```bash
pm2 logs onpagecv-express --lines 50 | grep -i cors
```

Or test the endpoint:

```bash
curl -H "Origin: https://resume.phanrise.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type,Authorization" \
     -X OPTIONS \
     https://onpagecv.on-forge.com/api/admin/login \
     -v
```

You should see `Access-Control-Allow-Origin: https://resume.phanrise.com` in the response headers.

## Current CORS Configuration

The backend allows these origins:
- `https://resume.phanrise.com` (your Vercel domain)
- `https://*.vercel.app` (all Vercel deployments)
- `https://onpagecv.on-forge.com` (production backend)
- Chrome extensions
- Localhost (development)

## Troubleshooting

### Still Getting CORS Error?

1. **Check if code is deployed**: Verify `dist/server.js` has the latest code
2. **Check PM2 path**: Make sure PM2 is using the current release
3. **Check server logs**: Look for CORS-related errors
4. **Test with curl**: Use the curl command above to test CORS headers
5. **Clear browser cache**: Sometimes browsers cache CORS responses

### Port Already in Use Error

If you see `EADDRINUSE` errors:
```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process if needed
sudo kill -9 <PID>

# Or restart PM2
pm2 restart onpagecv-express
```
