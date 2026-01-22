# Troubleshooting Guide

## HTML Instead of JSON Error

If you're getting "API returned HTML instead of JSON", check:

### 1. Backend Server is Running
```bash
cd backend2
npm run dev
```
Should see: `Server running on port 3000`

### 2. ngrok is Pointing to Port 3000
```bash
ngrok http 3000
```
NOT port 8000! Check ngrok dashboard at `http://127.0.0.1:4040` to verify.

### 3. Extension Config is Correct
In `extension/config.js`, make sure:
```javascript
API_BASE_URL: 'https://your-ngrok-url.ngrok-free.dev',
```

### 4. ngrok Skip Header is Being Sent
The extension automatically adds:
- Header: `ngrok-skip-browser-warning: true`
- Query param: `?ngrok-skip-browser-warning=true`

Check browser console (F12) → Network tab → See if header is present.

### 5. CORS is Configured
Backend should allow ngrok origins. Check `backend2/src/server.ts` CORS config.

## Quick Test

1. Test backend directly:
   ```bash
   curl http://localhost:3000/api/test
   ```

2. Test through ngrok:
   ```bash
   curl https://your-ngrok-url.ngrok-free.dev/api/test
   ```

3. Check ngrok dashboard:
   - Visit: `http://127.0.0.1:4040`
   - See if requests are coming through

## Common Issues

### Issue: ngrok shows warning page
**Solution**: Make sure `ngrok-skip-browser-warning` header is being sent. Check browser console Network tab.

### Issue: CORS errors
**Solution**: Backend CORS config needs to allow ngrok domain. Check `backend2/src/server.ts`.

### Issue: 404 Not Found
**Solution**: 
- Backend not running
- Wrong port (should be 3000, not 8000)
- Wrong endpoint path

### Issue: 500 Server Error
**Solution**: Check backend terminal for error messages. Common causes:
- Database connection issues
- Missing environment variables
- Service errors (OpenAI, Cloudinary)
