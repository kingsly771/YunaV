const axios = require('axios');
require('dotenv').config();

/**
 * WhatsApp OTP Service
 * Supports Meta Cloud API and Twilio WhatsApp
 */

// Generate a numeric OTP
function generateOTP(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10);
  }
  return otp;
}

// Normalize phone number to E.164
function normalizePhone(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (!cleaned.startsWith('+')) {
    // Add + if not present
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * Send OTP via Meta WhatsApp Cloud API
 */
async function sendViaMetaAPI(phone, otp) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    throw new Error('WhatsApp Cloud API credentials not configured');
  }

  const normalizedPhone = normalizePhone(phone).replace('+', '');

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizedPhone,
    type: 'text',
    text: {
      body: `🎉 *YUNAV-HBDCHAT* 🎂\n\nYour verification code is:\n\n*${otp}*\n\nThis code expires in 10 minutes.\nDo not share this code with anyone.`
    }
  };

  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${phoneId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

/**
 * Send OTP via Twilio WhatsApp
 */
async function sendViaTwilio(phone, otp) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio credentials not configured');
  }

  const twilio = require('twilio')(accountSid, authToken);
  const normalizedPhone = normalizePhone(phone);

  const message = await twilio.messages.create({
    from: fromNumber,
    to: `whatsapp:${normalizedPhone}`,
    body: `🎉 *YUNAV-HBDCHAT* 🎂\n\nYour verification code is: *${otp}*\n\nExpires in 10 minutes. Do not share.`
  });

  return message;
}

/**
 * Main: send OTP to a phone number
 */
async function sendOTP(phone, otp) {
  // Try Meta API first, fallback to Twilio
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    return sendViaMetaAPI(phone, otp);
  } else if (process.env.TWILIO_ACCOUNT_SID) {
    return sendViaTwilio(phone, otp);
  } else {
    // DEV MODE: log OTP to console if no API configured
    console.log(`\n🔑 [DEV MODE] OTP for ${phone}: ${otp}\n`);
    return { dev_mode: true, otp };
  }
}

module.exports = { generateOTP, normalizePhone, sendOTP };
