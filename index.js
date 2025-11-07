import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import pino from 'pino';
import EmailMonitor from './services/emailMonitor.js';
import SMSActivate from './services/smsActivate.js';
import ConversationState from './services/conversationState.js';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';

dotenv.config();

class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.qrRetries = 0;
    this.maxQrRetries = 5;

    this.emailMonitor = new EmailMonitor({
      credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || './credentials.json',
      tokenPath: process.env.GMAIL_TOKEN_PATH || './token.json',
      paymentEmailSender: process.env.PAYMENT_EMAIL_SENDER,
      checkEmailInterval: parseInt(process.env.CHECK_EMAIL_INTERVAL) || 10000
    });

    this.smsActivate = new SMSActivate(process.env.SMS_ACTIVATE_API_KEY);
    this.conversationState = new ConversationState();
    this.paymentImagePath = process.env.PAYMENT_IMAGE_PATH || './payment-image.jpg';
    this.paymentNames = [];
  }

  async connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['WhatsApp Bot', 'Chrome', '1.0.0']
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrRetries++;
        console.log('\n📱 QR CODE RECEIVED - SCAN THIS WITH YOUR PHONE:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n👆 Open WhatsApp on your phone → Settings → Linked Devices → Link a Device\n');

        if (this.qrRetries >= this.maxQrRetries) {
          console.log('❌ Max QR retries reached. Exiting...');
          process.exit(1);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ Connection closed. Reconnect:', shouldReconnect);

        if (shouldReconnect) {
          setTimeout(() => this.connectToWhatsApp(), 5000);
        } else {
          console.log('🔴 Logged out. Please delete baileys_auth folder and restart.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp bot is ready!');
        console.log('✅ Bot is now listening for messages...');
        this.qrRetries = 0;
        await this.startEmailMonitoring();
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      const message = messages[0];
      if (!message.message || message.key.fromMe) return;

      await this.handleMessage(message);
    });
  }

  async handleMessage(message) {
    try {
      const phoneNumber = message.key.remoteJid;
      const messageBody = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text || '';
      const messageBodyUpper = messageBody.trim().toUpperCase();

      console.log(`\n📨 Message from ${phoneNumber}:`);
      console.log(`   Body: ${messageBody}`);

      const state = this.conversationState.getState(phoneNumber);
      console.log(`   Current state: ${state.step}`);

      switch (state.step) {
        case 'idle':
          const template1 = `TOPUPSTATION 24HRS AUTO BOT
ZUS VOUCHER
BUY 1 FREE 1

Supports:
Android and IOS

To make payment please reply
:PAYMENT

To contact live agent please reply
:live agent`;
          await this.sendMessage(phoneNumber, template1);
          this.conversationState.setState(phoneNumber, { step: 'awaiting_payment_keyword' });
          break;

        case 'awaiting_payment_keyword':
          if (messageBodyUpper === 'PAYMENT' || messageBodyUpper.includes('PAYMENT')) {
            const template2 = `ZUS COFFEE VOUCHER - RM1.68

Please pay the exact number RM1.68 ONLY
PAY MORE OR LESS YOUR PAYMENT WILL NOT PROCESS

Transfer to GXBank: 018-2804099

After payment please send your NAME that appeared on the transaction receipt.

(Note: if you encounter the payment issue feel free to contact live agent)`;

            await this.sendMessage(phoneNumber, template2);

            if (existsSync(this.paymentImagePath)) {
              try {
                const imageBuffer = readFileSync(this.paymentImagePath);
                await this.sock.sendMessage(phoneNumber, {
                  image: imageBuffer,
                  caption: 'GXBank Payment QR Code'
                });
              } catch (error) {
                console.error('❌ Error sending payment image:', error.message);
              }
            }

            this.conversationState.setState(phoneNumber, { step: 'waiting_for_payment' });
          }
          break;

        case 'waiting_for_payment':
          const enteredName = messageBody.trim();
          console.log(`👤 Customer entered name: ${enteredName}`);

          let matchedPayment = null;
          for (const payment of this.paymentNames) {
            if (this.namesMatch(enteredName, payment.name)) {
              matchedPayment = payment;
              break;
            }
          }

          if (matchedPayment) {
            console.log(`✅ Payment verified for: ${matchedPayment.name}`);
            this.paymentNames = this.paymentNames.filter(p => p !== matchedPayment);
            await this.processActivation(message, phoneNumber);
          } else {
            await this.sendMessage(phoneNumber, '❌ No matching payment found. Please ensure:\n1. You paid exactly RM1.68\n2. You entered your name correctly as shown in the payment receipt\n\nTry again or type PAYMENT to restart.');
          }
          break;

        case 'waiting_for_code':
          if (messageBodyUpper === 'CHANGE' || messageBodyUpper === 'NEW' || messageBodyUpper === 'CANCEL') {
            const currentState = state;

            if (!currentState.numberSentTimestamp) {
              await this.sendMessage(phoneNumber, '❌ No active number to cancel.');
              this.conversationState.resetState(phoneNumber);
              break;
            }

            const elapsedTime = Date.now() - currentState.numberSentTimestamp;
            const twoMinutes = 2 * 60 * 1000;

            if (elapsedTime < twoMinutes) {
              const remainingSeconds = Math.ceil((twoMinutes - elapsedTime) / 1000);
              await this.sendMessage(phoneNumber, `⏳ Please wait ${remainingSeconds} more seconds before requesting a new number.`);
            } else {
              if (currentState.activationId) {
                await this.smsActivate.releaseNumber(currentState.activationId);
                await this.sendMessage(phoneNumber, '⏳ Cancelling old number and getting a new one...');
                await this.processActivation(message, phoneNumber);
              }
            }
          } else {
            console.log('🔇 Bot staying silent during waiting_for_code state');
          }
          break;

        default:
          this.conversationState.resetState(phoneNumber);
          await this.handleMessage(message);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  async sendMessage(jid, text) {
    await this.sock.sendMessage(jid, { text });
  }

  namesMatch(enteredName, emailName) {
    const normalizedEntered = enteredName.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedEmail = emailName.toLowerCase().trim().replace(/\s+/g, ' ');

    return normalizedEntered === normalizedEmail ||
           normalizedEntered.includes(normalizedEmail) ||
           normalizedEmail.includes(normalizedEntered);
  }

  async processActivation(message, phoneNumber) {
    try {
      const currentState = this.conversationState.getState(phoneNumber);
      if (currentState.checkCodeInterval) {
        clearInterval(currentState.checkCodeInterval);
      }
      if (currentState.timeoutId) {
        clearTimeout(currentState.timeoutId);
      }

      this.conversationState.setState(phoneNumber, { step: 'waiting_for_code' });

      const country = parseInt(process.env.SMS_ACTIVATE_COUNTRY) || 0;
      const service = process.env.SMS_ACTIVATE_SERVICE || 'wa';

      const numberData = await this.smsActivate.getNumber(country, service);

      const template3 = `PAYMENT VERIFIED!

NUMBER: ${numberData.number}
Waiting for SMS……
The code will sent automatically
Note: You can change the number after 2 minutes if there is no code coming, type 'Change' for a new number`;

      await this.sendMessage(phoneNumber, template3);

      const checkCodeInterval = setInterval(async () => {
        try {
          const status = await this.smsActivate.getStatus(numberData.activationId);

          if (status.status === 'ok') {
            const state = this.conversationState.getState(phoneNumber);
            if (state.checkCodeInterval) clearInterval(state.checkCodeInterval);
            if (state.timeoutId) clearTimeout(state.timeoutId);

            await this.sendMessage(phoneNumber, `✅ Your activation code is: ${status.code}`);
            await this.smsActivate.releaseNumber(numberData.activationId);
            this.conversationState.resetState(phoneNumber);
          }
        } catch (error) {
          console.error('Error checking SMS status:', error);
        }
      }, 10000);

      const timeoutId = setTimeout(async () => {
        clearInterval(checkCodeInterval);
        await this.sendMessage(phoneNumber, '⏰ Timeout: No code received within 20 minutes. Please type CHANGE for a new number.');
      }, 20 * 60 * 1000);

      this.conversationState.setState(phoneNumber, {
        activationId: numberData.activationId,
        numberSentTimestamp: Date.now(),
        checkCodeInterval: checkCodeInterval,
        timeoutId: timeoutId
      });
    } catch (error) {
      console.error('❌ Error processing activation:', error);
      await this.sendMessage(phoneNumber, `❌ Error: ${error.message}. Please try again.`);
    }
  }

  async startEmailMonitoring() {
    try {
      console.log('📧 Starting email monitoring...');
      await this.emailMonitor.connect();
      console.log('✅ Email monitoring connected');

      this.emailMonitor.startMonitoring(async (email, paymentData) => {
        if (paymentData) {
          const amount = paymentData.amount ? paymentData.amount.replace(/,/g, '') : null;
          const expectedAmount = '1.68';

          if (amount === expectedAmount) {
            this.paymentNames.push({
              name: paymentData.name,
              amount: amount,
              timestamp: Date.now(),
              emailSubject: email.subject
            });
            console.log('✅ Payment amount verified: RM' + amount);
          } else {
            console.log(`⚠️ Payment amount mismatch: Expected RM${expectedAmount}, got RM${amount}`);
          }
        }
      });
    } catch (error) {
      console.error('❌ Email monitoring error:', error);
    }
  }

  async initialize() {
    console.log('🚀 Starting WhatsApp Bot with Baileys...');
    await this.connectToWhatsApp();
  }
}

// Start the bot
const bot = new WhatsAppBot();

// Health check server
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

bot.initialize().catch(console.error);
