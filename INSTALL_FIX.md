# Installation Fix Guide

## Issue: SSL Error When Installing Puppeteer

The installation failed because Puppeteer couldn't download Chromium due to an SSL error.

## Solution Options

### Option 1: Install Chromium Manually (Recommended)

1. **Download Chromium manually:**
   - Go to: https://download-chromium.appspot.com/
   - Download the latest Windows build
   - Extract it to: `backend2/node_modules/puppeteer/.local-chromium/`

2. **Or use a different network:**
   - Try using a VPN or different network
   - The SSL error might be due to network/firewall issues

### Option 2: Use System Chrome (If Installed)

If you have Chrome installed on your system, you can configure Puppeteer to use it:

1. Add to your `.env` file:
   ```
   PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
   ```

2. Update `document.service.ts` to use system Chrome if available.

### Option 3: Skip PDF Generation for Now

You can temporarily disable PDF generation and only use DOCX:

1. The installation completed successfully (packages are installed)
2. PDF generation will fail, but DOCX will work
3. You can add PDF support later when the SSL issue is resolved

### Option 4: Use Alternative PDF Library

We can switch to a different PDF library that doesn't require Chromium:
- `pdfkit` - Pure JavaScript PDF generation
- `pdfmake` - Another option

## Current Status

✅ **All packages installed successfully** (except Chromium)
✅ **DOCX generation will work**
❌ **PDF generation will fail** until Chromium is available

## Test Installation

Run this to verify:
```bash
cd backend2
npm run dev
```

The server should start, but PDF generation endpoints will fail until Chromium is available.
