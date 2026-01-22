# Setup Guide for Node.js Backend

## Quick Start

1. **Install Dependencies**
   ```bash
   cd backend2
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   - `DATABASE_URL`: Your MySQL connection string (same as Laravel backend)
   - `JWT_SECRET`: A random secret string
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `CLOUDINARY_URL`: Your Cloudinary connection string

3. **Set Up Database**
   ```bash
   # Generate Prisma Client
   npm run prisma:generate
   
   # Run migrations (creates tables)
   npm run prisma:migrate
   ```

4. **Start Server**
   ```bash
   npm run dev
   ```

   Server will run on `http://localhost:3000`

## Database Setup

The Prisma schema matches your Laravel database structure. If you're using the same MySQL database:

1. The tables will be created by Prisma migrations
2. OR you can use existing tables if they match the schema

To use existing tables, you may need to adjust the Prisma schema to match your exact table structure.

## API Endpoints

All endpoints match the Laravel backend:

- `POST /api/register` - Register user
- `POST /api/login` - Login user  
- `GET /api/me` - Get current user (protected)
- `POST /api/logout` - Logout (protected)
- `GET /api/resume` - Get current resume (protected)
- `POST /api/upload-resume` - Upload resume (protected)
- `POST /api/tailor-resume` - Tailor resume (protected)
- `POST /api/download-tailored-resume` - Download tailored resume (protected)

## Testing

Test the API:
```bash
curl http://localhost:3000/api/test
```

Should return:
```json
{
  "success": true,
  "message": "API is working!",
  "data": {
    "status": "ok",
    "timestamp": "..."
  }
}
```

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` in `.env` matches your MySQL credentials
- Ensure MySQL server is running
- Check database exists

### Prisma Issues
- Run `npm run prisma:generate` after schema changes
- Run `npm run prisma:migrate` to sync database

### Cloudinary Issues
- Verify `CLOUDINARY_URL` is correct
- Check Cloudinary dashboard for upload limits

### OpenAI Issues
- Verify `OPENAI_API_KEY` is set
- Check API key has sufficient credits

## Production Deployment

1. Build the project:
   ```bash
   npm run build
   ```

2. Start production server:
   ```bash
   npm start
   ```

3. Use a process manager like PM2:
   ```bash
   pm2 start dist/server.js --name resume-backend
   ```
