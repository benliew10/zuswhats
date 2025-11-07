import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import express from 'express';
import os from 'os';
import EmailMonitor from './services/emailMonitor.js';
import SMSActivate from './services/smsActivate.js';
import ConversationState from './services/conversationState.js';
import PersistentAuthStrategy from './services/persistentAuth.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppBot {
  constructor() {
    // Use persistent auth if MongoDB is configured, otherwise use LocalAuth
    const authStrategy = process.env.MONGODB_URI
      ? new PersistentAuthStrategy({
          clientId: 'whatsapp-bot',
          mongoUrl: process.env.MONGODB_URI,
          dbName: process.env.MONGODB_DB_NAME || 'whatsapp_bot'
        })
      : new LocalAuth();

    // Configure Puppeteer with minimal args
    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    };

    // Use system Chrome (more stable than downloaded Chromium)
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(chromePath)) {
      puppeteerConfig.executablePath = chromePath;
      console.log('✅ Using system Chrome for better stability');
    } else {
      // Fallback to downloaded Chromium
      const homedir = os.homedir();
      const chromiumPath = `${homedir}/.cache/puppeteer/chrome/mac_arm-115.0.5790.102/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
      if (existsSync(chromiumPath)) {
        puppeteerConfig.executablePath = chromiumPath;
        console.log('✅ Using older Chromium version (115)');
      }
    }

    this.client = new Client({
      authStrategy: authStrategy,
      puppeteer: puppeteerConfig,
      authTimeoutMs: 0 // Disable auth timeout
    });

    this.emailMonitor = new EmailMonitor({
      credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || './credentials.json',
      tokenPath: process.env.GMAIL_TOKEN_PATH || './token.json',
      paymentEmailSender: process.env.PAYMENT_EMAIL_SENDER,
      checkEmailInterval: parseInt(process.env.CHECK_EMAIL_INTERVAL) || 10000
    });

    this.smsActivate = new SMSActivate(process.env.SMS_ACTIVATE_API_KEY);
    this.conversationState = new ConversationState();

    this.guideMessage = process.env.GUIDE_MESSAGE ||
      'Welcome! To proceed, please follow these steps:\n1. Type START to begin\n2. Make payment using the provided image\n3. Enter your full name as shown in payment\n4. Receive your activation code';

    this.paymentImagePath = process.env.PAYMENT_IMAGE_PATH || './payment-image.jpg';
    this.paymentNames = []; // Store recent payment names with timestamps

    // Add event listeners BEFORE initialization to catch early events
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // QR Code generation
    this.client.on('qr', (qr) => {
      console.log('\n📱 QR CODE RECEIVED - SCAN THIS WITH YOUR PHONE:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n👆 Open WhatsApp on your phone → Settings → Linked Devices → Link a Device\n');
    });

    // Client ready
    this.client.on('ready', () => {
      console.log('✅ WhatsApp bot is ready!');
      console.log('✅ Bot is now listening for messages...');
      this.startEmailMonitoring();
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failure:', msg);
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      console.log('❌ Client disconnected:', reason);
    });

    // Loading screen
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading WhatsApp Web: ${percent}%`);
    });

    // Authenticated
    this.client.on('authenticated', () => {
      console.log('✅ Session restored - already logged in!');
    });

    // Remote session saved
    this.client.on('remote_session_saved', () => {
      console.log('✅ Session saved!');
    });

    // Message received - Use ONLY message_create event (more reliable)
    this.client.on('message_create', async (message) => {
      console.log('🔔 [message_create] event triggered');
      console.log('   fromMe:', message.fromMe);
      console.log('   from:', message.from);
      console.log('   body:', message.body ? message.body.substring(0, 50) : '(no body)');

      // Ignore messages sent by the bot itself
      if (message.fromMe) {
        console.log('⏭️  Ignoring message from bot itself');
        return;
      }
      // Only handle if it's a new message (not already processed)
      await this.handleMessage(message);
    });
  }

  async startEmailMonitoring() {
    try {
      console.log('📧 Starting email monitoring...');
      await this.emailMonitor.connect();
      console.log('✅ Email monitoring connected');
      this.emailMonitor.startMonitoring(async (email, paymentData) => {
        console.log('📧 Payment email received:', email.subject);
        if (paymentData) {
          // Verify amount is exactly RM1.68
          const amount = paymentData.amount ? paymentData.amount.replace(/,/g, '') : null;
          const expectedAmount = '1.68';

          if (amount === expectedAmount) {
            // Store payment name and amount permanently until verified
            this.paymentNames.push({
              name: paymentData.name,
              amount: amount,
              timestamp: Date.now(),
              emailSubject: email.subject
            });
            console.log('✅ Payment name extracted:', paymentData.name);
            console.log('✅ Payment amount verified: RM' + amount);
            console.log(`📊 Total stored payments: ${this.paymentNames.length}`);
          } else {
            console.log(`⚠️  Payment amount mismatch: Expected RM${expectedAmount}, got RM${amount}`);
            console.log(`⏭️  Skipping payment from ${paymentData.name} (wrong amount)`);
          }
        }
      });
    } catch (error) {
      console.error('❌ Failed to start email monitoring:', error.message);
      console.error('⚠️  Bot will continue without email monitoring');
      // Don't block the bot if email monitoring fails
    }
  }

  async handleMessage(message) {
    try {
      console.log('📥 Processing message...');
      console.log('   Message ID:', message.id._serialized);
      console.log('   From:', message.from);
      console.log('   From Me:', message.fromMe);
      console.log('   Has Media:', message.hasMedia);
      console.log('   Body:', message.body ? message.body.substring(0, 50) : '(no body)');

      // Ignore messages from groups (check if it contains @)
      if (message.from.includes('@g.us')) {
        console.log('⏭️  Ignoring group message');
        return;
      }

      // Ignore status messages
      if (message.from === 'status@broadcast') {
        console.log('⏭️  Ignoring status message');
        return;
      }

      // Ignore messages sent by the bot itself (double check)
      if (message.fromMe) {
        console.log('⏭️  Ignoring own message');
        return;
      }

      const contact = await message.getContact();
      const phoneNumber = contact.number;
      const messageBody = message.body ? message.body.trim() : '';

      if (!messageBody || messageBody.length === 0) {
        console.log('⚠️  Empty message body, ignoring');
        return;
      }

      const messageBodyUpper = messageBody.toUpperCase();
      const state = this.conversationState.getState(phoneNumber);

      console.log(`📨 Message from ${phoneNumber}: ${messageBody}`);
      console.log(`📊 Current state: ${state.step}`);

      switch (state.step) {
        case 'idle':
          // Send Template 1 for any incoming message
          console.log('📤 Sending Template 1 (Welcome message)');
          const template1 = `TOPUPSTATION 24HRS AUTO BOT
ZUS VOUCHER
BUY 1 FREE 1

Supports:
Android and IOS

To make payment please reply
:PAYMENT

To contact live agent please reply
:live agent`;
          await message.reply(template1);
          this.conversationState.setState(phoneNumber, { step: 'awaiting_payment_keyword' });
          console.log('✅ Template 1 sent, waiting for PAYMENT keyword');
          break;

        case 'awaiting_payment_keyword':
          // Check if user typed "PAYMENT"
          if (messageBodyUpper === 'PAYMENT' || messageBodyUpper.includes('PAYMENT')) {
            console.log('✅ PAYMENT keyword received, sending Template 2');
            const template2 = `ZUS COFFEE VOUCHER - RM1.68

Please pay the exact number RM1.68 ONLY
PAY MORE OR LESS YOUR PAYMENT WILL NOT PROCESS
PLEASE CONTACT LIVE AGENT IF U PAY NOT THE EXACT NUMBER

After you made the payment, please send your FULL NAME to the chat for payment verification

Example: Name-MOHAMMAD ALI
        X MOHAMMAD
        X ALI
        ^MOHAMMAD ALI`;
            await message.reply(template2);

            // Send payment image if it exists
            if (existsSync(this.paymentImagePath)) {
              try {
                const media = MessageMedia.fromFilePath(this.paymentImagePath);
                // Use client.sendMessage instead of message.reply for media
                await this.client.sendMessage(message.from, media);
                console.log('✅ Payment image sent successfully');
              } catch (error) {
                console.error('❌ Error sending payment image:', error.message);
                await message.reply('Payment QR code image could not be loaded. Please contact support.');
              }
            }

            this.conversationState.setState(phoneNumber, { step: 'waiting_for_payment' });
            console.log('✅ Template 2 sent, waiting for customer name');
          } else if (messageBodyUpper.includes('LIVE AGENT') || messageBodyUpper.includes('LIVEAGENT')) {
            await message.reply('Please contact our live agent at: [Your Contact Info]');
          } else {
            await message.reply('Please type PAYMENT to proceed with payment, or type "live agent" for assistance.');
          }
          break;

        case 'waiting_for_payment':
          // Check if payment has been made by verifying name and amount
          if (messageBody.length > 0 && this.paymentNames.length > 0) {
            const enteredName = message.body.trim();

            // Check against ALL stored payment names (no time limit)
            // Only RM1.68 payments are stored, so all matches are pre-verified for amount
            const matchedPayment = this.paymentNames.find(p =>
              this.verifyPaymentName(enteredName, p.name)
            );

            if (matchedPayment) {
              console.log('✅ Payment verification successful:');
              console.log('   Name:', matchedPayment.name);
              console.log('   Amount: RM' + matchedPayment.amount);

              // Remove the matched payment name so it can't be reused
              const index = this.paymentNames.findIndex(p => p === matchedPayment);
              if (index > -1) {
                this.paymentNames.splice(index, 1);
                console.log('✅ Payment removed after verification (cannot be reused)');
              }

              // Send Template 3 and process activation
              await this.processActivation(message, phoneNumber);
            } else {
              await message.reply('Name does not match payment records. Please enter the exact name used for payment.');
            }
          } else {
            await message.reply('Please wait for payment confirmation, then enter your full name as shown in the payment.');
          }
          break;

        case 'waiting_for_code':
          // Allow customer to request a new number after 2 minutes
          if (messageBodyUpper === 'CHANGE' || messageBodyUpper === 'NEW' || messageBodyUpper === 'CANCEL') {
            console.log('🔄 Customer requesting new number...');
            const currentState = state;

            // Check if number was sent and if 2 minutes have passed
            if (!currentState.numberSentTimestamp) {
              console.log('❌ No timestamp found - number was not sent yet');
              await message.reply('❌ No active number to cancel. Please type START to begin.');
              this.conversationState.resetState(phoneNumber);
              break;
            }

            const elapsedTime = Date.now() - currentState.numberSentTimestamp;
            const twoMinutes = 2 * 60 * 1000; // 2 minutes in milliseconds

            if (elapsedTime < twoMinutes) {
              // Not enough time has passed
              const remainingSeconds = Math.ceil((twoMinutes - elapsedTime) / 1000);
              console.log(`⏳ Only ${Math.floor(elapsedTime / 1000)}s passed, need to wait ${remainingSeconds}s more`);
              await message.reply(`⏳ Please wait ${remainingSeconds} more seconds before requesting a new number.`);
            } else {
              // 2 minutes passed, allow change
              console.log('✅ 2 minutes passed, cancelling old activation...');
              if (currentState.activationId) {
                try {
                  // Cancel the old activation
                  await this.smsActivate.releaseNumber(currentState.activationId);
                  console.log('✅ Old activation cancelled:', currentState.activationId);
                  await message.reply('⏳ Cancelling old number and getting a new one...');

                  // Process new activation
                  await this.processActivation(message, phoneNumber);
                } catch (error) {
                  console.error('❌ Error cancelling activation:', error);
                  await message.reply('❌ Error changing number. Please try again or type START to restart.');
                  this.conversationState.resetState(phoneNumber);
                }
              } else {
                await message.reply('❌ No active number to cancel. Please type START to begin.');
                this.conversationState.resetState(phoneNumber);
              }
            }
          } else {
            // For any other message, stay silent (do not send any response)
            console.log('🔇 Bot staying silent during waiting_for_code state');
          }
          break;

        default:
          await message.reply('Please type START to begin the process.');
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      console.error('Error stack:', error.stack);
      // Try to send error message to user
      try {
        await message.reply('Sorry, I encountered an error. Please try again.');
      } catch (replyError) {
        console.error('Failed to send error reply:', replyError);
      }
    }
  }

  async sendGuideMessage(message) {
    await message.reply(this.guideMessage);

    // Send payment image if it exists
    if (existsSync(this.paymentImagePath)) {
      const media = MessageMedia.fromFilePath(this.paymentImagePath);
      await message.reply(media);
    } else {
      await message.reply('Payment image not found. Please contact support.');
      console.warn(`Payment image not found at: ${this.paymentImagePath}`);
    }
  }

  verifyPaymentName(enteredName, emailName) {
    // Normalize names for comparison (case-insensitive, trim whitespace)
    const normalizedEntered = enteredName.toLowerCase().trim();
    const normalizedEmail = emailName.toLowerCase().trim();

    // Check if names match exactly or if entered name contains email name
    return normalizedEntered === normalizedEmail ||
           normalizedEntered.includes(normalizedEmail) ||
           normalizedEmail.includes(normalizedEntered);
  }

  async processActivation(message, phoneNumber) {
    try {
      // Clear any existing intervals/timeouts first
      const currentState = this.conversationState.getState(phoneNumber);
      if (currentState.checkCodeInterval) {
        console.log('🧹 Clearing old SMS check interval');
        clearInterval(currentState.checkCodeInterval);
      }
      if (currentState.timeoutId) {
        console.log('🧹 Clearing old timeout');
        clearTimeout(currentState.timeoutId);
      }

      this.conversationState.setState(phoneNumber, { step: 'waiting_for_code' });

      // Get number from SMS Activate
      const country = parseInt(process.env.SMS_ACTIVATE_COUNTRY) || 0;
      const service = process.env.SMS_ACTIVATE_SERVICE || 'wa';

      console.log(`📱 Requesting number from SMS Activate - Country: ${country}, Service: ${service}`);
      const numberData = await this.smsActivate.getNumber(country, service);
      console.log(`✅ Number received:`, numberData);

      // Send Template 3
      const template3 = `PAYMENT VERIFIED!

NUMBER: ${numberData.number}
Waiting for SMS……
The code will sent automatically
Note: You can change the number after 2 minutes if there is no code coming, type 'Change' for a new number`;

      await message.reply(template3);

      // Wait for code with polling
      const checkCodeInterval = setInterval(async () => {
        try {
          console.log(`🔍 Checking SMS status for activation ${numberData.activationId}...`);
          const status = await this.smsActivate.getStatus(numberData.activationId);
          console.log(`📨 SMS Status:`, status);

          if (status.status === 'ok') {
            const state = this.conversationState.getState(phoneNumber);
            if (state.checkCodeInterval) clearInterval(state.checkCodeInterval);
            if (state.timeoutId) clearTimeout(state.timeoutId);

            console.log(`✅ SMS code received: ${status.code}`);
            await message.reply(`✅ Your activation code is: ${status.code}`);

            // Release the number
            await this.smsActivate.releaseNumber(numberData.activationId);

            // Reset state
            this.conversationState.resetState(phoneNumber);
          } else if (status.status === 'cancelled') {
            const state = this.conversationState.getState(phoneNumber);
            if (state.checkCodeInterval) clearInterval(state.checkCodeInterval);
            if (state.timeoutId) clearTimeout(state.timeoutId);

            await message.reply('❌ Activation was cancelled. Please try again.');
            this.conversationState.resetState(phoneNumber);
          }
        } catch (error) {
          console.error('❌ Error checking code status:', error.message);
        }
      }, 2000); // Check every 2 seconds

      // Timeout after 5 minutes
      const timeoutId = setTimeout(() => {
        const state = this.conversationState.getState(phoneNumber);
        if (state.checkCodeInterval) clearInterval(state.checkCodeInterval);

        if (this.conversationState.getState(phoneNumber).step === 'waiting_for_code') {
          message.reply('Timeout waiting for code. Please try again.');
          this.smsActivate.releaseNumber(numberData.activationId).catch(console.error);
          this.conversationState.resetState(phoneNumber);
        }
      }, 300000); // 5 minutes

      // Store interval and timeout IDs in state so we can clear them later
      this.conversationState.setState(phoneNumber, {
        activationId: numberData.activationId,
        numberSentTimestamp: Date.now(), // Track when number was sent
        checkCodeInterval: checkCodeInterval,
        timeoutId: timeoutId
      });

    } catch (error) {
      console.error('Error processing activation:', error);
      await message.reply('Error processing activation. Please try again later.');
      this.conversationState.resetState(phoneNumber);
    }
  }

  async initialize() {
    try {
      console.log('🔄 Initializing WhatsApp client...');
      console.log('⏳ This will take 30-60 seconds, please wait...');
      console.log('💡 The browser runs in the background (headless mode)\n');

      // Just initialize without timeout - let it take its time
      await this.client.initialize();

    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client');
      console.error('Error:', error.message);
      throw error;
    }
  }
}

// Start the bot
const bot = new WhatsAppBot();

// Start health check server for Render
const healthApp = express();
const PORT = process.env.PORT || 3000;

healthApp.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'whatsapp-bot'
  });
});

healthApp.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Initialize bot
console.log('🚀 Starting WhatsApp Bot...');
bot.initialize()
  .then(() => {
    console.log('✅ Bot initialization complete');
  })
  .catch((error) => {
    console.error('❌ Bot initialization failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  bot.emailMonitor.stopMonitoring();
  bot.emailMonitor.disconnect();
  await bot.client.destroy();
  process.exit(0);
});

