import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PersistentAuthStrategy {
  constructor({ mongoUrl, dbName = 'whatsapp_bot' }) {
    this.mongoUrl = mongoUrl;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
    this.collection = null;
    this.localAuthPath = path.join(process.cwd(), '.wwebjs_auth');
  }

  async connect() {
    if (!this.mongoUrl) {
      console.log('⚠️  No MongoDB URI provided, using local file storage');
      return false;
    }

    try {
      this.client = new MongoClient(this.mongoUrl);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection('whatsapp_sessions');
      console.log('✅ Connected to MongoDB for session storage');
      return true;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      console.log('⚠️  Falling back to local file storage');
      return false;
    }
  }

  async beforeBrowserInitialized() {
    const connected = await this.connect();
    if (!connected) {
      // Ensure local auth directory exists
      if (!fs.existsSync(this.localAuthPath)) {
        fs.mkdirSync(this.localAuthPath, { recursive: true });
      }
    }
  }

  async getAuthData() {
    try {
      if (this.collection) {
        // Use MongoDB
        const session = await this.collection.findOne({ _id: 'default' });
        if (session && session.data) {
          return session.data;
        }
      } else {
        // Use local file storage
        const sessionPath = path.join(this.localAuthPath, 'session');
        if (fs.existsSync(sessionPath)) {
          const files = fs.readdirSync(sessionPath);
          const authData = {};
          for (const file of files) {
            const filePath = path.join(sessionPath, file);
            const content = fs.readFileSync(filePath, 'utf8');
            authData[file] = content;
          }
          return authData;
        }
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting auth data:', error.message);
      return null;
    }
  }

  async setAuthData(authData) {
    try {
      if (this.collection) {
        // Use MongoDB
        await this.collection.updateOne(
          { _id: 'default' },
          { $set: { data: authData, updatedAt: new Date() } },
          { upsert: true }
        );
      } else {
        // Use local file storage
        const sessionPath = path.join(this.localAuthPath, 'session');
        if (!fs.existsSync(sessionPath)) {
          fs.mkdirSync(sessionPath, { recursive: true });
        }
        for (const [key, value] of Object.entries(authData)) {
          const filePath = path.join(sessionPath, key);
          fs.writeFileSync(filePath, value);
        }
      }
    } catch (error) {
      console.error('❌ Error setting auth data:', error.message);
    }
  }

  async logout() {
    try {
      if (this.collection) {
        await this.collection.deleteOne({ _id: 'default' });
      } else {
        const sessionPath = path.join(this.localAuthPath, 'session');
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        }
      }
      console.log('✅ Session logged out');
    } catch (error) {
      console.error('❌ Error logging out:', error.message);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('✅ MongoDB disconnected');
    }
  }
}

export default PersistentAuthStrategy;

