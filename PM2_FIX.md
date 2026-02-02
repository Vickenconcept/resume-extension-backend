# Fixing PM2 and Server Startup

## Current Issues

1. **TypeScript not installed**: `tsc: not found`
2. **PM2 pointing to wrong path**: `/releases/63077823/dist/server.js` doesn't exist
3. **Server not running**: 502 error

## Step-by-Step Fix

### Step 1: Install Dependencies (Including TypeScript)

```bash
cd /home/forge/onpagecv.on-forge.com/current

# Install ALL dependencies (including devDependencies for TypeScript)
npm install
```

**Important**: Don't use `npm install --production` - you need TypeScript to build!

### Step 2: Build TypeScript

```bash
npm run build
```

This should create `dist/server.js`.

### Step 3: Verify Build Succeeded

```bash
ls -la dist/server.js
```

If the file exists, you're good. If not, check the build errors.

### Step 4: Start PM2 with Correct Path

```bash
# Make sure you're in the current directory
cd /home/forge/onpagecv.on-forge.com/current

# Start PM2 with the correct path
pm2 start dist/server.js --name "onpagecv-express"

# Save PM2 configuration
pm2 save
```

### Step 5: Verify Server is Running

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs onpagecv-express --lines 20
```

You should see:
```
info: Server running on port 3000
```

### Step 6: Test CORS

```bash
curl -H "Origin: https://resume.phanrise.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type,Authorization" \
     -X OPTIONS \
     https://onpagecv.on-forge.com/api/admin/login \
     -v
```

You should see `Access-Control-Allow-Origin: https://resume.phanrise.com` in the response.

## Complete Command Sequence

```bash
cd /home/forge/onpagecv.on-forge.com/current

# Install dependencies
npm install

# Build
npm run build

# Verify build
ls -la dist/server.js

# Start PM2
pm2 start dist/server.js --name "onpagecv-express"
pm2 save

# Check status
pm2 status
pm2 logs onpagecv-express --lines 10
```

## Troubleshooting

### If `npm install` fails:
- Check disk space: `df -h`
- Check Node.js version: `node -v` (should be v18+)
- Check npm version: `npm -v`

### If build fails:
- Check for TypeScript errors: `npm run build`
- Make sure all files are present
- Check `tsconfig.json` exists

### If PM2 fails to start:
- Check if port 3000 is already in use: `sudo lsof -i :3000`
- Check file permissions: `ls -la dist/server.js`
- Check Node.js can run the file: `node dist/server.js`

### If 502 error persists:
- Check if server is actually running: `pm2 status`
- Check server logs: `pm2 logs onpagecv-express`
- Check if port 3000 is accessible: `curl http://localhost:3000/health`
