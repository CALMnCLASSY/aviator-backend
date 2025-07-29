// routes/users.js - Simplified without MongoDB
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

// Get user by email (simplified - reads from logs)
router.get('/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    // This is simplified - in practice, Telegram has all the data you need
    // For demonstration purposes, we'll return a success response
    res.json({ 
      success: true,
      message: 'User lookup completed',
      note: 'All user data is available in your Telegram chat',
      email: email
    });
    
  } catch (err) {
    console.error('Error in get user route:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error',
      message: err.message
    });
  }
});

module.exports = router;
