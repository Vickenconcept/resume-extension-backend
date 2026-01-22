# Resume Builder Backend (Node.js + Express)

Node.js + Express backend for the Resume Builder application, replicating all functionality from the Laravel backend.

## Features

- **Authentication**: Register, login, logout, and user profile management
- **Resume Management**: Upload, parse, and tailor resumes
- **AI Integration**: OpenAI GPT-4o-mini for resume tailoring
- **Document Generation**: Generate DOCX and PDF files from tailored resumes
- **Cloud Storage**: Cloudinary integration for file storage
- **Database**: Prisma ORM with MySQL

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: MySQL with Prisma ORM
- **AI**: OpenAI API
- **File Storage**: Cloudinary
- **Document Generation**: 
  - DOCX: `docx` library
  - PDF: Puppeteer (HTML to PDF)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `DATABASE_URL`: MySQL connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `OPENAI_API_KEY`: Your OpenAI API key
- `CLOUDINARY_URL` or individual Cloudinary credentials

### 3. Set Up Database

```bash
# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate
```

### 4. Start Development Server

```bash
npm run dev
```

The server will run on `http://localhost:3000`

## API Endpoints

### Authentication

- `POST /api/register` - Register a new user
- `POST /api/login` - Login user
- `GET /api/me` - Get current user (protected)
- `POST /api/logout` - Logout user (protected)

### Resume

- `GET /api/resume` - Get current user's resume (protected)
- `POST /api/upload-resume` - Upload resume file (protected)
- `POST /api/tailor-resume` - Tailor resume to job description (protected)
- `POST /api/download-tailored-resume` - Download tailored resume (protected)

### Test

- `GET /api/test` - Test endpoint to verify API is working

## API Response Format

All API responses follow this format:

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Success message"
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "message": "Error message",
  "data": null
}
```

## Project Structure

```
backend2/
├── src/
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic
│   ├── routes/          # API routes
│   ├── middleware/      # Express middleware
│   ├── utils/           # Utility functions
│   ├── types/           # TypeScript types
│   └── server.ts         # Application entry point
├── prisma/
│   └── schema.prisma    # Database schema
├── package.json
└── tsconfig.json
```

## Development

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run prisma:studio` - Open Prisma Studio to view database

## Notes

- This backend replicates all functionality from the Laravel backend
- Uses the same database schema (via Prisma)
- Maintains the same API response format for compatibility
- All services (OpenAI, Cloudinary, etc.) are configured identically
