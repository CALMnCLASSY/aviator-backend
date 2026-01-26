const express = require('express');
const router = express.Router();

// Simulation State
let lastRoundId = Date.now();
const history = [];

// Generate a random multiplier (Aviator logic simulation)
function generateMultiplier() {
    // fast crash probability 
    if (Math.random() < 0.3) return (1.00 + Math.random() * 0.1).toFixed(2);
    
    // normal distribution simulation
    const r = Math.random();
    let mult;
    if (r < 0.6) {
        mult = 1.0 + Math.random(); // 1x - 2x
    } else if (r < 0.85) {
        mult = 2.0 + Math.random() * 3; // 2x - 5x
    } else if (r < 0.95) {
        mult = 5.0 + Math.random() * 5; // 5x - 10x
    } else {
        mult = 10.0 + Math.random() * 90; // 10x - 100x (rare)
    }
    return parseFloat(mult.toFixed(2));
}

// Populate initial history
for (let i = 0; i < 20; i++) {
    history.push({
        roundId: lastRoundId - (i * 30000),
        multiplier: generateMultiplier(),
        timestamp: new Date(Date.now() - (i * 30000)).toISOString()
    });
}

// Get Round Config
router.get('/config', (req, res) => {
    res.json({
        roundDurationMs: 30000, // 30 seconds
        serverTime: new Date().toISOString()
    });
});

// Get Round State/History
router.get('/state', (req, res) => {
    // Generate new round if needed (simulation)
    const now = Date.now();
    const latest = history[0];
    const latestTime = new Date(latest.timestamp).getTime();
    
    if (now - latestTime > 30000) {
        const newRound = {
            roundId: now,
            multiplier: generateMultiplier(),
            timestamp: new Date().toISOString()
        };
        history.unshift(newRound);
        if (history.length > 50) history.pop();
    }

    res.json({
        serverTime: new Date().toISOString(),
        rounds: history
    });
});

module.exports = router;
