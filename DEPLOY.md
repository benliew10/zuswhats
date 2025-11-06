# Deploy WhatsApp Bot to Render

## Step 1: Prepare Your Repository

1. **Initialize Git (if not already done):**
```bash
cd /Users/Apple/Desktop/zus
git init
git add .
git commit -m "Initial commit - WhatsApp bot with payment verification"
```

2. **Push to GitHub:**
```bash
# Create a new repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Step 2: Create Render Account

1. Go to https://render.com and sign up
2. Link your GitHub account

## Step 3: Deploy to Render

### Option A: Using render.yaml (Recommended)

1. Go to https://dashboard.render.com
2. Click **"New" → "Blueprint"**
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml`
5. Click **"Apply"**

### Option B: Manual Setup

1. Go to https://dashboard.render.com
2. Click **"New" → "Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name:** whatsapp-zus-bot
   - **Region:** Singapore
   - **Branch:** main
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Starter ($7/month)

## Step 4: Set Environment Variables

In Render Dashboard → Your Service → Environment:

### Required Secrets (Add as "Secret File"):
1. **credentials.json** - Your Gmail OAuth credentials
   - Copy content from your local `credentials.json`

2. **token.json** - Your Gmail OAuth token
   - Copy content from your local `token.json`

3. **payment-image.jpg** - Your payment QR code
   - Upload your GXBank QR code image

### Required Environment Variables:
```
SMS_ACTIVATE_API_KEY=bb67d66c0A6b9Ae29233e0AA5251127c
PAYMENT_EMAIL_SENDER=alerts@gxbank.my
CHECK_EMAIL_INTERVAL=10000
SMS_ACTIVATE_COUNTRY=7
SMS_ACTIVATE_SERVICE=aik
SMS_ACTIVATE_OPERATOR=hotlink
GMAIL_CREDENTIALS_PATH=./credentials.json
GMAIL_TOKEN_PATH=./token.json
PAYMENT_IMAGE_PATH=./payment-image.jpg
```

## Step 5: First Time Setup on Render

⚠️ **IMPORTANT:** WhatsApp requires QR code scanning on first run

1. After deployment, check the **Logs** tab
2. You'll see: "📱 QR CODE RECEIVED - SCAN THIS WITH YOUR PHONE"
3. **Problem:** You can't see the QR code in logs!

### Solution: Use Render Shell

1. In Render Dashboard → Your Service → **Shell** tab
2. The QR code will appear in the shell
3. Scan it with WhatsApp on your phone:
   - Open WhatsApp → Settings → Linked Devices → Link a Device
   - Scan the QR code

4. Once connected, the session is saved and persists across restarts

## Step 6: Verify Deployment

1. Check logs show:
   ```
   ✅ WhatsApp bot is ready!
   ✅ Bot is now listening for messages...
   ✅ Email monitoring connected
   ```

2. Test the bot by sending a message to your WhatsApp number

3. Health check endpoint: `https://your-app.onrender.com/health`

## Important Notes

### Session Persistence
- Render's free tier resets the filesystem on restart
- You'll need to re-scan QR code after each restart
- **Solution:** Upgrade to paid plan with persistent disk

### Gmail API Rate Limits
- Current setting: Check email every 10 seconds
- If you hit rate limits, increase `CHECK_EMAIL_INTERVAL` to 30000 (30 seconds)

### Render Free Tier Limitations
- Service spins down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- WhatsApp session may be lost
- **Recommendation:** Use paid Starter plan ($7/month) for 24/7 uptime

## Troubleshooting

### "Cannot read properties of undefined (reading 'match')"
- Email parsing error - check Gmail API permissions

### "Insufficient Permission"
- Re-authorize Gmail with both scopes:
  - `gmail.readonly`
  - `gmail.modify`

### "Failed to launch browser"
- Render uses headless Chrome automatically
- Check logs for specific Chromium errors

### Port Already in Use
- Render automatically assigns PORT
- Bot uses PORT 3000 by default, but will use $PORT if set

## Cost Estimate

- **Starter Plan:** $7/month
- **SMS Activate:** ~$0.50 per number (varies by country/operator)
- **Total:** ~$7-10/month depending on usage

## Support

If you encounter issues:
1. Check Render logs
2. Verify all environment variables are set
3. Ensure credentials.json and token.json are valid
4. Test locally first before deploying
