# WhatsApp Bot

A WhatsApp bot that automates customer service with payment verification and SMS activation code delivery.

## Features

- 🤖 Automated WhatsApp conversation flow
- 💳 Payment verification via Gmail API
- 📧 Real-time email monitoring (checks every second)
- 📱 SMS Activate API integration with operator filtering
- 🔄 Automatic code delivery to customers
- 💬 Multi-step conversation management
- 🔁 Customer can request new number if SMS doesn't arrive

## Workflow

1. Customer sends a message to WhatsApp
2. Bot sends a preset guide message
3. Customer types "START" to begin
4. Bot sends payment image
5. Bot monitors email for payment confirmation
6. Customer enters their payment name
7. Bot verifies name matches email content
8. Bot requests number from SMS Activate API (with operator filter)
9. Bot monitors for activation code
10. Bot automatically sends code to customer via WhatsApp

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```bash
npm run setup
# or manually: cp env.template .env
```

3. Configure your `.env` file with:
   - Gmail API credentials (see GMAIL_API_SETUP.md)
   - SMS Activate API key
   - Payment image path
   - Custom guide message (optional)

## Configuration

### Email Setup (Gmail API)

The bot uses **Gmail API** (more secure than IMAP). Setup steps:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable Gmail API
3. Create OAuth 2.0 credentials (Desktop app)
4. Download `credentials.json` to project root
5. Run `npm start` or `npm run test-email` to authorize
6. See `GMAIL_API_SETUP.md` for detailed instructions

**Benefits of Gmail API:**
- ✅ More secure (OAuth2 instead of passwords)
- ✅ More reliable
- ✅ Better rate limits
- ✅ No need for App Passwords

### SMS Activate API

1. Sign up at https://sms-activate.org
2. Get your API key from the dashboard
3. Add it to `SMS_ACTIVATE_API_KEY` in `.env`

### Payment Image

Place your payment image in the project root or update `PAYMENT_IMAGE_PATH` in `.env`.

## Usage

Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

On first run, you'll see a QR code. Scan it with WhatsApp to link your account.

## Environment Variables

- `GMAIL_CREDENTIALS_PATH` - Path to OAuth2 credentials.json (default: ./credentials.json)
- `GMAIL_TOKEN_PATH` - Path to store OAuth2 token (default: ./token.json)
- `PAYMENT_EMAIL_SENDER` - Email address that sends payment confirmations
- `CHECK_EMAIL_INTERVAL` - How often to check email (milliseconds, default: 1000)
- `SMS_ACTIVATE_API_KEY` - Your SMS Activate API key
- `SMS_ACTIVATE_COUNTRY` - Country code (6 = Malaysia, 0 = Russia, etc.)
- `SMS_ACTIVATE_SERVICE` - Service code (wa = WhatsApp)
- `SMS_ACTIVATE_OPERATOR` - Operator filter (e.g., `hotlink` for Hotlink only, leave empty for any)
- `PAYMENT_IMAGE_PATH` - Path to payment image file
- `GUIDE_MESSAGE` - Custom guide message (optional)

📘 **See [SMS_ACTIVATE_OPERATORS.md](SMS_ACTIVATE_OPERATORS.md) for operator filtering details**

## Project Structure

```
zus/
├── index.js                 # Main bot file
├── services/
│   ├── emailMonitor.js     # Gmail API email monitoring service
│   ├── smsActivate.js      # SMS Activate API integration
│   ├── conversationState.js # Conversation state management
│   └── persistentAuth.js   # MongoDB session storage
├── credentials.json        # Gmail API OAuth2 credentials (from Google Cloud)
├── token.json             # Gmail API access token (generated after auth)
├── package.json
├── .env                    # Environment variables (create this)
└── README.md
```

## Notes

- The bot stores WhatsApp session in `.wwebjs_auth/` directory
- Email monitoring checks every second by default
- Payment name matching is case-insensitive
- Activation code polling checks every 2 seconds
- Timeout for code waiting is 5 minutes

## Troubleshooting

1. **QR Code not appearing**: Make sure you have a display/Terminal access
2. **Gmail API connection fails**: 
   - Check that `credentials.json` exists and is valid
   - Verify Gmail API is enabled in Google Cloud Console
   - Run `npm run test-email` to test connection
   - See `GMAIL_API_SETUP.md` for detailed troubleshooting
3. **SMS Activate errors**: Verify your API key and account balance
4. **Payment name not matching**: Check the email content format and adjust `extractPaymentName` in `emailMonitor.js`

## License

ISC

