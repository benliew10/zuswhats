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

  async sendListMessage(to, bodyText, buttonText, sections) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: to,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: bodyText },
            action: {
              button: buttonText,
              sections: sections
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ List message sent to ${to}`);
      return response.data;
    } catch (error) {
      console.error('❌ Error sending list message:', error.response?.data || error.message);
      throw error;
    }
  }

  async deleteMessage(to, messageId) {
    try {
      await axios.delete(
        `${this.baseUrl}/${this.phoneNumberId}/messages/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );
      console.log(`✅ Message ${messageId} deleted`);
    } catch (error) {
      console.error('❌ Error deleting message:', error.response?.data || error.message);
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
      let interactiveId = null;

      if (message.type === 'text') {
        body = message.text?.body || '';
      } else if (message.type === 'button') {
        body = message.button?.text || '';
      } else if (message.type === 'interactive') {
        if (message.interactive?.type === 'button_reply') {
          body = message.interactive.button_reply?.title || '';
          interactiveId = message.interactive.button_reply?.id || null;
        } else if (message.interactive?.type === 'list_reply') {
          body = message.interactive.list_reply?.title || '';
          interactiveId = message.interactive.list_reply?.id || null;
        }
      }

      return {
        from,
        messageId,
        body,
        interactiveId,
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
