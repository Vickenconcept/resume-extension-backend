# Database Setup for Laravel Forge

## Step 1: Get Database Credentials from Laravel Forge

1. Go to your Laravel Forge server dashboard
2. Click on "Databases" tab
3. Find your database (or create one if it doesn't exist)
4. Note down:
   - Database name
   - Database username
   - Database password
   - Host (usually `127.0.0.1` or `localhost`)
   - Port (usually `3306`)

## Step 2: Format DATABASE_URL

The DATABASE_URL should be in this format:

```
mysql://username:password@host:port/database_name?schema=public
```

### Example:
```
mysql://forge:MyStrongPassword123@127.0.0.1:3306/onpagecv_db?schema=public
```

## Step 3: Update .env File

On your server, edit the `.env` file:

```bash
nano .env
```

Add or update the DATABASE_URL:

```bash
DATABASE_URL="mysql://your_username:your_password@127.0.0.1:3306/onpagecv_db?schema=public"
```

**Important Notes:**
- Replace `your_username` with the actual database username from Forge
- Replace `your_password` with the actual database password
- Replace `onpagecv_db` with your actual database name
- Make sure there are NO spaces in the connection string
- If password contains special characters, URL encode them:
  - `@` becomes `%40`
  - `#` becomes `%23`
  - `$` becomes `%24`
  - `%` becomes `%25`
  - `&` becomes `%26`
  - etc.

## Step 4: Test Database Connection

Test the connection manually:

```bash
mysql -u your_username -p -h 127.0.0.1 onpagecv_db
```

Enter the password when prompted. If this works, your credentials are correct.

## Step 5: Verify .env File

Check that your .env file has the correct DATABASE_URL:

```bash
cat .env | grep DATABASE_URL
```

## Common Issues

### Issue 1: Wrong Username/Password
- Double-check credentials in Laravel Forge
- Make sure password doesn't have unencoded special characters

### Issue 2: Database Doesn't Exist
- Create the database in Laravel Forge first
- Make sure the database name matches exactly

### Issue 3: User Doesn't Have Permissions
- In Laravel Forge, make sure the database user has access to the database
- Check user permissions in the database section

### Issue 4: Host is Wrong
- Try `127.0.0.1` instead of `localhost`
- Or try `localhost` instead of `127.0.0.1`

## Step 6: After Fixing DATABASE_URL

Once DATABASE_URL is correct:

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate deploy
```

## Quick Test Command

To test if your DATABASE_URL is correct, you can use Prisma to introspect:

```bash
npx prisma db pull
```

This will try to connect and show any errors if credentials are wrong.
