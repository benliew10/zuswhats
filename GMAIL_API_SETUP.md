# Gmail API Setup Guide

This guide will help you set up Gmail API access for reading emails.

## Why Gmail API?

- ✅ More reliable than IMAP
- ✅ Better security with OAuth2
- ✅ No need for App Passwords
- ✅ Better rate limits
- ✅ More features and control

## Step-by-Step Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click **"New Project"**
4. Enter a project name (e.g., "WhatsApp Bot")
5. Click **"Create"**
6. Wait for the project to be created and select it

### Step 2: Enable Gmail API

1. In the Google Cloud Console, go to **"APIs & Services"** → **"Library"**
2. Search for **"Gmail API"**
3. Click on **"Gmail API"**
4. Click **"Enable"**
5. Wait for it to enable (may take a few seconds)

### Step 3: Create OAuth 2.0 Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**
4. If prompted, configure the OAuth consent screen first:
   - Choose **"External"** (unless you have a Google Workspace)
   - Fill in the required fields:
     - App name: "WhatsApp Bot"
     - User support email: Your email
     - Developer contact: Your email
   - Click **"Save and Continue"**
   - On Scopes page, click **"Save and Continue"**
   - On Test users page, add your Gmail address, then **"Save and Continue"**
   - Review and **"Back to Dashboard"**

5. Back at Credentials:
   - Application type: **"Desktop app"** (or "Web application" if Desktop isn't available)
   - Name: "WhatsApp Bot Client"
   - Click **"Create"**
   - A popup will appear with your credentials
   - Click **"Download JSON"** (or copy the credentials)

### Step 4: Download Credentials File

1. Save the downloaded file as `credentials.json`
2. Place it in your project root directory (`/Users/Apple/Desktop/zus/`)
3. The file should look like this:
   ```json
   {
     "installed": {
       "client_id": "your-client-id.apps.googleusercontent.com",
       "project_id": "your-project-id",
       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
       "token_uri": "https://oauth2.googleapis.com/token",
       "client_secret": "your-client-secret",
       "redirect_uris": ["http://localhost"]
     }
   }
   ```

### Step 5: Authorize the Application

1. Run the bot or test script:
   ```bash
   npm start
   # or
   npm run test-email
   ```

2. You'll see a URL like:
   ```
   https://accounts.google.com/o/oauth2/auth?...
   ```

3. Copy and paste this URL into your browser

4. Sign in with the Gmail account you want to monitor

5. Click **"Allow"** to grant permissions

6. You'll be redirected to a page with a code in the URL (or an error page)
   - Copy the `code` parameter from the URL
   - It looks like: `4/0AeanS...`

7. If using the bot directly, paste the code when prompted
   - The bot will save it as `token.json` automatically

### Step 6: Verify Setup

Run the test script:
```bash
npm run test-email
```

You should see:
```
✅ Successfully connected to Gmail!
📧 Email: your-email@gmail.com
```

## Configuration

Update your `.env` file (optional, defaults are fine):

```env
# Gmail API Configuration
GMAIL_CREDENTIALS_PATH=./credentials.json
GMAIL_TOKEN_PATH=./token.json
PAYMENT_EMAIL_SENDER=payments@example.com
CHECK_EMAIL_INTERVAL=1000
```

## File Structure

After setup, you should have:
```
zus/
├── credentials.json    # OAuth2 credentials (from Google Cloud)
├── token.json         # Access token (generated after authorization)
├── .env              # Configuration
└── ...
```

## Security Notes

- ⚠️ **Never commit `credentials.json` or `token.json` to git**
- ✅ They're already in `.gitignore`
- ✅ Keep these files secure and private
- ✅ You can revoke access anytime in Google Account settings

## Troubleshooting

### "Credentials file not found"
- Make sure `credentials.json` is in the project root
- Check the file name is exactly `credentials.json` (not `credentials.json.json`)

### "Invalid credentials"
- Verify you downloaded OAuth 2.0 credentials (not API key)
- Make sure Gmail API is enabled in Google Cloud Console
- Check that the credentials file is valid JSON

### "Token expired" or "invalid_grant"
- Delete `token.json` and re-authorize
- Make sure you're using the same Google account
- Check that the OAuth consent screen is properly configured

### "Access blocked: This app's request is invalid"
- Make sure you added your email as a test user in OAuth consent screen
- If in production, you need to verify your app with Google

### Authorization URL doesn't work
- Make sure you're signed in to the correct Google account
- Check that the OAuth consent screen is configured
- Try copying the URL directly (don't click if it's in terminal)

## Revoking Access

To revoke access:
1. Go to https://myaccount.google.com/permissions
2. Find "WhatsApp Bot" or your app name
3. Click "Remove Access"

## Production Use

For production:
1. Publish your OAuth consent screen
2. Get your app verified by Google (if needed)
3. Consider using a service account for server-to-server auth
4. Implement proper token refresh handling

## Next Steps

After setup:
1. ✅ Test connection: `npm run test-email`
2. ✅ Start bot: `npm start`
3. ✅ Bot will monitor emails automatically

For more details, see the main README.md

