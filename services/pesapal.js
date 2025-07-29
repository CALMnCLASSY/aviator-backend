// services/pesapal.js
const axios = require('axios');
const qs = require('querystring');

// Use sandbox URL for testing, production URL for live
const PESAPAL_BASE_URL = process.env.PESAPAL_ENVIRONMENT === 'production' 
  ? 'https://pay.pesapal.com/v3' 
  : 'https://cybqa.pesapal.com/pesapalv3';

async function getAccessToken() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.post(
    `${PESAPAL_BASE_URL}/api/Auth/RequestToken`,
    {},
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.token;
}

async function createOrder({ amount, currency, description, callbackUrl, reference, email, phone }) {
  const token = await getAccessToken();
  const payload = {
    id: reference,
    currency,
    amount,
    description,
    callback_url: callbackUrl,
    notification_id: reference,
    billing_address: {
      email_address: email,
      phone_number: phone,
      country_code: 'KE',
    },
  };
  const response = await axios.post(
    `${PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

async function getOrderStatus(orderTrackingId) {
  const token = await getAccessToken();
  const response = await axios.get(
    `${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  return response.data;
}

module.exports = {
  getAccessToken,
  createOrder,
  getOrderStatus,
};
