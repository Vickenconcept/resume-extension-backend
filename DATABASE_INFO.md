# Database Information

## Database Details

- **Database Name**: `resume-builder`
- **Host**: `127.0.0.1` (localhost)
- **Port**: `3306`
- **User**: `root`
- **Password**: (empty - default Laragon setup)

## Connection String

```
mysql://root:@127.0.0.1:3306/resume-builder?schema=public
```

## Where Laragon Stores MySQL Databases

Laragon stores MySQL databases in:
```
C:\laragon\bin\mysql\[mysql-version]\data\[database-name]
```

For example:
```
C:\laragon\bin\mysql\mysql-8.0.30\data\resume-builder
```

## Database Tables

The following tables are created by Prisma:

1. **users** - User accounts
   - id, name, email, password, created_at, updated_at

2. **resumes** - Resume files and data
   - id, user_id, resume_id, filename, cloudinary_url, cloudinary_public_id
   - parsed_content (JSON), tailored_docx_url, tailored_pdf_url
   - tailored_resume_text, cover_letter, download_urls (JSON)
   - created_at, updated_at

3. **tokens** - JWT authentication tokens
   - id, user_id, token, expires_at, created_at

## Accessing the Database

### Option 1: Laragon MySQL Client
1. Open Laragon
2. Click "Database" button
3. Select "resume-builder" database
4. View/edit tables

### Option 2: MySQL Command Line
```bash
mysql -u root -p
USE resume-builder;
SHOW TABLES;
```

### Option 3: Prisma Studio (Recommended)
```bash
cd backend2
npm run prisma:studio
```
Opens a web interface at `http://localhost:5555`

### Option 4: phpMyAdmin (if installed)
- Usually at: `http://localhost/phpmyadmin`
- Login with: root / (empty password)
- Select `resume-builder` database

## Viewing Database Location

To find your exact database location:
1. Open Laragon
2. Click "Menu" → "MySQL" → "Data Directory"
3. Look for the `resume-builder` folder

Or check:
```
C:\laragon\bin\mysql\[your-mysql-version]\data\resume-builder
```

## Backup Database

To backup your database:
```bash
mysqldump -u root -p resume-builder > backup.sql
```

## Restore Database

To restore:
```bash
mysql -u root -p resume-builder < backup.sql
```
