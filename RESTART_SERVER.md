# Restart Server to Load Paystack Keys

## Important: Restart Required

After adding Paystack keys to `.env`, you **must restart the backend server** for the changes to take effect.

## Steps:

1. **Stop the current server** (if running):
   - Press `Ctrl+C` in the terminal where the server is running

2. **Restart the server**:
   ```bash
   cd backend2
   npm run dev
   ```

3. **Verify keys are loaded**:
   - Check the server logs when it starts
   - You should see: "Paystack keys loaded successfully"
   - If you see warnings about keys not configured, check your `.env` file

## Troubleshooting:

If you still get the "Format is Authorization Bearer [secret key]" error after restarting:

1. **Check .env file location**: Make sure `.env` is in the `backend2` folder (same folder as `package.json`)

2. **Check .env format**: Make sure there are no quotes around the values:
   ```env
   # ✅ Correct
   PAYSTACK_SECRET_KEY=sk_test_f72d8b88ae87955c652bac08a978be1206c02442
   
   # ❌ Wrong (don't use quotes)
   PAYSTACK_SECRET_KEY="sk_test_f72d8b88ae87955c652bac08a978be1206c02442"
   ```

3. **Check for extra spaces**: The keys should not have leading/trailing spaces

4. **Verify dotenv is loading**: Check that `dotenv.config()` is called in `server.ts` (it should be at the top)

5. **Check server logs**: Look for any errors about environment variables
