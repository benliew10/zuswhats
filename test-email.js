import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import { promisify } from 'util';

dotenv.config();

const readFile = promisify(fs.readFile);

async function testEmail() {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH || './token.json';

  try {
    console.log('📧 Testing Gmail API connection...\n');

    // Load credentials
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Load token
    try {
      const token = JSON.parse(await readFile(tokenPath, 'utf8'));
      oAuth2Client.setCredentials(token);
    } catch (error) {
      console.error('❌ Token not found. Please run: npm run authorize');
      console.error('   Or run: npm start (it will prompt for authorization)\n');
      process.exit(1);
    }

    // Create Gmail client
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Test: Get profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('✅ Connected to Gmail API');
    console.log(`   Email: ${profile.data.emailAddress}\n`);

    // Test: List recent messages
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5,
    });

    console.log(`📨 Found ${response.data.messages?.length || 0} recent messages\n`);

    if (response.data.messages && response.data.messages.length > 0) {
      console.log('Recent messages:');
      for (const message of response.data.messages.slice(0, 3)) {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });

        const headers = fullMessage.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No subject';

        console.log(`   - From: ${from}`);
        console.log(`     Subject: ${subject}\n`);
      }
    }

    console.log('✅ Gmail API test successful!\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ENOENT') {
      console.error('\n📘 Make sure credentials.json exists in the project root.');
      console.error('   See GMAIL_API_SETUP.md for setup instructions.\n');
    } else if (error.message.includes('invalid_grant')) {
      console.error('\n⚠️  Token expired or invalid. Please run: npm run authorize\n');
    }
    process.exit(1);
  }
}

testEmail();

