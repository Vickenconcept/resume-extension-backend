# ngrok Setup for Node.js Backend

## Problem
Your ngrok URL is pointing to Laravel backend (port 8000), but you're now using Node.js backend (port 3000).

## Solution: Update ngrok to Point to Port 3000

### Step 1: Stop Current ngrok Tunnel

If ngrok is running, stop it:
- Press `Ctrl+C` in the terminal where ngrok is running
- Or close the ngrok terminal window

### Step 2: Start ngrok for Node.js Backend

Open a new terminal and run:

```bash
ngrok http 3000
```

This will create a new tunnel pointing to your Node.js backend.

### Step 3: Update Extension Config

1. Copy the new ngrok URL (e.g., `https://new-id.ngrok-free.dev`)
2. Open `extension/config.js`
3. Update the `API_BASE_URL`:

```javascript
API_BASE_URL: 'https://your-new-ngrok-url.ngrok-free.dev',
```

4. Reload the extension in Chrome:
   - Go to `chrome://extensions/`
   - Click reload on your extension

## Alternative: Use Local Development

If you're testing locally, you can skip ngrok:

1. Update `extension/config.js`:
```javascript
API_BASE_URL: 'http://localhost:3000',
```

2. Make sure your Node.js server is running:
```bash
cd backend2
npm run dev
```

3. Reload the extension

## Quick Commands

### Start ngrok for Node.js:
```bash
ngrok http 3000
```

### Start Node.js server:
```bash
cd backend2
npm run dev
```

### Test API:
```bash
curl http://localhost:3000/api/test
```

## Verify Setup

1. **Check ngrok is pointing to port 3000:**
   - Visit ngrok web interface: `http://127.0.0.1:4040`
   - Check "Forwarding" shows: `https://xxx.ngrok-free.dev -> http://localhost:3000`

2. **Test ngrok URL:**
   - Visit: `https://your-ngrok-url.ngrok-free.dev/api/test`
   - Should return JSON, not HTML

3. **Test with extension:**
   - Reload extension
   - Try to register/login
   - Should work without HTML errors
