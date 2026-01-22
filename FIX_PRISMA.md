# Fix Prisma Client Error

## Problem
The error "Unknown argument `qualityScore`" means the Prisma client wasn't regenerated after adding new fields to the schema.

## Solution

### Step 1: Stop Your Node.js Server
Press `Ctrl+C` in the terminal where `npm run dev` is running.

### Step 2: Regenerate Prisma Client
```powershell
cd C:\laragon\www\others\resume-builder\backend2
npx prisma generate
```

If you get a file lock error, try:
```powershell
# Kill any Node processes
taskkill /F /IM node.exe

# Then regenerate
npx prisma generate
```

### Step 3: Restart Server
```powershell
npm run dev
```

## Verify It Worked
After regenerating, the error should be gone. The Prisma client will now recognize:
- `qualityScore` field
- `similarityMetrics` field

## Alternative: Manual Fix
If `prisma generate` keeps failing due to file locks:

1. Close ALL terminals and VS Code/IDE
2. Open a NEW terminal
3. Run: `cd C:\laragon\www\others\resume-builder\backend2`
4. Run: `npx prisma generate`
5. Restart your IDE and server
