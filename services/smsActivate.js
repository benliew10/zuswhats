import axios from 'axios';

class SMSActivate {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://sms-activate.org/stubs/handler_api.php';
    this.activeNumber = null;
    this.activationId = null;
  }

  async getBalance() {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          action: 'getBalance'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error getting balance:', error);
      throw error;
    }
  }

  async getNumber(country = 0, service = 'wa', operator = null) {
    try {
      const params = {
        api_key: this.apiKey,
        action: 'getNumber',
        service: service,
        country: country
      };

      // Add operator filter if specified
      if (operator) {
        params.operator = operator;
        console.log(`📱 Requesting number with operator filter: ${operator}`);
      }

      console.log(`📱 SMS Activate API Request: country=${country}, service=${service}, operator=${operator}`);
      console.log(`📱 Full API URL: ${this.baseUrl}?${new URLSearchParams(params).toString()}`);

      const response = await axios.get(this.baseUrl, {
        params,
        responseType: 'text',
        headers: {
          'Accept': 'text/plain'
        }
      });

      console.log(`📱 Response status: ${response.status}`);
      console.log(`📱 Response headers:`, response.headers);
      console.log(`📱 Response data type: ${typeof response.data}`);
      console.log(`📱 Response data length: ${response.data?.length}`);

      const data = response.data;
      console.log(`📱 SMS Activate API Response: "${data}"`);

      if (data.includes('ACCESS_NUMBER')) {
        const parts = data.split(':');
        this.activationId = parts[1];
        this.activeNumber = parts[2];
        console.log(`✅ Number obtained: ${this.activeNumber} (Activation ID: ${this.activationId})`);
        return {
          activationId: this.activationId,
          number: this.activeNumber
        };
      } else {
        // Decode common SMS Activate error codes
        let errorMessage = data;
        if (data === 'NO_NUMBERS') {
          errorMessage = 'No numbers available for this country/service/operator';
        } else if (data === 'NO_BALANCE') {
          errorMessage = 'Insufficient balance in SMS Activate account';
        } else if (data === 'BAD_KEY') {
          errorMessage = 'Invalid SMS Activate API key';
        } else if (data === 'BAD_ACTION') {
          errorMessage = 'Invalid API action';
        } else if (data === 'BAD_SERVICE') {
          errorMessage = 'Invalid service code';
        }
        throw new Error(`SMS Activate API Error: ${errorMessage}`);
      }
    } catch (error) {
      console.error('❌ SMS Activate getNumber error:', error.message);
      throw error;
    }
  }

  async getStatus(activationId) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          action: 'getStatus',
          id: activationId
        }
      });

      const data = response.data;
      
      if (data.includes('STATUS_OK')) {
        const code = data.split(':')[1];
        return {
          status: 'ok',
          code: code
        };
      } else if (data.includes('STATUS_WAIT_CODE')) {
        return {
          status: 'waiting'
        };
      } else if (data.includes('STATUS_CANCEL')) {
        return {
          status: 'cancelled'
        };
      } else {
        return {
          status: 'unknown',
          message: data
        };
      }
    } catch (error) {
      console.error('Error getting status:', error);
      throw error;
    }
  }

  async setStatus(activationId, status) {
    // status: 1 = ready, 3 = cancel, 6 = finish
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          action: 'setStatus',
          status: status,
          id: activationId
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error setting status:', error);
      throw error;
    }
  }

  async waitForCode(activationId, maxWaitTime = 300000, checkInterval = 2000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkCode = setInterval(async () => {
        try {
          const status = await this.getStatus(activationId);
          
          if (status.status === 'ok') {
            clearInterval(checkCode);
            resolve(status.code);
          } else if (status.status === 'cancelled') {
            clearInterval(checkCode);
            reject(new Error('Activation cancelled'));
          } else if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkCode);
            reject(new Error('Timeout waiting for code'));
          }
        } catch (error) {
          clearInterval(checkCode);
          reject(error);
        }
      }, checkInterval);
    });
  }

  async releaseNumber(activationId) {
    try {
      // Set status to cancel (3) to release the number
      await this.setStatus(activationId, 3);
      this.activeNumber = null;
      this.activationId = null;
      return true;
    } catch (error) {
      console.error('Error releasing number:', error);
      throw error;
    }
  }
}

export default SMSActivate;

