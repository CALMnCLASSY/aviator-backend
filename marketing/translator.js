// marketing/translator.js
'use strict';

function translateToAgent(text) {
    if (!text) return '';
    let t = text;

    // 1. Specific standard header / block replacements for natural user feel
    t = t.replace(/🚀 \*AVIATOR PREDICTOR - NOW AVAILABLE GLOBALLY!\* 🌍/g, '🚀 *GUYS, THIS AVIATOR BOT IS LITERALLY INSANE!* 🌍');
    t = t.replace(/Did you know our AI-powered signals work across multiple countries/g, 'Seriously, this AI bot works in so many countries');
    t = t.replace(/We sync directly with the Aviator algorithms/g, 'It syncs directly with the Aviator algorithms');
    t = t.replace(/👉 \*Get your 24H Activation Code Now:\* avisignals.com/g, '👉 *Grab your 24H Activation Code here:* avisignals.com');
    
    t = t.replace(/🎰 \*PLAY AVIATOR\? WE SUPPORT YOUR FAVORITE SITE!\* 🎰/g, '🎰 *PLAY AVIATOR? THIS BOT WORKS ON ALMOST EVERY SITE!* 🎰');
    t = t.replace(/Our bot connects to the exact game environment/g, 'The bot connects to the exact game environment');
    t = t.replace(/Don't bet blind. Let our AI do the heavy lifting./g, 'Seriously, don\'t bet blind. Let the AI do the work.');
    t = t.replace(/👉 \*Choose your site & start winning:\* avisignals.com/g, '👉 *Get your activation code and start winning:* avisignals.com');
    
    t = t.replace(/💥 \*BOOM!\* Another massive (\d+(\.\d+)?x) multiplier accurately predicted! 🎯/g, '💥 *BOOM!* Just hit another massive $1 multiplier! 🎯');
    t = t.replace(/Users who activated their bot today are already swimming in profits./g, 'I activated my bot today and I\'m already making so much profit!');
    t = t.replace(/👉 \*Activate your bot here:\* avisignals.com/g, '👉 *Get your bot activation code here:* avisignals.com');

    t = t.replace(/🏆 \*Real member\. Real results\.\*/gi, '🏆 *Another win! Check this out.*');
    t = t.replace(/I started with (.+?) on (.+?)\. After (.+?) using AviSignals, I walked away with (.+?)\./gi, 'I started with $1 on $2. After $3 using this bot, I walked away with $4.');
    t = t.replace(/🚀 Start your own story — try the free trial to see it work/gi, '🚀 Try the free trial guys, it actually works');

    t = t.replace(/📡 \*Signal confirmed: (.+?)\*/gi, '📡 *OMG, the bot just hit a $1 multiplier!*');
    t = t.replace(/Our bot called it. Members who followed the signal cashed out at exactly the right moment./gi, 'The bot called it perfectly. I cashed out at exactly the right moment! 🎯');

    t = t.replace(/⏰ \*The (.+?) is LIVE right now\.\*/gi, '⏰ *Yo, the $1 is LIVE right now!*');
    t = t.replace(/Members are already using their codes. Don't miss today's rounds./gi, 'I\'m already using my code and winning. Don\'t miss out guys.');
    t = t.replace(/Want 24H access\? Get a premium code for \$75\./gi, 'Want 24H access? Grab a premium code for $75.');

    t = t.replace(/🎉 YOU WON! 💰/g, '🎉 I WON AGAIN! 💰');
    t = t.replace(/🚀 MEGA WIN! 🔥/g, '🚀 BOOM! MEGA WIN! 🔥');
    t = t.replace(/💰 PERFECT HIT! ✅/g, '💰 PERFECT HIT FOR ME! ✅');
    t = t.replace(/Success Rate: (\d+)%/gi, 'My Win Rate: $1%');
    t = t.replace(/Total Wins: (\d+)/gi, 'My Wins: $1');
    t = t.replace(/TODAY'S SUCCESS/g, 'MY RESULTS TODAY');
    t = t.replace(/One of our members just shared their results from today's session!/gi, 'Just wanted to share my results from today!');
    t = t.replace(/Real feedback from the chat\. Consistency is what separates the winners from the gamblers\./gi, 'Real results. Consistency is what makes this bot so good.');

    t = t.replace(/🎁 \*GIVEAWAY - FREE ACCESS CODE REVEALED!\* 🏆/g, '🎁 *OMG FREE CODE DROP!* 🏆');
    t = t.replace(/🔑 Code: `(.+?)`/g, '🔑 Code: `$1`');
    t = t.replace(/First person to use it get free bot predictions!/g, 'First person to use it gets free access! Let me know if you got it!');
    t = t.replace(/👉 Enter it on the app here: avisignals.com\/bot/g, '👉 Enter it here: avisignals.com/bot');

    t = t.replace(/🔴 \*LIVE session starting soon!\* Get your code ready\./g, '🔴 *Yo guys, live session is starting in 30 minutes!* I\'m getting my code ready.');
    t = t.replace(/⏳ \*10 MINUTES to go!\* Code users, log in now\./g, '⏳ *10 minutes left!* I\'m logging in now, get ready.');
    t = t.replace(/🟢 \*WE ARE LIVE!\* Today's session is OPEN/g, '🟢 *WE ARE LIVE!* Today\'s session is open, let\'s go play!');

    t = t.replace(/🌅 \*Good Morning Family!\* Today is a fresh opportunity to dominate/g, '🌅 *Good morning guys!* Let\'s dominate the Aviator charts again today.');
    t = t.replace(/🎯 \*Daily Target:\* We are aiming for/g, '🎯 *My Target:* I\'m aiming for');
    t = t.replace(/💡 \*Basic Rule:\* Split your bets/g, '💡 *My Strategy:* Split your bets');
    t = t.replace(/🤖 \*Make sure your bot dashboard is ready\.\*/g, '🤖 *Make sure you got your code ready\.*');
    t = t.replace(/Get daily codes or activate premium to lock in your predictions\./g, 'Get your daily codes or grab a premium pass.');
    
    t = t.replace(/🎰 \*Noon Session: Focus on (.+?)!\* 📈/gi, '🎰 *Playing on $1 now guys!* 📈');
    t = t.replace(/We are targeting (.+?)'s Aviator server/gi, 'I\'m targeting $1\'s Aviator server');
    t = t.replace(/Our algorithms are fully synced/gi, 'The bot is fully synced');

    t = t.replace(/💥 \*WHAT A DAY!\* Another highly profitable session in the books. Our members absolutely crushed it today! 💰/g, '💥 *WHAT A DAY!* Another highly profitable session. I absolutely crushed it today! 💰');
    t = t.replace(/Congrats to everyone who followed today's signals!/g, 'Congrats to everyone who played today!');
    t = t.replace(/Don't sleep on tomorrow's profits. Premium codes are selling fast. Buy your 24H or Weekly pass tonight/g, 'Don\'t sleep on tomorrow\'s profits. Grab your 24H or Weekly pass tonight like I did');

    // 2. Generic word/phrase replacements for user persona (case-insensitive where appropriate)
    t = t.replace(/\bour bot\b/gi, 'the bot I use');
    t = t.replace(/\bOur bot\b/gi, 'The bot I use');
    t = t.replace(/\bour predictor bot\b/gi, 'the predictor bot I use');
    t = t.replace(/\bOur predictor bot\b/gi, 'The predictor bot I use');
    t = t.replace(/\bour algorithms\b/gi, 'the algorithms');
    t = t.replace(/\bOur algorithms\b/gi, 'The algorithms');
    t = t.replace(/\bwe support\b/gi, 'it supports');
    t = t.replace(/\bWe support\b/gi, 'It supports');
    t = t.replace(/\bwe sync\b/gi, 'it syncs');
    t = t.replace(/\bWe sync\b/gi, 'It syncs');
    t = t.replace(/\bwe have\b/gi, 'they have');
    t = t.replace(/\bWe have\b/gi, 'They have');
    t = t.replace(/\bwe are\b/gi, 'I am');
    t = t.replace(/\bWe are\b/gi, 'I am');
    t = t.replace(/\bour members\b/gi, 'we');
    t = t.replace(/\bOur members\b/gi, 'We');
    t = t.replace(/\bmembers\b/gi, 'players');
    t = t.replace(/\buser\b/gi, 'player');
    t = t.replace(/\busers\b/gi, 'players');
    t = t.replace(/\bStop guessing\. Start predicting\./gi, 'Stop guessing and start winning like me.');
    t = t.replace(/\bVisit avisignals\.com\b/gi, 'Check out avisignals.com');
    t = t.replace(/\bUpgrade here:\b/gi, 'Get your code here:');
    t = t.replace(/\bBuy your 24H\b/gi, 'Grab your 24H');
    t = t.replace(/\bWho's ready for a big win\?\b/gi, 'Who\'s playing with me today?');

    return t;
}

module.exports = {
    translateToAgent
};
