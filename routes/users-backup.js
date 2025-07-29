// routes/users.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Simple file-based logging instead of MongoDB
const logUserData = (data) => {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `users-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('📝 User data logged:', data);
};

// Save user data (email, packageName, etc.)
router.post('/', async (req, res) => {
  try {
    const { email, packageName, timeSlot, bettingSite } = req.body;

    // Validate required fields
    if (!email || !packageName) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and package name are required' 
      });
    }

    const userData = {
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date().toISOString(),
      id: Date.now().toString() // Simple ID generation
    };

    // Log to file (backup to Telegram notifications)
    logUserData(userData);

    // Return success (Telegram will have the actual data)
    res.status(201).json({ 
      success: true,
      message: 'User data received and logged successfully',
      data: userData,
      note: 'Data logged locally and sent to Telegram for processing'
    });

  } catch (err) {
    console.error('Error in user route:', err);
    
    // Still log the data even if there's an error
    const { email, packageName, timeSlot, bettingSite } = req.body;
    logUserData({
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date().toISOString(),
      error: err.message
    });
    
    res.status(500).json({ 
      success: false,
      error: 'Server error',
      message: err.message
    });
  }
});

// Get user by email
router.get('/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Error getting user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user predictions
router.get('/:email/predictions', async (req, res) => {
  try {
    const { email } = req.params;
    const predictions = await predictionService.getUserPredictions(email);
    
    res.json({ 
      success: true, 
      predictions: predictions.predictions,
      packageName: predictions.packageName,
      timeSlot: predictions.timeSlot,
      bettingSite: predictions.bettingSite,
      remainingTime: predictions.remainingTime,
      generatedAt: predictions.generatedAt
    });
  } catch (err) {
    console.error('Error getting predictions:', err);
    res.status(400).json({ error: err.message });
  }
});

// Check if user has valid predictions
router.get('/:email/predictions/status', async (req, res) => {
  try {
    const { email } = req.params;
    const hasValid = await predictionService.hasValidPredictions(email);
    
    res.json({ 
      hasValidPredictions: hasValid,
      email: email
    });
  } catch (err) {
    console.error('Error checking prediction status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user information
router.put('/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const updateData = req.body;
    
    // Remove email from update data to prevent modification
    delete updateData.email;
    
    const user = await User.findOneAndUpdate(
      { email },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user payment status
router.get('/:email/payment-status', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      paymentVerified: user.paymentVerified,
      paymentDate: user.paymentDate,
      paymentMethod: user.paymentMethod,
      paymentAmount: user.paymentAmount,
      packageName: user.packageName,
      timeSlot: user.timeSlot,
      bettingSite: user.bettingSite
    });
  } catch (err) {
    console.error('Error getting payment status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users (admin only - add authentication later)
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}).select('-__v').sort({ createdAt: -1 });
    res.json({ users, count: users.length });
  } catch (err) {
    console.error('Error getting users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;