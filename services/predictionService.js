// services/predictionService.js

/**
 * Generate predictions for aviator game
 * @param {string} packageName - The prediction package name (e.g., "5x Prediction Package")
 * @returns {Array} Array of prediction objects
 */
function generatePredictions(packageName) {
  // Extract multiplier from package name
  const multiplierMatch = packageName.match(/(\d+)x/i);
  const targetMultiplier = multiplierMatch ? parseInt(multiplierMatch[1]) : 5;
  
  const predictions = [];
  const predictionCount = 5; // Generate 5 predictions
  
  for (let i = 0; i < predictionCount; i++) {
    // Generate predictions around the target multiplier with some variance
    let multiplier;
    
    if (targetMultiplier <= 2) {
      // For low multipliers, stay close to target
      multiplier = Math.random() < 0.8 
        ? (1.5 + Math.random() * 1).toFixed(2) 
        : (targetMultiplier + Math.random() * 0.5).toFixed(2);
    } else if (targetMultiplier <= 10) {
      // For medium multipliers, mix of low and target
      multiplier = Math.random() < 0.6 
        ? (1.2 + Math.random() * 3).toFixed(2)
        : (targetMultiplier * 0.7 + Math.random() * targetMultiplier * 0.6).toFixed(2);
    } else {
      // For high multipliers, mostly lower with occasional high
      if (Math.random() < 0.7) {
        multiplier = (1.2 + Math.random() * 8).toFixed(2);
      } else {
        multiplier = (targetMultiplier * 0.5 + Math.random() * targetMultiplier * 0.8).toFixed(2);
      }
    }
    
    predictions.push({
      id: `AV-${Date.now()}-${i}`,
      multiplier: parseFloat(multiplier),
      confidence: Math.floor(85 + Math.random() * 12), // 85-97% confidence
      timestamp: new Date(),
      status: 'pending'
    });
  }
  
  return predictions;
}

/**
 * Get prediction status based on time slot
 * @param {string} timeSlot - The selected time slot
 * @returns {string} Status of predictions
 */
function getPredictionStatus(timeSlot) {
  const now = new Date();
  const [hours, minutes] = timeSlot.split(':').map(Number);
  const slotTime = new Date();
  slotTime.setHours(hours, minutes, 0, 0);
  
  if (now >= slotTime) {
    return 'ready';
  } else {
    return 'waiting';
  }
}

/**
 * Validate if predictions can be revealed
 * @param {Object} user - User object with payment and time slot info
 * @returns {boolean} Whether predictions can be revealed
 */
function canRevealPredictions(user) {
  if (!user.paymentVerified) {
    return false;
  }
  
  const status = getPredictionStatus(user.timeSlot);
  return status === 'ready';
}

module.exports = {
  generatePredictions,
  getPredictionStatus,
  canRevealPredictions
};
