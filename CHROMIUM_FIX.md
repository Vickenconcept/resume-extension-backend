# Chromium Fix for Production

## Problem
The server is trying to use snap-installed Chromium which has GPU wrapper issues:
```
Content snap command-chain for /snap/chromium/3352/gpu-2404/bin/gpu-2404-provider-wrapper not found
```

## Solution
Use Puppeteer's bundled Chromium instead of system Chromium.

## Steps to Fix

### 1. Remove PUPPETEER_EXECUTABLE_PATH (if set)

In Laravel Forge → Your Site → Environment, **remove or comment out**:
```bash
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

This will force Puppeteer to use its bundled Chromium.

### 2. Verify Puppeteer Has Bundled Chromium

SSH into your server and check:
```bash
cd /home/forge/onpagecv.on-forge.com/current
ls -la node_modules/puppeteer/.local-chromium/
```

If this directory exists and has Chromium, you're good.

### 3. Test Puppeteer

```bash
node -e "const p=require('puppeteer');(async()=>{const b=await p.launch({args:['--no-sandbox']});console.log(await b.version());await b.close();})();"
```

This should return a Chrome version (e.g., `Chrome/144.0.7559.96`).

### 4. Restart Application

```bash
cd /home/forge/onpagecv.on-forge.com/current
npm run build
pm2 restart onpagecv-express
```

### 5. Check Logs

```bash
pm2 logs onpagecv-express
```

You should see:
```
Using Puppeteer bundled Chromium (no PUPPETEER_EXECUTABLE_PATH set)
```

Instead of errors about snap Chromium.

## Why This Works

- Puppeteer's bundled Chromium is self-contained and doesn't rely on system packages
- No snap wrapper issues
- No missing dependencies
- More reliable in production environments

## Alternative: Fix Snap Chromium (Not Recommended)

If you must use system Chromium, you can try:

```bash
sudo snap connect chromium:gpu-2404
```

But using Puppeteer's bundled Chromium is the recommended solution.
