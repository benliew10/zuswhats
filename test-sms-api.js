import axios from 'axios';

async function testSMSActivateAPI() {
  const apiKey = 'bb67d66c0A6b9Ae29233e0AA5251127c';
  const baseUrl = 'https://sms-activate.org/stubs/handler_api.php';

  console.log('Testing SMS Activate API with axios...\n');

  // Test 1: Get Balance
  console.log('Test 1: Get Balance');
  try {
    const balanceResponse = await axios.get(baseUrl, {
      params: {
        api_key: apiKey,
        action: 'getBalance'
      }
    });
    console.log('✅ Balance Response:', balanceResponse.data);
    console.log('   Response type:', typeof balanceResponse.data);
    console.log('   Response length:', balanceResponse.data?.length);
  } catch (error) {
    console.error('❌ Balance Error:', error.message);
  }

  // Test 2: Get Number WITHOUT responseType
  console.log('\nTest 2: Get Number (default axios)');
  try {
    const params = {
      api_key: apiKey,
      action: 'getNumber',
      service: 'aik',
      country: 7,
      operator: 'hotlink'
    };
    console.log('   URL:', `${baseUrl}?${new URLSearchParams(params).toString()}`);

    const response = await axios.get(baseUrl, { params });
    console.log('✅ Response:', response.data);
    console.log('   Response type:', typeof response.data);
    console.log('   Response length:', response.data?.length);
    console.log('   Raw response:', JSON.stringify(response.data));
  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  // Test 3: Get Number WITH responseType: 'text'
  console.log('\nTest 3: Get Number (responseType: text)');
  try {
    const params = {
      api_key: apiKey,
      action: 'getNumber',
      service: 'aik',
      country: 7,
      operator: 'hotlink'
    };

    const response = await axios.get(baseUrl, {
      params,
      responseType: 'text',
      headers: {
        'Accept': 'text/plain'
      }
    });
    console.log('✅ Response:', response.data);
    console.log('   Response type:', typeof response.data);
    console.log('   Response length:', response.data?.length);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testSMSActivateAPI();
