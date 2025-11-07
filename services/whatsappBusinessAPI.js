import axios from 'axios';

class WhatsAppBusinessAPI {
  constructor(accessToken, phoneNumberId) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.baseUrl = 'https://graph.facebook.com/v21.0';
  }

  async sendMessage(to, message) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Message sent to ${to}`);
      return response.data;
    } catch (error) {
      console.error('❌ Error sending message:', error.response?.data || error.message);
      throw error;
    }
  }

  async markAsRead(messageId) {
    try {
      await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('❌ Error marking message as read:', error.response?.data || error.message);
    }
  }

  parseWebhookMessage(webhookData) {
    try {
      const entry = webhookData.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (!messages || messages.length === 0) {
        return null;
      }

      const message = messages[0];
      const from = message.from;
      const messageId = message.id;
      const timestamp = message.timestamp;

      let body = '';
      if (message.type === 'text') {
        body = message.text?.body || '';
      } else if (message.type === 'button') {
        body = message.button?.text || '';
      } else if (message.type === 'interactive') {
        if (message.interactive?.type === 'button_reply') {
          body = message.interactive.button_reply?.title || '';
        } else if (message.interactive?.type === 'list_reply') {
          body = message.interactive.list_reply?.title || '';
        }
      }

      return {
        from,
        messageId,
        body,
        timestamp
      };
    } catch (error) {
      console.error('❌ Error parsing webhook message:', error);
      return null;
    }
  }

  verifyWebhook(mode, token, challenge, verifyToken) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ Webhook verified');
      return challenge;
    } else {
      console.log('❌ Webhook verification failed');
      return null;
    }
  }
}

export default WhatsAppBusinessAPI;
