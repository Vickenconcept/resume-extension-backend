# Deployment Guide for Laravel Forge

## Database Setup

### 1. Create Database in Laravel Forge
1. Go to your server in Laravel Forge
2. Click "Databases" tab
3. Click "Create Database"
4. Enter database name (e.g., `resume_builder`)
5. Create a database user with a strong password
6. Note down the credentials

### 2. Set DATABASE_URL Environment Variable

In Laravel Forge → Your Site → Environment → Edit Environment Variables:

```bash
DATABASE_URL="mysql://username:password@127.0.0.1:3306/database_name?schema=public"
```

Example:
```bash
DATABASE_URL="mysql://forge:your_strong_password@127.0.0.1:3306/resume_builder?schema=public"
```

### 3. Complete .env File

Add all required environment variables in Laravel Forge:

```bash
# Database
DATABASE_URL="mysql://forge:password@127.0.0.1:3306/resume_builder?schema=public"

# JWT
JWT_SECRET="your-production-jwt-secret-key-here"
JWT_EXPIRES_IN="7d"

# Paystack (use LIVE keys for production)
PAYSTACK_PUBLIC_KEY="pk_live_..."
PAYSTACK_SECRET_KEY="sk_live_..."

# Cloudinary
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# OpenAI
OPENAI_API_KEY="sk-..."

# URLs
FRONTEND_URL="https://your-domain.com"
BACKEND_URL="https://api.your-domain.com"
PORT=3000
NODE_ENV=production
```

## Deployment Script for Laravel Forge

Add this to your Laravel Forge deployment script:

```bash
#!/bin/bash

cd /home/forge/your-site.com/backend2

# Install ALL dependencies (including devDependencies for TypeScript build)
npm install

# Generate Prisma Client
npx prisma generate

# Build TypeScript to JavaScript
npm run build

# Run database migrations (production-safe)
npx prisma migrate deploy

# Restart PM2 process
pm2 restart resume-builder-backend || pm2 start dist/server.js --name "resume-builder-backend"
```

## PM2 Setup

### Initial PM2 Start

```bash
cd /home/forge/your-site.com/backend2
pm2 start dist/server.js --name "resume-builder-backend"
```

### PM2 Ecosystem File (Optional but Recommended)

Create `ecosystem.config.js` in the backend2 folder:

```javascript
module.exports = {
  apps: [{
    name: 'resume-builder-backend',
    script: 'dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

Then start with:
```bash
pm2 start ecosystem.config.js
```

## Important Notes

1. **Install ALL dependencies before build**: Use `npm install` (not `npm install --production`) because TypeScript needs devDependencies to compile
2. **Build before start**: Always run `npm run build` to compile TypeScript
3. **Use migrate deploy**: Use `prisma migrate deploy` in production, not `prisma migrate dev`
4. **Generate Prisma Client**: Always run `npx prisma generate` after pulling code

## Troubleshooting

### TypeScript Build Errors
- Ensure `npm install` is run (not `npm install --production`)
- Check that all type definitions are in devDependencies

### Database Connection Errors
- Verify DATABASE_URL format
- Test connection: `mysql -u username -p -h 127.0.0.1 database_name`
- Check user permissions

### PM2 Not Starting
- Check logs: `pm2 logs resume-builder-backend`
- Verify file exists: `ls -la dist/server.js`
- Check environment variables: `pm2 env resume-builder-backend`
