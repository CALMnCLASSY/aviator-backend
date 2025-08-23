// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true 
  },
  packageName: { 
    type: String, 
    required: true 
  }, // e.g., "2x Prediction Package"
  timeSlot: { 
    type: String, 
    required: true 
  }, // e.g., "14:00"
  bettingSite: { 
    type: String, 
    required: true 
  }, // e.g., "1xBet"
  paymentVerified: { 
    type: Boolean, 
    default: false 
  },
  paymentDate: {
    type: Date,
    required: false
  },
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'selar', 'demo'],
    required: false
  },
  paymentAmount: {
    type: Number,
    required: false
  },
  predictionTime: {
    type: Date,
    default: Date.now
  },
  predictions: [{
    type: Number
  }],
  predictionCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  telegramChatId: String, // For notifications
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual to check if predictions are still valid (24 hours)
userSchema.virtual('isPredictionValid').get(function() {
  if (!this.paymentVerified || !this.predictionTime) return false;
  
  const now = new Date();
  const predictionExpiry = new Date(this.predictionTime);
  predictionExpiry.setHours(predictionExpiry.getHours() + 24);
  
  return now < predictionExpiry;
});

// Method to get remaining prediction time
userSchema.methods.getRemainingTime = function() {
  if (!this.paymentVerified || !this.predictionTime) return 0;
  
  const now = new Date();
  const predictionExpiry = new Date(this.predictionTime);
  predictionExpiry.setHours(predictionExpiry.getHours() + 24);
  
  return Math.max(0, predictionExpiry - now);
};

module.exports = mongoose.model('User', userSchema);