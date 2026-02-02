# Puppeteer/Chromium Setup for Production (Laravel Forge)

## Problem
PDF downloads fail or produce corrupted files because Chromium is not properly installed on the server.

## Solution: Install Chromium and System Dependencies

### Step 1: Install System Dependencies

SSH into your Laravel Forge server and run:

```bash
# Update package list
sudo apt-get update

# Install Chromium and required dependencies
sudo apt-get install -y \
  chromium-browser \
  chromium-chromedriver \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils
```

### Step 2: Set Environment Variable

In Laravel Forge:
1. Go to your site → **Environment**
2. Add this environment variable:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Or if `chromium-browser` is not found, try:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Step 3: Verify Chromium Installation

SSH into your server and check:

```bash
# Check if Chromium is installed
which chromium-browser
# or
which chromium

# Check version
chromium-browser --version
# or
chromium --version
```

### Step 4: Alternative - Use Puppeteer's Bundled Chromium

If system Chromium doesn't work, you can force Puppeteer to download its own Chromium:

```bash
cd /home/forge/onpagecv.on-forge.com/current

# Install Puppeteer with Chromium
npm install puppeteer --save

# This will download Chromium to node_modules/puppeteer/.local-chromium/
```

Then update your `.env` file to skip the executable path (let Puppeteer use its bundled Chromium):

```bash
# Remove or comment out PUPPETEER_EXECUTABLE_PATH
# PUPPETEER_EXECUTABLE_PATH=
```

### Step 5: Update Puppeteer Launch Options

The code already includes `--no-sandbox` and `--disable-setuid-sandbox` flags which are required for running Chromium as root or in containers.

If you still have issues, you may need to add more flags. Check `backend2/src/services/document.service.ts` line 856:

```typescript
args: ['--no-sandbox', '--disable-setuid-sandbox'],
```

You can add more flags if needed:
```typescript
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
],
```

### Step 6: Restart Your Application

After making changes:

```bash
cd /home/forge/onpagecv.on-forge.com/current

# Restart PM2
pm2 restart resume-builder-backend
```

### Step 7: Test PDF Generation

Test by generating a PDF through your extension. Check the logs:

```bash
# View PM2 logs
pm2 logs resume-builder-backend

# Or check application logs
tail -f /path/to/your/logs/app.log
```

## Troubleshooting

### Issue: "Chromium is not installed" error

**Solution:**
1. Verify Chromium is installed: `which chromium-browser`
2. Check the path in `PUPPETEER_EXECUTABLE_PATH` environment variable
3. Make sure the path is correct and the file is executable

### Issue: PDF downloads but is corrupted/can't open

**Possible causes:**
1. **Missing fonts** - Install fonts:
   ```bash
   sudo apt-get install -y fonts-liberation fonts-noto-color-emoji
   ```

2. **Incomplete PDF generation** - Check server logs for errors during PDF generation

3. **Content-Type header issue** - Verify the response headers include:
   ```
   Content-Type: application/pdf
   ```

4. **Buffer corruption** - Check if the PDF buffer is being properly converted

### Issue: "Failed to launch browser" error

**Solution:**
1. Add more launch flags (see Step 5)
2. Check file permissions on Chromium executable:
   ```bash
   ls -la /usr/bin/chromium-browser
   chmod +x /usr/bin/chromium-browser  # if needed
   ```

3. Try using Puppeteer's bundled Chromium instead (Step 4)

### Issue: Timeout during PDF generation

**Solution:**
1. Increase timeout in Puppeteer launch options
2. Check server resources (memory, CPU)
3. Verify network connectivity

## Quick Test Command

Test Chromium directly:

```bash
chromium-browser --headless --disable-gpu --print-to-pdf=/tmp/test.pdf --virtual-time-budget=5000 https://example.com
```

If this works, Chromium is properly installed.

## Recommended Setup for Laravel Forge

For Laravel Forge servers, I recommend:

1. **Use system Chromium** (Step 1) - More reliable
2. **Set PUPPETEER_EXECUTABLE_PATH** (Step 2) - Points to system Chromium
3. **Install all dependencies** (Step 1) - Prevents missing library errors

This setup is more stable and uses less disk space than Puppeteer's bundled Chromium.
