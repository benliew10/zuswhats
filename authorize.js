import { google } from 'googleapis';
import fs from 'fs';
import { promisify } from 'util';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function authorize() {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH || './token.json';

  try {
    // Load credentials
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Check if we already have a token
    try {
      const token = JSON.parse(await readFile(tokenPath, 'utf8'));
      oAuth2Client.setCredentials(token);
      console.log('✅ Token already exists. If you need to re-authorize, delete token.json first.');
      return;
    } catch (error) {
      // Token doesn't exist, need to authorize
    }

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'],
    });

    console.log('\n📱 Authorize this app by visiting this URL:\n');
    console.log(authUrl);
    console.log('\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Enter the code from that page here: ', async (code) => {
      rl.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await writeFile(tokenPath, JSON.stringify(tokens, null, 2));
        console.log('\n✅ Token stored to', tokenPath);
        console.log('✅ Authorization complete! You can now run: npm start\n');
      } catch (error) {
        if (error.message.includes('access_denied')) {
          console.error('\n❌ Access denied. This usually means:');
          console.error('   1. The OAuth consent screen is not configured properly');
          console.error('   2. Your email is not added as a test user');
          console.error('   3. The app is not in testing mode');
          console.error('\n📘 See FIX_403_ERROR.md for detailed troubleshooting steps\n');
        } else {
          console.error('❌ Error retrieving access token:', error.message);
        }
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ENOENT') {
      console.error('\n📘 Make sure credentials.json exists in the project root.');
      console.error('   See GMAIL_API_SETUP.md for setup instructions.\n');
    }
    process.exit(1);
  }
}

authorize();

