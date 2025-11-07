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

const SERVICES = {
  'Zus Coffee': { name: 'Zus Coffee', code: 'aik', price: 'RM1.68' },
  'Beutea': { name: 'Beutea', code: 'ot', price: 'RM1.68' },
  'Chagee': { name: 'Chagee', code: 'bmx', price: 'RM1.68' },
  'Gigi Coffee': { name: 'Gigi Coffee', code: 'ot', price: 'RM1.68' },
  'Luckin Coffee': { name: 'Luckin Coffee', code: 'ot', price: 'RM1.68' },
  'Tealive': { name: 'Tealive', code: 'avb', price: 'RM1.68' },
  'Kenangan Coffee': { name: 'Kenangan Coffee', code: 'ot', price: 'RM1.68' }
};

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

    const apiKey = process.env.SMS_ACTIVATE_API_KEY;
    console.log(`🔑 SMS Activate API Key loaded: ${apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET'}`);
    this.smsActivate = new SMSActivate(apiKey);
    this.conversationState = new ConversationState();
    this.paymentImagePath = process.env.PAYMENT_IMAGE_PATH || './payment-image.jpg';
    this.paymentNames = [];
    this.pendingNames = new Map(); // Store names temporarily before email arrives
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

      // Handle list/button responses
      if (message.message?.listResponseMessage || message.message?.buttonsResponseMessage) {
        await this.handlePollResponse(message, phoneNumber);
        return;
      }

      console.log(`\n📨 Message from ${phoneNumber}:`);
      console.log(`   Body: ${messageBody}`);

      const state = this.conversationState.getState(phoneNumber);
      console.log(`   Current state: ${state.step}`);

      switch (state.step) {
        case 'idle':
          const template1 = `TOPUPSTATION 24HRS AUTO BOT\nVOUCHER SERVICE\n\nSupports: Android and IOS\n\nTo make payment please reply: PAYMENT\nTo contact live agent please reply: live agent`;
          await this.sendMessage(phoneNumber, template1);
          this.conversationState.setState(phoneNumber, { step: 'awaiting_payment_keyword' });
          break;

        case 'awaiting_payment_keyword':
          if (messageBodyUpper === 'PAYMENT' || messageBodyUpper.includes('PAYMENT')) {
            await this.sendServicePoll(phoneNumber);
            this.conversationState.setState(phoneNumber, { step: 'awaiting_service_selection' });
          }
          break;

        case 'waiting_for_payment':
          const enteredName = messageBody.trim();
          console.log(`👤 Customer entered name: ${enteredName}`);

          // Check if payment email already arrived
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
            // Store name temporarily and wait for email
            console.log(`⏳ Storing name temporarily, waiting for payment email...`);
            const currentState = this.conversationState.getState(phoneNumber);
            this.pendingNames.set(phoneNumber, {
              name: enteredName,
              service: currentState.selectedService,
              timestamp: Date.now()
            });

            await this.sendMessage(phoneNumber, '✅ Name received! Once payment is confirmed, your number will be sent automatically.\n\nIf you already made payment 5 mins ago and you don\'t receive the number, please contact live agent.');

            // Set timeout to clear pending name after 5 minutes
            setTimeout(() => {
              if (this.pendingNames.has(phoneNumber)) {
                console.log(`⏰ Clearing pending name for ${phoneNumber} after 5 minutes`);
                this.pendingNames.delete(phoneNumber);
              }
            }, 5 * 60 * 1000);
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

  async sendServicePoll(phoneNumber) {
    const listMessage = await this.sock.sendMessage(phoneNumber, {
      text: 'Please select your service:',
      footer: 'TOPUPSTATION 24HRS AUTO BOT',
      buttonText: 'Select Service',
      sections: [{
        title: 'Available Services',
        rows: [
          { title: 'Zus Coffee', description: 'RM1.68', rowId: 'service_zus' },
          { title: 'Beutea', description: 'RM1.68', rowId: 'service_beutea' },
          { title: 'Chagee', description: 'RM1.68', rowId: 'service_chagee' },
          { title: 'Gigi Coffee', description: 'RM1.68', rowId: 'service_gigi' },
          { title: 'Luckin Coffee', description: 'RM1.68', rowId: 'service_luckin' },
          { title: 'Tealive', description: 'RM1.68', rowId: 'service_tealive' },
          { title: 'Kenangan Coffee', description: 'RM1.68', rowId: 'service_kenangan' }
        ]
      }]
    });

    // Store list message key for potential deletion
    this.conversationState.setState(phoneNumber, {
      listMessageKey: listMessage.key
    });
  }

  async handlePollResponse(message, phoneNumber) {
    try {
      // Handle list response
      const listResponse = message.message?.listResponseMessage;
      const buttonResponse = message.message?.buttonsResponseMessage;

      let rowId = null;

      if (listResponse) {
        rowId = listResponse.singleSelectReply?.selectedRowId;
        console.log('📋 List response:', rowId);
      } else if (buttonResponse) {
        rowId = buttonResponse.selectedButtonId;
        console.log('🔘 Button response:', rowId);
      }

      if (!rowId) {
        console.log('⚠️ No valid response found');
        return;
      }

      // Map rowId to service
      const serviceMap = {
        'service_zus': 'Zus Coffee',
        'service_beutea': 'Beutea',
        'service_chagee': 'Chagee',
        'service_gigi': 'Gigi Coffee',
        'service_luckin': 'Luckin Coffee',
        'service_tealive': 'Tealive',
        'service_kenangan': 'Kenangan Coffee'
      };

      const selectedServiceName = serviceMap[rowId];
      const selectedService = SERVICES[selectedServiceName];

      if (!selectedService) {
        console.log(`❌ Could not find service for rowId ${rowId}`);
        return;
      }

      console.log(`📊 Service selected: ${selectedServiceName}`);

      const currentState = this.conversationState.getState(phoneNumber);

      // Delete old order details message if exists
      if (currentState.orderMessageKey) {
        try {
          await this.sock.sendMessage(phoneNumber, {
            delete: currentState.orderMessageKey
          });
          console.log('🗑️ Deleted old order details message');
        } catch (error) {
          console.log('⚠️ Could not delete old message:', error.message);
        }
      }

      // Send new order details
      const orderDetails = `━━━━━━━━━━━━━━━━
Here is your order details!

Name: ${selectedService.name}
Cost: ${selectedService.price}

Please pay the exact number RM1.68 ONLY
PAY MORE OR LESS YOUR PAYMENT WILL NOT PROCESS

Transfer to GXBank: 018-2804099

After payment please send your FULL NAME for verification purpose
(Note: if you encounter the payment issue feel free to contact live agent)
━━━━━━━━━━━━━━━━`;

      const orderMessage = await this.sendMessage(phoneNumber, orderDetails);

      // Send payment QR image
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

      // Update state with selected service and order message key
      this.conversationState.setState(phoneNumber, {
        step: 'waiting_for_payment',
        selectedService: selectedService,
        orderMessageKey: orderMessage.key
      });

    } catch (error) {
      console.error('❌ Error handling poll response:', error);
    }
  }

  async sendMessage(jid, text) {
    const sentMsg = await this.sock.sendMessage(jid, { text });
    return sentMsg;
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
      const selectedService = currentState.selectedService;
      const serviceCode = selectedService.code;
      const operator = process.env.SMS_ACTIVATE_OPERATOR || null;

      console.log(`📱 Getting number for ${selectedService.name} (code: ${serviceCode})`);

      const numberData = await this.smsActivate.getNumber(country, serviceCode, operator);

      const template3 = `━━━━━━━━━━━━━━━━
PAYMENT VERIFIED!

Name: ${selectedService.name}
NUMBER: ${numberData.number}

Waiting for SMS……
The code will be sent automatically

Note: You can change the number after 2 minutes if there is no code coming, type 'Change' for a new number
━━━━━━━━━━━━━━━━`;

      await this.sendMessage(phoneNumber, template3);

      const checkCodeInterval = setInterval(async () => {
        try {
          const status = await this.smsActivate.getStatus(numberData.activationId);

          if (status.status === 'ok') {
            const state = this.conversationState.getState(phoneNumber);
            if (state.checkCodeInterval) clearInterval(state.checkCodeInterval);
            if (state.timeoutId) clearTimeout(state.timeoutId);

            // Send full SMS message instead of just code
            const fullMessage = status.fullMessage || status.code;
            await this.sendMessage(phoneNumber, `✅ SMS Received:\n\n${fullMessage}`);

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
      await this.sendMessage(phoneNumber, `❌ Error: ${error.message}. Please try again or contact live agent.`);
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
            console.log('✅ Payment amount verified: RM' + amount);

            // Check if there's a pending name waiting for this payment
            let matchedPending = null;
            for (const [phoneNumber, pendingData] of this.pendingNames.entries()) {
              if (this.namesMatch(pendingData.name, paymentData.name)) {
                matchedPending = { phoneNumber, ...pendingData };
                break;
              }
            }

            if (matchedPending) {
              // Name was stored first, process immediately
              console.log(`⚡ Found pending name for ${paymentData.name}, processing immediately`);
              this.pendingNames.delete(matchedPending.phoneNumber);

              // Create a mock message object for processActivation
              const mockMessage = {
                key: { remoteJid: matchedPending.phoneNumber }
              };

              await this.processActivation(mockMessage, matchedPending.phoneNumber);
            } else {
              // Email arrived first, store it normally
              this.paymentNames.push({
                name: paymentData.name,
                amount: amount,
                timestamp: Date.now(),
                emailSubject: email.subject
              });
            }
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
