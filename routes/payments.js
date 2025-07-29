// routes/payments.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('paypal-rest-sdk');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pesapal = require('../services/pesapal');

// Configure PayPal
paypal.configure({
  'mode': process.env.PAYPAL_MODE || 'live',
  'client_id': process.env.PAYPAL_CLIENT_ID,
  'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// ==================== PESAPAL PAYMENT ROUTES ====================

// Create Pesapal Order (Card & Mobile Money)
router.post('/pesapal/create-order', async (req, res) => {
  try {
    const { amount, email, phone, packageName, timeSlot, bettingSite } = req.body;
    const reference = uuidv4();
    const description = `Aviator Prediction Package - ${packageName}`;
    const callbackUrl = process.env.PESAPAL_CALLBACK_URL;
    const currency = 'USD';
    
    // Store payment metadata temporarily 
    const paymentData = {
      reference,
      email,
      packageName,
      timeSlot,
      bettingSite,
      amount,
      timestamp: new Date()
    };
    
    // For now, store in memory (in production, use Redis or database)
    global.pendingPayments = global.pendingPayments || {};
    global.pendingPayments[reference] = paymentData;

    const order = await pesapal.createOrder({
      amount: parseFloat(amount),
      currency,
      description,
      callbackUrl,
      reference,
      email,
      phone: phone || '254700000000' // Default phone if not provided
    });
    
    res.json({ 
      redirectUrl: order.redirect_url, 
      orderTrackingId: order.order_tracking_id,
      reference 
    });
    
  } catch (error) {
    console.error('Pesapal order error:', error);
    res.status(500).json({ error: 'Failed to create Pesapal order', details: error.message });
  }
});

// Pesapal Callback Handler
router.post('/pesapal/callback', async (req, res) => {
  try {
    const { orderTrackingId } = req.body;
    console.log('Pesapal callback received:', req.body);
    
    const status = await pesapal.getOrderStatus(orderTrackingId);
    console.log('Pesapal payment status:', status);
    
    if (status.payment_status_description === 'Completed') {
      // Find the payment data by reference
      const paymentData = global.pendingPayments && global.pendingPayments[status.merchant_reference];
      
      if (paymentData) {
        await handleSuccessfulPayment({
          email: paymentData.email,
          packageName: paymentData.packageName,
          timeSlot: paymentData.timeSlot,
          bettingSite: paymentData.bettingSite
        });
        
        // Clean up temporary storage
        delete global.pendingPayments[status.merchant_reference];
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Pesapal callback error:', error);
    res.status(500).json({ error: 'Pesapal callback failed' });
  }
});

// Check Pesapal Payment Status
router.get('/pesapal/status/:orderTrackingId', async (req, res) => {
  try {
    const { orderTrackingId } = req.params;
    const status = await pesapal.getOrderStatus(orderTrackingId);
    res.json(status);
  } catch (error) {
    console.error('Pesapal status check error:', error);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// ==================== PAYPAL PAYMENT ROUTES ====================

// Store for PayPal payment metadata (use Redis or database in production)
global.paypalPayments = global.paypalPayments || {};

// Create PayPal Payment
router.post('/paypal/create-payment', async (req, res) => {
  try {
    const { amount, email, packageName, timeSlot, bettingSite } = req.body;
    const reference = uuidv4();

    // Store payment metadata
    global.paypalPayments[reference] = {
      amount,
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date()
    };

    const create_payment_json = {
      "intent": "sale",
      "payer": {
        "payment_method": "paypal"
      },
      "redirect_urls": {
        "return_url": `${process.env.BASE_URL}/api/payments/paypal/success?reference=${reference}`,
        "cancel_url": `${process.env.BASE_URL}/api/payments/paypal/cancel?reference=${reference}`
      },
      "transactions": [{
        "item_list": {
          "items": [{
            "name": packageName,
            "sku": "001",
            "price": amount.toString(),
            "currency": "USD",
            "quantity": 1
          }]
        },
        "amount": {
          "currency": "USD",
          "total": amount.toString()
        },
        "description": `Aviator Prediction Package - ${packageName}`,
        "custom": reference
      }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
      if (error) {
        console.error('PayPal payment creation error:', error);
        res.status(500).json({ error: 'Failed to create PayPal payment' });
      } else {
        const approvalUrl = payment.links.find(link => link.rel === 'approval_url').href;
        res.json({ 
          approvalUrl, 
          paymentId: payment.id,
          reference
        });
      }
    });

  } catch (error) {
    console.error('PayPal payment error:', error);
    res.status(500).json({ error: 'Failed to create PayPal payment' });
  }
});

// PayPal Success Handler
router.get('/paypal/success', async (req, res) => {
  try {
    const { paymentId, PayerID, reference } = req.query;
    
    // Get stored payment data
    const paymentData = global.paypalPayments[reference];
    if (!paymentData) {
      throw new Error('Payment data not found');
    }

    const execute_payment_json = {
      "payer_id": PayerID,
      "transactions": [{
        "amount": {
          "currency": "USD",
          "total": paymentData.amount.toString()
        }
      }]
    };

    paypal.payment.execute(paymentId, execute_payment_json, async function (error, payment) {
      if (error) {
        console.error('PayPal execution error:', error);
        res.redirect(`${process.env.FRONTEND_URL}?payment=failed`);
      } else {
        // Handle successful payment
        await handleSuccessfulPayment({
          email: paymentData.email,
          packageName: paymentData.packageName,
          timeSlot: paymentData.timeSlot,
          bettingSite: paymentData.bettingSite
        });
        
        // Clean up stored data
        delete global.paypalPayments[reference];
        
        res.redirect(`${process.env.FRONTEND_URL}?payment=success`);
      }
    });

  } catch (error) {
    console.error('PayPal success handler error:', error);
    res.redirect(`${process.env.FRONTEND_URL}?payment=failed`);
  }
});

// PayPal Cancel Handler
router.get('/paypal/cancel', (req, res) => {
  const { reference } = req.query;
  if (reference && global.paypalPayments[reference]) {
    delete global.paypalPayments[reference];
  }
  res.redirect(`${process.env.FRONTEND_URL}?payment=cancelled`);
});

// ==================== PERSONAL CRYPTO WALLET ROUTES ====================

// Personal Crypto Wallet Payment
router.post('/crypto/personal/create-order', async (req, res) => {
    try {
        console.log('🪙 Creating crypto order with data:', req.body);
        const { amount, email, packageName, timeSlot, currency, bettingSite } = req.body;
        
        const walletAddresses = {
            BTC: process.env.BTC_ADDRESS,
            USDT: process.env.USDT_ADDRESS
        };
        
        console.log('🔑 Wallet addresses check:', { 
            BTC: !!process.env.BTC_ADDRESS, 
            USDT: !!process.env.USDT_ADDRESS,
            requestedCurrency: currency 
        });
        
        if (!walletAddresses[currency]) {
            console.log('❌ Unsupported currency:', currency);
            return res.status(400).json({ 
                success: false, 
                error: `Unsupported currency: ${currency}` 
            });
        }
        
        // Generate unique order ID
        const orderId = `CRYPTO_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Calculate crypto amount 
        let cryptoAmount;
        let network;
        
        if (currency === 'BTC') {
            // Example: $1 = 0.000025 BTC 
            cryptoAmount = (amount * 0.000029).toFixed(8);
            network = 'Bitcoin Network';
        } else if (currency === 'USDT') {
            // USDT is usually 1:1 with USD
            cryptoAmount = amount.toFixed(2);
            network = 'Tron Network (TRC20)';
        }
        
        // Store payment metadata temporarily
        global.cryptoPayments = global.cryptoPayments || {};
        global.cryptoPayments[orderId] = {
            amount: cryptoAmount,
            currency,
            email,
            packageName,
            timeSlot,
            bettingSite,
            walletAddress: walletAddresses[currency],
            timestamp: new Date(),
            status: 'pending'
        };
        
        // Log the order for manual verification
        console.log(`🚨 NEW CRYPTO ORDER:`, {
            orderId,
            amount: cryptoAmount,
            currency,
            email,
            packageName,
            timeSlot,
            bettingSite,
            walletAddress: walletAddresses[currency]
        });
        
        res.json({
            success: true,
            orderId,
            walletAddress: walletAddresses[currency],
            amount: cryptoAmount,
            currency,
            network,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
            qrData: `${currency.toLowerCase()}:${walletAddresses[currency]}?amount=${cryptoAmount}`
        });
        
    } catch (error) {
        console.error('Crypto order creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route to manually confirm payment by user
router.post('/crypto/personal/confirm/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { transactionHash, userEmail } = req.body;
        
        // Get stored payment data
        const paymentData = global.cryptoPayments && global.cryptoPayments[orderId];
        if (!paymentData) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }
        
        // Update payment status to pending verification
        paymentData.status = 'pending_verification';
        paymentData.transactionHash = transactionHash;
        paymentData.confirmedAt = new Date();
        
        console.log(`✅ PAYMENT CONFIRMATION RECEIVED:`, {
            orderId,
            email: paymentData.email,
            amount: paymentData.amount,
            currency: paymentData.currency,
            transactionHash: transactionHash || 'No hash provided',
            packageName: paymentData.packageName,
            timeSlot: paymentData.timeSlot,
            bettingSite: paymentData.bettingSite
        });
        
        // Store payment data for Telegram verification
        const telegramStoreResponse = await fetch(`${process.env.BASE_URL}/api/telegram/store-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId,
                paymentData: {
                    email: paymentData.email,
                    packageName: paymentData.packageName,
                    timeSlot: paymentData.timeSlot,
                    bettingSite: paymentData.bettingSite,
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    transactionHash: transactionHash || 'No hash provided',
                    walletAddress: paymentData.walletAddress
                }
            })
        });

        // Send Telegram notification with verification buttons
        const telegramMessage = `💰 ${paymentData.email} confirmed ${paymentData.currency} payment for ${paymentData.packageName}
📦 Package: ${paymentData.packageName}
⏰ Time Slot: ${paymentData.timeSlot}
� Amount: ${paymentData.amount} ${paymentData.currency}
🆔 Order ID: ${orderId}
🔗 TX Hash: ${transactionHash || 'Not provided'}
🏦 Wallet: ${paymentData.walletAddress}
🎰 Betting Site: ${paymentData.bettingSite}`;

        // Send notification with verification buttons
        const telegramResponse = await fetch(`${process.env.BASE_URL}/api/telegram/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: telegramMessage,
                orderId: orderId,
                includeVerificationButtons: true
            })
        });
        
        res.json({
            success: true,
            status: 'pending_verification',
            message: 'Payment confirmation submitted. Manual verification in progress.'
        });
        
    } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin route to manually verify payment (call this after checking blockchain or paybill)
router.post('/crypto/personal/verify/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { verified } = req.body;
        
        console.log(`🔍 VERIFICATION REQUEST RECEIVED:`, { 
            orderId, 
            verified, 
            hasGlobalPayments: !!global.cryptoPayments,
            hasGlobalPendingPayments: !!global.pendingPayments,
            paymentExists: !!(global.cryptoPayments && global.cryptoPayments[orderId]),
            paybillExists: !!(global.pendingPayments && global.pendingPayments[orderId])
        });
        
        let paymentData;
        
        // Check in crypto payments first
        if (global.cryptoPayments && global.cryptoPayments[orderId]) {
            paymentData = global.cryptoPayments[orderId];
        } 
        // Check in paybill payments (pendingPayments)
        else if (orderId.startsWith('PAYBILL_') && global.pendingPayments && global.pendingPayments[orderId]) {
            paymentData = global.pendingPayments[orderId];
        }
        
        if (!paymentData) {
            console.log(`❌ ORDER NOT FOUND:`, { 
                orderId, 
                availableCryptoOrders: Object.keys(global.cryptoPayments || {}),
                availablePaybillOrders: Object.keys(global.pendingPayments || {})
            });
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }
        
        if (verified) {
            console.log(`✅ PROCESSING VERIFICATION for order ${orderId}...`);
            
            // Process successful payment
            await handleSuccessfulPayment({
                email: paymentData.email,
                packageName: paymentData.packageName,
                timeSlot: paymentData.timeSlot,
                bettingSite: paymentData.bettingSite
            });
            
            paymentData.status = 'verified';
            paymentData.verifiedAt = new Date();
            
            console.log(`✅ PAYMENT VERIFIED:`, { orderId, email: paymentData.email, status: paymentData.status });
            
            // Send success notification to customer via email (optional)
            // You can implement email sending here if needed
            
        } else {
            paymentData.status = 'rejected';
            console.log(`❌ PAYMENT REJECTED:`, { orderId, email: paymentData.email });
        }
        
        res.json({ success: true, status: paymentData.status });
        
    } catch (error) {
        console.error('Manual payment verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check payment status (crypto, paybill, etc.) - Universal status endpoint
router.get('/crypto/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        let paymentData = null;
        let paymentMethod = 'unknown';
        
        // Determine payment method based on orderId prefix
        if (orderId.startsWith('PAYBILL_')) {
            paymentMethod = 'paybill';
            
            // Import the pendingPayments Map from telegram routes
            const telegramRoutes = require('./telegram');
            if (telegramRoutes.pendingPayments && telegramRoutes.pendingPayments.has(orderId)) {
                const pendingData = telegramRoutes.pendingPayments.get(orderId);
                paymentData = {
                    status: pendingData.status || 'pending_verification',
                    email: pendingData.email,
                    packageName: pendingData.packageName,
                    amount: pendingData.amount,
                    currency: 'USD',
                    timestamp: pendingData.timestamp || new Date(),
                    phone: pendingData.phone,
                    paymentMethod: 'paybill'
                };
            }
            
            // Also check global.pendingPayments as fallback
            if (!paymentData) {
                const globalPending = global.pendingPayments || {};
                const globalData = globalPending[orderId];
                if (globalData) {
                    paymentData = {
                        status: globalData.status || 'pending_verification',
                        email: globalData.email,
                        packageName: globalData.packageName,
                        amount: globalData.amount,
                        currency: 'USD',
                        timestamp: globalData.timestamp || new Date(),
                        phone: globalData.phone,
                        paymentMethod: 'paybill'
                    };
                }
            }
        } else {
            // Check crypto payments
            paymentMethod = 'crypto';
            paymentData = global.cryptoPayments && global.cryptoPayments[orderId];
            
            if (paymentData) {
                paymentData.paymentMethod = 'crypto';
            }
        }
        
        if (!paymentData) {
            return res.json({ 
                success: false, 
                status: 'not_found',
                message: `Payment order ${orderId} not found`,
                paymentMethod 
            });
        }
        
        // Standardized response for all payment methods
        res.json({
            success: true,
            orderId,
            status: paymentData.status || 'pending_verification',
            email: paymentData.email,
            packageName: paymentData.packageName,
            amount: paymentData.amount,
            currency: paymentData.currency || 'USD',
            timestamp: paymentData.timestamp,
            paymentMethod: paymentData.paymentMethod || paymentMethod,
            message: getStatusMessage(paymentData.status, paymentData.paymentMethod || paymentMethod)
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ 
            success: false, 
            status: 'error',
            message: 'Unable to check payment status. Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Helper function to get user-friendly status messages
function getStatusMessage(status, paymentMethod) {
    const messages = {
        pending_verification: {
            crypto: 'Please wait while we verify your crypto payment...',
            paybill: 'Please wait while we verify your M-Pesa payment...',
            default: 'Please wait while we verify your payment...'
        },
        verified: {
            crypto: 'Your crypto payment has been verified successfully!',
            paybill: 'Your M-Pesa payment has been verified successfully!',
            default: 'Your payment has been verified successfully!'
        },
        rejected: {
            crypto: 'Your crypto payment verification was unsuccessful. Please contact support.',
            paybill: 'Your M-Pesa payment verification was unsuccessful. Please contact support.',
            default: 'Your payment verification was unsuccessful. Please contact support.'
        }
    };
    
    const statusMessages = messages[status] || messages.pending_verification;
    return statusMessages[paymentMethod] || statusMessages.default;
}

// ==================== SHARED PAYMENT HANDLER ====================

async function handleSuccessfulPayment(metadata) {
  try {
    const { email, packageName, timeSlot, bettingSite } = metadata;

    // Update user payment status
    const user = await User.findOneAndUpdate(
      { email },
      { 
        paymentVerified: true,
        paymentDate: new Date(),
        packageName,
        timeSlot,
        bettingSite
      },
      { new: true, upsert: true }
    );

    // Send notification to Telegram (optional)
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramNotification(email, packageName);
    }

    // Generate and store predictions
    await generatePredictions(user);

    console.log(`Payment verified for ${email}. Predictions unlocked!`);
    return user;

  } catch (error) {
    console.error('Payment handling error:', error);
    throw error;
  }
}

// ==================== UTILITY FUNCTIONS ====================

async function sendTelegramNotification(email, packageName) {
  try {
    const message = `🎉 New Payment Confirmed!\n\nEmail: ${email}\nPackage: ${packageName}\nTime: ${new Date().toLocaleString()}`;
    
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message
    });
  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}

async function generatePredictions(user) {
  try {
    // Generate predictions based on package
    const predictions = generatePredictionMultipliers(user.packageName);
    
    // Store predictions (you might want to add a Predictions model)
    user.predictions = predictions;
    user.predictionTime = new Date();
    await user.save();

    return predictions;
  } catch (error) {
    console.error('Prediction generation error:', error);
    throw error;
  }
}

function generatePredictionMultipliers(packageName) {
  const match = packageName.match(/^(\d+)x/i);
  const targetMultiplier = match ? parseInt(match[1]) : 2;
  const predictions = [];
  
  // Generate 5 predictions (3 close to target, 2 random)
  for (let i = 0; i < 3; i++) {
    const variance = Math.random() * 0.5 - 0.25; // +/- 25%
    const multiplier = Math.max(1.1, targetMultiplier + variance);
    predictions.push(parseFloat(multiplier.toFixed(2)));
  }
  
  // Add 2 random predictions
  for (let i = 0; i < 2; i++) {
    const randomMultiplier = Math.random() * 10 + 1.1;
    predictions.push(parseFloat(randomMultiplier.toFixed(2)));
  }
  
  return predictions.sort((a, b) => b - a); // Sort descending
}

// Test Telegram notification
router.post('/test-telegram', async (req, res) => {
  try {
    const { message } = req.body;
    const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await axios.post(telegramUrl, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

    res.json({ 
      success: true, 
      message: 'Telegram test message sent successfully',
      telegramResponse: response.data
    });

  } catch (error) {
    console.error('Telegram test error:', error);
    res.status(500).json({ error: 'Telegram test failed', details: error.message });
  }
});

// Demo payment verification (for testing)
router.post('/demo/verify-payment', async (req, res) => {
  try {
    const { email, packageName, timeSlot, bettingSite } = req.body;

    const user = await handleSuccessfulPayment({
      email,
      packageName,
      timeSlot,
      bettingSite
    });

    res.json({ 
      success: true, 
      message: 'Demo payment verified successfully',
      user,
      predictions: user.predictions
    });

  } catch (error) {
    console.error('Demo payment verification error:', error);
    res.status(500).json({ error: 'Demo payment verification failed' });
  }
});

// Universal payment success handler (for frontend to call after successful verification)
router.post('/payment-success', async (req, res) => {
  try {
    const { orderId, email, packageName, timeSlot, bettingSite, paymentMethod } = req.body;
    
    if (!orderId || !email || !packageName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: orderId, email, packageName' 
      });
    }

    // Process the successful payment
    const user = await handleSuccessfulPayment({
      email,
      packageName,
      timeSlot,
      bettingSite
    });

    // Clean up payment data from storage
    if (orderId.startsWith('PAYBILL_')) {
      const telegramRoutes = require('./telegram');
      if (telegramRoutes.pendingPayments && telegramRoutes.pendingPayments.has(orderId)) {
        telegramRoutes.pendingPayments.delete(orderId);
      }
      
      if (global.pendingPayments && global.pendingPayments[orderId]) {
        delete global.pendingPayments[orderId];
      }
    } else {
      if (global.cryptoPayments && global.cryptoPayments[orderId]) {
        delete global.cryptoPayments[orderId];
      }
    }

    res.json({ 
      success: true, 
      message: `Payment completed successfully via ${paymentMethod}!`,
      user: {
        email: user.email,
        packageName: user.packageName,
        paymentVerified: user.paymentVerified,
        paymentDate: user.paymentDate
      },
      predictions: user.predictions,
      redirect: '/dashboard' // Frontend can use this to redirect user
    });

  } catch (error) {
    console.error('Payment success handler error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process payment success. Please contact support.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;