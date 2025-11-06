import dotenv from 'dotenv';
import fs from 'fs';
import { promisify } from 'util';
import readline from 'readline';

dotenv.config();

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function setupEnv() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log('📝 WhatsApp Bot Setup\n');
  console.log('This will create a .env file with your configuration.\n');

  const env = {};

  // SMS Activate API Key
  env.SMS_ACTIVATE_API_KEY = await question('Enter your SMS Activate API key: ');
  
  // Country
  env.SMS_ACTIVATE_COUNTRY = await question('Enter country code (6 for Malaysia, 0 for Russia): ') || '0';
  
  // Service
  env.SMS_ACTIVATE_SERVICE = await question('Enter service code (wa for WhatsApp): ') || 'wa';
  
  // Operator
  env.SMS_ACTIVATE_OPERATOR = await question('Enter operator filter (hotlink, maxis, etc. or leave empty for any): ') || '';

  // Payment Email Sender
  env.PAYMENT_EMAIL_SENDER = await question('Enter payment email sender address: ');

  // Payment Image Path
  env.PAYMENT_IMAGE_PATH = await question('Enter payment image path (default: ./payment-image.jpg): ') || './payment-image.jpg';

  // Guide Message
  env.GUIDE_MESSAGE = await question('Enter guide message (or press Enter for default): ') || 'Welcome! To proceed, please follow these steps:\n1. Type START to begin\n2. Make payment using the provided image\n3. Enter your full name as shown in payment\n4. Receive your activation code';

  // MongoDB (optional)
  env.MONGODB_URI = await question('Enter MongoDB URI (optional, for Render deployment): ') || '';

  // Port
  env.PORT = await question('Enter port (default: 3000): ') || '3000';

  // Gmail API paths
  env.GMAIL_CREDENTIALS_PATH = './credentials.json';
  env.GMAIL_TOKEN_PATH = './token.json';

  // Build .env content
  let envContent = `# WhatsApp Bot Configuration\n\n`;
  envContent += `# SMS Activate API\n`;
  envContent += `SMS_ACTIVATE_API_KEY=${env.SMS_ACTIVATE_API_KEY}\n`;
  envContent += `SMS_ACTIVATE_COUNTRY=${env.SMS_ACTIVATE_COUNTRY}\n`;
  envContent += `SMS_ACTIVATE_SERVICE=${env.SMS_ACTIVATE_SERVICE}\n`;
  if (env.SMS_ACTIVATE_OPERATOR) {
    envContent += `SMS_ACTIVATE_OPERATOR=${env.SMS_ACTIVATE_OPERATOR}\n`;
  }
  envContent += `\n# Gmail API\n`;
  envContent += `GMAIL_CREDENTIALS_PATH=${env.GMAIL_CREDENTIALS_PATH}\n`;
  envContent += `GMAIL_TOKEN_PATH=${env.GMAIL_TOKEN_PATH}\n`;
  envContent += `\n# Payment Configuration\n`;
  envContent += `PAYMENT_EMAIL_SENDER=${env.PAYMENT_EMAIL_SENDER}\n`;
  envContent += `PAYMENT_IMAGE_PATH=${env.PAYMENT_IMAGE_PATH}\n`;
  envContent += `GUIDE_MESSAGE=${env.GUIDE_MESSAGE}\n`;
  envContent += `CHECK_EMAIL_INTERVAL=1000\n`;
  envContent += `\n# MongoDB (optional)\n`;
  if (env.MONGODB_URI) {
    envContent += `MONGODB_URI=${env.MONGODB_URI}\n`;
    envContent += `MONGODB_DB_NAME=whatsapp_bot\n`;
  }
  envContent += `\n# Server\n`;
  envContent += `PORT=${env.PORT}\n`;

  await writeFile('.env', envContent);
  console.log('\n✅ .env file created successfully!');
  console.log('\n📋 Next steps:');
  console.log('1. Make sure credentials.json is in the project root (for Gmail API)');
  console.log('2. Run: npm start');
  console.log('3. Scan the QR code with WhatsApp\n');

  rl.close();
}

setupEnv().catch(console.error);

