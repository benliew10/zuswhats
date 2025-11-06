import { google } from 'googleapis';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class EmailMonitor {
  constructor(config) {
    this.config = config;
    this.gmail = null;
    this.isMonitoring = false;
    this.lastCheckedHistoryId = null;
    this.oauth2Client = null;
    this.processedEmails = new Set(); // Track processed email IDs
  }

  async connect() {
    try {
      // Load credentials
      const credentialsPath = this.config.credentialsPath || './credentials.json';
      const tokenPath = this.config.tokenPath || './token.json';

      if (!existsSync(credentialsPath)) {
        throw new Error(`Credentials file not found at ${credentialsPath}. Please download it from Google Cloud Console.`);
      }

      const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));

      // Create OAuth2 client
      this.oauth2Client = new google.auth.OAuth2(
        credentials.installed?.client_id || credentials.web?.client_id,
        credentials.installed?.client_secret || credentials.web?.client_secret,
        credentials.installed?.redirect_uris?.[0] || credentials.web?.redirect_uris?.[0] || 'http://localhost:3000/oauth2callback'
      );

      // Load or request token
      if (existsSync(tokenPath)) {
        const token = JSON.parse(readFileSync(tokenPath, 'utf8'));
        this.oauth2Client.setCredentials(token);

        // Refresh token if expired
        if (token.expiry_date && Date.now() >= token.expiry_date) {
          await this.refreshToken();
        }
      } else {
        await this.getNewToken();
      }

      // Create Gmail client
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      // Test connection
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      console.log('Gmail API connection established for:', profile.data.emailAddress);

      // Mark all existing unread emails as already processed (ignore old emails on startup)
      await this.markExistingEmailsAsProcessed();

      return true;
    } catch (error) {
      console.error('Gmail API connection error:', error.message);
      throw error;
    }
  }

  async markExistingEmailsAsProcessed() {
    try {
      console.log('📧 Marking existing emails as processed (ignoring old emails)...');
      const query = `is:unread from:${this.config.paymentEmailSender}`;

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100, // Get all existing unread emails
      });

      if (response.data.messages && response.data.messages.length > 0) {
        response.data.messages.forEach(msg => {
          this.processedEmails.add(msg.id);
        });
        console.log(`✅ Marked ${response.data.messages.length} existing emails as processed (will be ignored)`);
      } else {
        console.log('✅ No existing unread emails to mark');
      }
    } catch (error) {
      console.error('⚠️  Error marking existing emails:', error.message);
      // Don't fail - just continue without marking
    }
  }

  async getNewToken() {
    return new Promise((resolve, reject) => {
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'],
      });

      console.log('\n🔐 Authorization required!');
      console.log('Visit this URL to authorize the application:');
      console.log('\n' + authUrl + '\n');
      console.log('After authorization, enter the code from the URL here.');

      // For automated flow, you can use a simple HTTP server or manual copy-paste
      // For now, we'll use a simple prompt
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('Enter the code from the URL: ', async (code) => {
        rl.close();
        try {
          const { tokens } = await this.oauth2Client.getToken(code);
          this.oauth2Client.setCredentials(tokens);

          // Save token for future use
          const tokenPath = this.config.tokenPath || './token.json';
          writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
          console.log('Token stored to', tokenPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async refreshToken() {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);

      const tokenPath = this.config.tokenPath || './token.json';
      writeFileSync(tokenPath, JSON.stringify(credentials, null, 2));
      console.log('Token refreshed');
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Need to get new token
      await this.getNewToken();
    }
  }

  async checkForPayment() {
    try {
      // Search for unread emails from the payment sender
      const query = `is:unread from:${this.config.paymentEmailSender}`;

      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 1,
      });

      if (!response.data.messages || response.data.messages.length === 0) {
        return null;
      }

      // Get the most recent email
      const messageId = response.data.messages[0].id;

      // Check if already processed
      if (this.processedEmails.has(messageId)) {
        return null;
      }

      const message = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      // Parse email data
      const emailData = this.parseEmail(message.data);

      // Mark as processed in our tracking
      this.processedEmails.add(messageId);

      // Try to mark as read (optional - won't fail if permission denied)
      try {
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['UNREAD'],
          },
        });
      } catch (error) {
        // Ignore permission errors - email will remain unread but bot will track processed emails
        if (error.code !== 403) {
          console.error('Error marking email as read:', error.message);
        }
      }

      return emailData;
    } catch (error) {
      console.error('Error checking email:', error);
      return null;
    }
  }

  parseEmail(message) {
    const headers = message.payload.headers;
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let text = '';
    let html = '';

    // Extract body content
    const extractBody = (part) => {
      if (part.body?.data) {
        const content = Buffer.from(part.body.data, 'base64').toString('utf-8');
        if (part.mimeType === 'text/plain') {
          text += content;
        } else if (part.mimeType === 'text/html') {
          html += content;
        }
      }
      if (part.parts) {
        part.parts.forEach(extractBody);
      }
    };

    extractBody(message.payload);

    return {
      id: message.id,
      subject: getHeader('subject'),
      from: getHeader('from'),
      text: text,
      html: html,
      snippet: message.snippet,
    };
  }

  extractPaymentName(emailContent) {
    // Prioritize snippet (clean text) over HTML
    const snippet = emailContent.snippet || '';
    const text = emailContent.text || '';

    // Debug logging
    console.log('📝 Email snippet:', snippet.substring(0, 200));
    console.log('📝 Email text preview:', text.substring(0, 200));

    // Check if this is an OUTGOING payment - skip these
    if (snippet.match(/your\s+transaction.*\s+to\s+/i) || text.match(/your\s+transaction.*\s+to\s+/i)) {
      console.log('⏭️  Skipping outgoing payment (transaction TO someone)');
      return null;
    }

    // Only process INCOMING payments with "received...from" pattern
    if (!snippet.match(/received.*from/i) && !text.match(/received.*from/i)) {
      console.log('⏭️  Not an incoming payment (no "received...from" pattern)');
      return null;
    }

    // Blacklist of common CSS/HTML terms that should not be names
    const blacklist = ['helvetica', 'arial', 'sans-serif', 'times new roman', 'courier', 'verdana', 'georgia'];

    // Try snippet first (GXBank format: "You've received RM15000.00 from Daneil Goh")
    const snippetPatterns = [
      /received\s+RM([\d,.]+)\s+from\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})/i,
      /from\s+([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)(?:\s+on\s+|\s+via\s+|\.|,|$)/i,
    ];

    for (const pattern of snippetPatterns) {
      const match = snippet.match(pattern);
      if (match) {
        let name, amount;

        // First pattern captures both amount and name
        if (pattern.source.includes('RM')) {
          amount = match[1];
          name = match[2];
        } else {
          // Second pattern only captures name, extract amount separately
          name = match[1];
          const amountMatch = snippet.match(/RM([\d,.]+)/i);
          amount = amountMatch ? amountMatch[1] : null;
        }

        if (name) {
          name = name.trim().replace(/[.,;!?]+$/, '');
          // Validate it's not a blacklisted term
          if (!blacklist.some(term => name.toLowerCase().includes(term))) {
            console.log('✅ Name extracted from snippet:', name);
            console.log('💰 Amount extracted:', amount);
            return { name, amount };
          }
        }
      }
    }

    // Try plain text patterns
    const textPatterns = [
      /received\s+RM([\d,.]+)\s+from\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})/i,
      /(?:payer|sender)[:\s]+([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)/i,
      /(?:name|account holder)[:\s]+([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)/i,
    ];

    for (const pattern of textPatterns) {
      const match = text.match(pattern);
      if (match) {
        let name, amount;

        // First pattern captures both amount and name
        if (pattern.source.includes('RM')) {
          amount = match[1];
          name = match[2];
        } else {
          // Other patterns only capture name, extract amount separately
          name = match[1];
          const amountMatch = text.match(/RM([\d,.]+)/i);
          amount = amountMatch ? amountMatch[1] : null;
        }

        if (name) {
          name = name.trim().replace(/[.,;!?]+$/, '');
          if (!blacklist.some(term => name.toLowerCase().includes(term))) {
            console.log('✅ Name extracted from text:', name);
            console.log('💰 Amount extracted:', amount);
            return { name, amount };
          }
        }
      }
    }

    console.log('❌ Could not extract payment name');
    return null;
  }

  startMonitoring(callback) {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    console.log('Starting Gmail API email monitoring...');

    const checkInterval = setInterval(async () => {
      if (!this.isMonitoring) {
        clearInterval(checkInterval);
        return;
      }

      try {
        const email = await this.checkForPayment();
        if (email) {
          const paymentName = this.extractPaymentName(email);
          callback(email, paymentName);
        }
      } catch (error) {
        console.error('Error in email monitoring:', error);
        // If token expired, try to refresh
        if (error.code === 401) {
          await this.refreshToken();
        }
      }
    }, this.config.checkEmailInterval || 1000);
  }

  stopMonitoring() {
    this.isMonitoring = false;
  }

  disconnect() {
    // Gmail API doesn't need explicit disconnection
    this.isMonitoring = false;
  }
}

export default EmailMonitor;
