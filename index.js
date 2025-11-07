import express from 'express';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import EmailMonitor from './services/emailMonitor.js';
import SMSActivate from './services/smsActivate.js';
import ConversationState from './services/conversationState.js';
import WhatsAppBusinessAPI from './services/whatsappBusinessAPI.js';

dotenv.config();

const SERVICES = {
  'Zus Coffee': { name: 'Zus Coffee', code: 'aik', price: 'RM1.68' },
  'Beutea': { name: 'Beutea', code: 'ot', price: 'RM1.68' },
  'Chagee': { name: 'Chagee', code: 'bwx', price: 'RM1.68' },
  'Gigi Coffee': { name: 'Gigi Coffee', code: 'ot', price: 'RM1.68' },
  'Luckin Coffee': { name: 'Luckin Coffee', code: 'ot', price: 'RM1.68' },
  'Tealive': { name: 'Tealive', code: 'avb', price: 'RM1.68' },
  'Kenangan Coffee': { name: 'Kenangan Coffee', code: 'ot', price: 'RM1.68' }
};

class WhatsAppBot {
  constructor() {
    this.whatsappAPI = new WhatsAppBusinessAPI(
      process.env.WHATSAPP_ACCESS_TOKEN,
      process.env.WHATSAPP_PHONE_NUMBER_ID
    );

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
    this.pendingNames = new Map();
    this.processedMessages = new Set();
  }

  async start() {
    console.log('✅ WhatsApp Bot with Business API is ready!');
    console.log('✅ Bot is now listening for webhook messages...');
    await this.startEmailMonitoring();
  }

  async handleWebhookMessage(webhookData) {
    const parsedMessage = this.whatsappAPI.parseWebhookMessage(webhookData);
    if (!parsedMessage) return;

    const { from, messageId, body } = parsedMessage;

    // Deduplicate messages
    if (this.processedMessages.has(messageId)) {
      console.log(`⏭️ Skipping duplicate message: ${messageId}`);
      return;
    }

    this.processedMessages.add(messageId);

    // Clean up old message IDs (keep last 1000)
    if (this.processedMessages.size > 1000) {
      const arr = Array.from(this.processedMessages);
      this.processedMessages = new Set(arr.slice(-1000));
    }

    // Mark as read
    await this.whatsappAPI.markAsRead(messageId);

    // Handle message
    await this.handleMessage(from, body);
  }

  async handleMessage(phoneNumber, messageBody) {
    try {
      const messageBodyUpper = messageBody.trim().toUpperCase();

      console.log(`📨 Message from ${phoneNumber}:`);
      console.log(`   Body: ${messageBody}`);

      const state = this.conversationState.getState(phoneNumber);
      console.log(`   Current state: ${state.step}`);

      switch (state.step) {
        case 'idle':
        case 'awaiting_payment_keyword':
          if (messageBodyUpper === 'PAYMENT' || messageBodyUpper.includes('PAYMENT')) {
            const serviceMenu = `Please select your service by replying with the number:

1️⃣ Zus Coffee - RM1.68
2️⃣ Beutea - RM1.68
3️⃣ Chagee - RM1.68
4️⃣ Gigi Coffee - RM1.68
5️⃣ Luckin Coffee - RM1.68
6️⃣ Tealive - RM1.68
7️⃣ Kenangan Coffee - RM1.68

Reply with the number (1-7)`;

            await this.sendMessage(phoneNumber, serviceMenu);
            this.conversationState.setState(phoneNumber, { step: 'awaiting_service_selection' });
          } else {
            await this.sendMessage(phoneNumber, 'Please reply "PAYMENT" to start the process.');
          }
          break;

        case 'awaiting_service_selection':
          const selection = messageBody.trim();
          const serviceArray = [
            'Zus Coffee',
            'Beutea',
            'Chagee',
            'Gigi Coffee',
            'Luckin Coffee',
            'Tealive',
            'Kenangan Coffee'
          ];

          let selectedServiceName = null;

          const num = parseInt(selection);
          if (num >= 1 && num <= 7) {
            selectedServiceName = serviceArray[num - 1];
          } else {
            for (const serviceName of serviceArray) {
              if (messageBodyUpper.includes(serviceName.toUpperCase())) {
                selectedServiceName = serviceName;
                break;
              }
            }
          }

          if (selectedServiceName) {
            const selectedService = SERVICES[selectedServiceName];
            await this.sendOrderDetails(phoneNumber, selectedService);
          } else {
            await this.sendMessage(phoneNumber, '❌ Invalid selection. Please reply with a number from 1-7.');
          }
          break;

        case 'waiting_for_payment':
          const enteredName = messageBody.trim();
          console.log(`👤 Customer entered name: "${enteredName}"`);

          let matchedPayment = null;
          for (const payment of this.paymentNames) {
            if (this.namesMatch(enteredName, payment.name)) {
              console.log(`✅ Name matched with payment: ${payment.name}`);
              matchedPayment = payment;
              break;
            }
          }

          if (matchedPayment) {
            console.log(`✅ Payment verified for: ${matchedPayment.name}`);
            this.paymentNames = this.paymentNames.filter(p => p !== matchedPayment);
            await this.processActivation(phoneNumber);
          } else {
            console.log(`⏳ Storing name temporarily, waiting for payment email...`);
            const currentState = this.conversationState.getState(phoneNumber);
            this.pendingNames.set(phoneNumber, {
              name: enteredName,
              service: currentState.selectedService,
              timestamp: Date.now()
            });

            await this.sendMessage(phoneNumber, '✅ Name received! Once payment is confirmed, your number will be sent automatically.\n\nIf you already made payment 5 mins ago and you don\'t receive the number, please contact live agent.');

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
                await this.processActivation(phoneNumber);
              }
            }
          } else {
            console.log('🔇 Bot staying silent during waiting_for_code state');
          }
          break;

        default:
          this.conversationState.resetState(phoneNumber);
          await this.handleMessage(phoneNumber, messageBody);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  async sendOrderDetails(phoneNumber, selectedService) {
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

    await this.sendMessage(phoneNumber, orderDetails);

    this.conversationState.setState(phoneNumber, {
      step: 'waiting_for_payment',
      selectedService: selectedService
    });
  }

  async sendMessage(phoneNumber, text) {
    try {
      await this.whatsappAPI.sendMessage(phoneNumber, text);
    } catch (error) {
      console.error(`❌ Error sending message to ${phoneNumber}:`, error.message);
    }
  }

  namesMatch(enteredName, emailName) {
    const normalizedEntered = enteredName.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedEmail = emailName.toLowerCase().trim().replace(/\s+/g, ' ');

    return normalizedEntered === normalizedEmail ||
           normalizedEntered.includes(normalizedEmail) ||
           normalizedEmail.includes(normalizedEntered);
  }

  async processActivation(phoneNumber) {
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
      const operator = null;

      console.log(`📱 Getting number for ${selectedService.name} (code: ${serviceCode})`);

      const numberData = await this.smsActivate.getNumber(country, serviceCode, operator);

      const activationId = numberData.activationId;
      const phoneNumberReceived = numberData.number;

      await this.sendMessage(
        phoneNumber,
        `✅ ${selectedService.name} Verification\n\n` +
        `📞 Phone Number: +${phoneNumberReceived}\n` +
        `🔢 Activation ID: ${activationId}\n\n` +
        `⏳ Waiting for verification code...\n` +
        `(This may take 1-5 minutes)\n\n` +
        `⚠️ After 2 minutes, you can request a new number by typing "CHANGE"`
      );

      let codeReceived = false;
      let messageCount = 0;

      const checkCodeInterval = setInterval(async () => {
        try {
          const status = await this.smsActivate.getStatus(activationId);

          if (status.status === 'ok') {
            codeReceived = true;
            clearInterval(checkCodeInterval);

            const verificationCode = status.code;
            const fullMessage = status.fullMessage;

            console.log(`✅ Code received for ${phoneNumber}: ${verificationCode}`);
            console.log(`📩 Full SMS message: ${fullMessage}`);

            await this.sendMessage(
              phoneNumber,
              `✅ ${selectedService.name} Verification Code Received!\n\n` +
              `🔐 Code: ${verificationCode}\n\n` +
              `📱 Full Message:\n${fullMessage}\n\n` +
              `Thank you for your order!`
            );

            this.conversationState.resetState(phoneNumber);
          } else if (status.status === 'cancelled') {
            codeReceived = true;
            clearInterval(checkCodeInterval);
            await this.sendMessage(phoneNumber, '❌ Activation cancelled.');
            this.conversationState.resetState(phoneNumber);
          } else {
            messageCount++;
            if (messageCount % 15 === 0) {
              await this.sendMessage(phoneNumber, '⏳ Still waiting for code...');
            }
          }
        } catch (error) {
          console.error('❌ Error checking code:', error);
          clearInterval(checkCodeInterval);
          await this.sendMessage(phoneNumber, `❌ Error: ${error.message}`);
          this.conversationState.resetState(phoneNumber);
        }
      }, 2000);

      const timeoutId = setTimeout(async () => {
        if (!codeReceived) {
          clearInterval(checkCodeInterval);
          await this.sendMessage(phoneNumber, '⏰ Timeout: No code received within 5 minutes.');
          this.conversationState.resetState(phoneNumber);
        }
      }, 5 * 60 * 1000);

      this.conversationState.setState(phoneNumber, {
        step: 'waiting_for_code',
        activationId: activationId,
        phoneNumber: phoneNumberReceived,
        numberSentTimestamp: Date.now(),
        checkCodeInterval: checkCodeInterval,
        timeoutId: timeoutId
      });
    } catch (error) {
      console.error('❌ Error processing activation:', error);

      if (error.message.includes('No numbers available')) {
        const currentState = this.conversationState.getState(phoneNumber);
        const selectedService = currentState.selectedService;

        await this.sendMessage(phoneNumber, `❌ Sorry, ${selectedService.name} service is temporarily unavailable due to insufficient phone numbers.\n\nPlease select a different service or contact live agent.`);

        this.conversationState.setState(phoneNumber, { step: 'awaiting_service_selection' });

        const serviceMenu = `Please select your service by replying with the number:

1️⃣ Zus Coffee - RM1.68
2️⃣ Beutea - RM1.68
3️⃣ Chagee - RM1.68
4️⃣ Gigi Coffee - RM1.68
5️⃣ Luckin Coffee - RM1.68
6️⃣ Tealive - RM1.68
7️⃣ Kenangan Coffee - RM1.68

Reply with the number (1-7)`;
        await this.sendMessage(phoneNumber, serviceMenu);
      } else {
        await this.sendMessage(phoneNumber, `❌ Error: ${error.message}. Please try again or contact live agent.`);
      }
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

            let matchedPending = null;
            for (const [phoneNumber, pendingData] of this.pendingNames.entries()) {
              if (this.namesMatch(pendingData.name, paymentData.name)) {
                console.log(`🎯 Payment matched with pending name: ${pendingData.name}`);
                matchedPending = { phoneNumber, ...pendingData };
                break;
              }
            }

            if (matchedPending) {
              this.pendingNames.delete(matchedPending.phoneNumber);
              await this.sendMessage(matchedPending.phoneNumber, '✅ Payment verified! Processing your request now...');
              await this.processActivation(matchedPending.phoneNumber);
            } else {
              this.paymentNames.push(paymentData);
              console.log(`📝 Added payment to list: ${paymentData.name}`);
            }
          } else {
            console.log(`⚠️ Payment amount mismatch. Expected: RM${expectedAmount}, Got: RM${amount}`);
          }
        }
      });
    } catch (error) {
      console.error('❌ Email monitoring error:', error);
    }
  }
}

const app = express();
app.use(express.json());

const bot = new WhatsAppBot();

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'my_verify_token_12345';

  const result = bot.whatsappAPI.verifyWebhook(mode, token, challenge, verifyToken);
  if (result) {
    res.status(200).send(result);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    await bot.handleWebhookMessage(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.sendStatus(500);
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🚀 Starting WhatsApp Bot with Business API...`);
  console.log(`Health check server running on port ${PORT}`);
  await bot.start();
});
