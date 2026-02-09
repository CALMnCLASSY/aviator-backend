// marketing/telegramMarketing.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class TelegramMarketingBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = '-1002107223172';
        this.isRunning = false;
        this.messagePool = this.loadMessagePool();
        this.lastPostTime = 0;
        this.currentFlow = null; // Track current message flow
        this.flowStep = 0; // Track step in current flow
        this.lastSignalTarget = null; // Store last signal target for accurate results
        this.lastSignalEntry = null; // Store last signal entry point
        this.imageQueue = [];

        // Tracking metrics
        this.signalsToday = 0;
        this.messagesSentToday = 0;
        this.videoSentToday = false;
        this.lastDay = new Date().getDate();

        // Define logical message flows
        this.messageFlows = {
            // Immediate Signal Flow (analysis -> immediate signal)
            immediateSignal: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'signal_confirmations', weight: 1, delay: [0.25, 0.5] }, // 15-30 seconds
                { type: 'win_results', weight: 1, delay: [1.5, 2.5] }, // 90-150 seconds
                { type: 'celebration', weight: 0.7, delay: [0.5, 1] } // 30-60 seconds
            ],

            // Immediate Cancellation Flow (analysis -> immediate cancel)
            immediateCancellation: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'cancelled_signals', weight: 1, delay: [0.33, 0.67] }, // 20-40 seconds
                { type: 'analysis_updates', weight: 1, delay: [1, 2] }, // 60-120 seconds
                { type: 'classy_promos', weight: 0.8, delay: [2, 3] } // Follow up with promo
            ],

            // Premium Signal Flow (most common)
            premiumSignal: [
                { type: 'hype', weight: 1 },
                { type: 'signal_confirmations', weight: 1, delay: [2, 5] }, // 2-5 minutes
                { type: 'win_results', weight: 1, delay: [1, 3] }, // 1-3 minutes
                { type: 'celebration', weight: 0.7, delay: [0.5, 1] } // 30-60 seconds
            ],

            // Free Signal Flow
            freeSignal: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'signals', weight: 1, delay: [1, 3] },
                { type: 'tips', weight: 0.8, delay: [2, 4] },
                { type: 'classy_promos', weight: 0.9, delay: [1, 2] }
            ],

            // Educational Flow
            educational: [
                { type: 'tips', weight: 1 },
                { type: 'classy_promos', weight: 0.7, delay: [1, 2] },
                { type: 'promos', weight: 0.8, delay: [1, 3] }
            ],

            // Celebration Flow (after big wins)
            celebration: [
                { type: 'celebration', weight: 1 },
                { type: 'hype', weight: 0.8, delay: [0.5, 1] },
                { type: 'classy_promos', weight: 0.9, delay: [1, 2] }
            ],

            // Video Tutorial Flow
            videoTutorial: [
                { type: 'tutorial_video', weight: 1 },
                { type: 'classy_promos', weight: 0.8, delay: [5, 10] } // Follow up 5-10 mins later
            ],

            // Pure Marketing Flow
            marketing: [
                { type: 'classy_promos', weight: 1 },
                { type: 'promos', weight: 0.7, delay: [2, 5] }
            ]
        };

        this.personas = {
            bot: {
                name: "AviBot 🤖",
                categories: ['signals', 'cancelled_signals', 'analysis_updates', 'signal_confirmations', 'win_results'],
                emoji: "🤖"
            },
            trader: {
                name: "Pro Trader",
                categories: ['tips', 'hype', 'promos', 'betting_sites', 'classy_promos'],
                emoji: "💎"
            }
        };
    }

    loadMessagePool() {
        try {
            const poolPath = path.join(__dirname, 'messagePool.json');
            const data = fs.readFileSync(poolPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading message pool:', error);
            return {
                signals: ["🚀 Free Signal: Next round looking hot at x3.2 ✅"],
                tips: ["📊 Pro Tip: Always split stake between low (x2) and high (x10) odds."],
                promos: ["💜 Visit classybetaviator.com for premium predictions ✅"]
            };
        }
    }

    randomFromArray(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    processMessage(message, category = null) {
        // Updated to prioritize Kenyan betting sites
        const sites = ['Betika', 'OdiBets', 'SportPesa', '1Win', 'Bet365', '1xBet', '22Bet', 'Betway'];
        const preferredSites = ['Betika', 'OdiBets', 'SportPesa', '1Win'];

        // 80% chance to use preferred sites (Kenyan sites first)
        const siteList = Math.random() < 0.8 ? preferredSites : sites;
        const randomSite = this.randomFromArray(siteList);

        let processedMessage = message
            .replace(/{{site}}/g, randomSite)
            .replace(/{{link}}/g, 'classybetaviator.com')
            .replace(/{{accuracy}}/g, '98.72%');

        // Add betting site context for message types that need it
        if (['signals', 'signal_confirmations', 'win_results', 'site_promos'].includes(category)) {
            // Already handled by {{site}} placeholder in message templates
        }

        // Handle signal confirmation placeholders
        if (category === 'signal_confirmations') {
            const enterAt = (1.10 + Math.random() * 0.30).toFixed(2); // 1.10-1.40
            const exitAt = (1.45 + Math.random() * 0.15).toFixed(2);  // 1.45-1.60

            // Store the target for accurate win results later
            this.lastSignalTarget = parseFloat(exitAt);
            this.lastSignalEntry = parseFloat(enterAt);

            processedMessage = processedMessage
                .replace(/{{enter_at}}/g, enterAt)
                .replace(/{{exit_at}}/g, exitAt);
        }

        // Handle win result placeholders - Make results accurate to our predictions
        if (category === 'win_results') {
            const targetExit = this.lastSignalTarget || (1.45 + Math.random() * 0.15);
            let result;
            const accuracyType = Math.random();

            if (accuracyType < 0.4) {
                // Exact prediction hit (40% chance) - Shows perfect accuracy
                result = targetExit.toFixed(2);
            } else if (accuracyType < 0.8) {
                // Very close prediction (40% chance) - Within ±0.05x
                const variance = (Math.random() - 0.5) * 0.10; // ±0.05x variance
                result = Math.max(1.01, targetExit + variance).toFixed(2);
            } else {
                // Slightly over target but still profitable (20% chance)
                const bonus = 0.05 + Math.random() * 0.15; // +0.05x to +0.20x over target
                result = (targetExit + bonus).toFixed(2);
            }

            const wins = 3200 + Math.floor(Math.random() * 100);
            // Removed losses data - only showing wins for positive messaging
            const accuracy = (97 + Math.random() * 2).toFixed(2); // 97-99% accuracy

            let bonusType = '';
            if (parseFloat(result) >= 10) bonusType = '10X+';
            else if (parseFloat(result) >= 5) bonusType = '5X+';
            else if (parseFloat(result) >= 3) bonusType = '3X+';

            processedMessage = processedMessage
                .replace(/{{result}}/g, result)
                .replace(/{{target}}/g, targetExit.toFixed(2))
                .replace(/{{target}}/g, targetExit)
                .replace(/{{wins}}/g, wins)
                .replace(/{{losses}}/g, '0') // Always show 0 losses for positive messaging
                .replace(/{{accuracy}}/g, accuracy)
                .replace(/{{bonus_type}}/g, bonusType);
        }

        // Handle live updates with dynamic round numbers
        if (category === 'live_updates') {
            const roundNumber = Math.floor(Math.random() * 10000) + 1000;
            processedMessage = processedMessage.replace(/{{round}}/g, roundNumber);
        }

        // Randomly add admin contact link (15% chance for non-win messages)
        if (category !== 'win_results' && Math.random() < 0.15) {
            processedMessage += '\n\n💬 Questions? Contact admin: https://t.me/Aadmin4cnc';
        }

        return processedMessage;
    }

    async testConnection() {
        try {
            console.log('🔍 Testing Telegram connection...');
            const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
            const data = await response.json();

            if (data.ok) {
                console.log('✅ Bot connection successful:', data.result.username);
                return true;
            } else {
                console.error('❌ Bot connection failed:', data.description);
                return false;
            }
        } catch (error) {
            console.error('❌ Connection test error:', error.message);
            return false;
        }
    }

    async sendToChannel(messageData) {
        try {
            let finalMessage;
            if (typeof messageData === 'string') {
                finalMessage = messageData;
            } else {
                finalMessage = messageData.message;
                if (messageData.category !== 'signals' && messageData.persona) {
                    finalMessage += `\n\n${messageData.persona.emoji} ${messageData.persona.name}`;
                }
            }

            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            const payload = {
                chat_id: this.channelId,
                text: finalMessage,
                parse_mode: 'Markdown',
                disable_web_page_preview: false
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.ok) {
                console.log('✅ Message sent successfully');
                this.messagesSentToday++; // Increment daily counter
                return true;
            } else {
                console.error('❌ Failed to send message:', result.description);
                return false;
            }
        } catch (error) {
            console.error('❌ Error sending message:', error);
            return false;
        }
    }

    async sendImageToChannel(imagePath, caption) {
        try {
            const FormData = require('form-data');
            const form = new FormData();

            form.append('chat_id', this.channelId);
            form.append('photo', fs.createReadStream(imagePath));
            form.append('caption', caption);
            form.append('parse_mode', 'Markdown');

            const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
            const response = await fetch(url, {
                method: 'POST',
                body: form
            });

            const result = await response.json();

            if (result.ok) {
                console.log('✅ Image sent successfully');
                this.messagesSentToday++; // Increment daily counter
                return true;
            } else {
                console.error('❌ Failed to send image:', result.description);
                return false;
            }
        } catch (error) {
            console.error('❌ Error sending image:', error);
            return false;
        }
    }

    async sendVideoToChannel(videoPath, caption) {
        try {
            const FormData = require('form-data');
            const form = new FormData();

            form.append('chat_id', this.channelId);
            form.append('video', fs.createReadStream(videoPath));
            form.append('caption', caption);
            form.append('parse_mode', 'Markdown');

            const url = `https://api.telegram.org/bot${this.botToken}/sendVideo`;
            const response = await fetch(url, {
                method: 'POST',
                body: form
            });

            const result = await response.json();

            if (result.ok) {
                console.log('✅ Video sent successfully');
                this.messagesSentToday++; // Increment daily counter
                return true;
            } else {
                console.error('❌ Failed to send video:', result.description);
                return false;
            }
        } catch (error) {
            console.error('❌ Error sending video:', error);
            return false;
        }
    }

    refreshImageQueue(imageFiles) {
        this.imageQueue = [...imageFiles]
            .sort(() => Math.random() - 0.5);
    }

    getRandomImage() {
        try {
            const imagesDir = path.join(__dirname, 'images');
            const imageFiles = fs.readdirSync(imagesDir)
                .filter(file => file.endsWith('.svg') || file.endsWith('.jpeg') || file.endsWith('.jpg') || file.endsWith('.png'));

            if (imageFiles.length === 0) return null;

            this.imageQueue = this.imageQueue.filter(file => imageFiles.includes(file));

            if (this.imageQueue.length === 0) {
                this.refreshImageQueue(imageFiles);
            }

            const nextImage = this.imageQueue.shift();

            return path.join(imagesDir, nextImage);
        } catch (error) {
            console.error('❌ Error getting random image:', error);
            return null;
        }
    }

    async sendTestMessage() {
        const message = "🧪 Test message from AviSignals Marketing Bot";
        return await this.sendToChannel(message);
    }

    async sendMarketingPost() {
        try {
            // Check day change to reset counters
            const today = new Date().getDate();
            if (today !== this.lastDay) {
                console.log('📅 New day detected! Resetting counters.');
                this.signalsToday = 0;
                this.messagesSentToday = 0;
                this.videoSentToday = false;
                this.lastDay = today;
            }

            // Check hard limit on messages (max 20)
            if (this.messagesSentToday >= 20) {
                console.log('🛑 Daily message limit reached (20/20). Skipping post.');
                return false;
            }

            // Check if we're in the middle of a flow sequence
            if (this.currentFlow && this.flowStep < this.messageFlows[this.currentFlow].length) {
                return await this.continueCurrentFlow();
            }

            // Start a new flow sequence
            return await this.startNewFlow();
        } catch (error) {
            console.error('❌ Error sending marketing post:', error);
            return false;
        }
    }

    async startNewFlow() {
        // Determine which flow to start based on daily limits and priorities
        let selectedFlow;
        const random = Math.random();

        // Priority 1: Send daily video if not sent yet
        if (!this.videoSentToday) {
            selectedFlow = 'videoTutorial';
            console.log('🎥 Priority: Sending daily video tutorial');
        }
        // Priority 2: Manage signals (limit to 3 per day)
        else if (this.signalsToday < 3) {
            // High chance for signal checks if we haven't met quota
            if (random < 0.6) {
                // Pick a signal flow
                if (random < 0.2) selectedFlow = 'immediateSignal';
                else if (random < 0.3) selectedFlow = 'immediateCancellation';
                else if (random < 0.5) selectedFlow = 'premiumSignal';
                else selectedFlow = 'freeSignal';

                // Increment signal counter only for actual signal flows
                if (selectedFlow !== 'immediateCancellation') {
                    this.signalsToday++;
                    console.log(`📡 Signal allocated. Today: ${this.signalsToday}/3`);
                }
            } else {
                // Marketing filler
                selectedFlow = random < 0.8 ? 'educational' : 'marketing';
            }
        }
        // Priority 3: Only marketing/filler if signal quota met
        else {
            if (random < 0.4) selectedFlow = 'educational';
            else if (random < 0.7) selectedFlow = 'celebration';
            else selectedFlow = 'marketing';

            console.log('📊 quota met. Switching to marketing flows.');
        }

        console.log(`🎯 Starting new flow: ${selectedFlow}`);
        this.currentFlow = selectedFlow;
        this.flowStep = 0;

        return await this.executeCurrentFlowStep();
    }

    async continueCurrentFlow() {
        console.log(`📈 Continuing ${this.currentFlow} flow - Step ${this.flowStep + 1}`);
        return await this.executeCurrentFlowStep();
    }

    async executeCurrentFlowStep() {
        const flow = this.messageFlows[this.currentFlow];
        const currentStep = flow[this.flowStep];

        // Check if we should execute this step based on weight (probability)
        if (Math.random() > currentStep.weight) {
            console.log(`⏭️ Skipping step ${this.flowStep} due to weight probability`);
            this.flowStep++;
            if (this.flowStep < flow.length) {
                // Add small delay before next step to avoid slamming
                setTimeout(() => this.executeCurrentFlowStep(), 1000);
                return true;
            } else {
                return await this.completeFlow();
            }
        }

        // Send the message for this step
        const success = await this.sendMessageForType(currentStep.type);

        // Mark video as sent if this was the video step
        if (currentStep.type === 'tutorial_video' && success) {
            this.videoSentToday = true;
        }

        // Schedule next step if there is one
        this.flowStep++;
        if (this.flowStep < flow.length) {
            const nextStep = flow[this.flowStep];
            if (nextStep.delay) {
                const delayMinutes = nextStep.delay[0] + Math.random() * (nextStep.delay[1] - nextStep.delay[0]);
                const delayMs = delayMinutes * 60 * 1000;

                console.log(`⏰ Next step in ${delayMinutes.toFixed(1)} minutes`);
                setTimeout(() => {
                    if (this.isRunning) {
                        this.continueCurrentFlow();
                    }
                }, delayMs);
            }
        } else {
            await this.completeFlow();
        }

        if (success) this.lastPostTime = Date.now();
        return success;
    }

    async completeFlow() {
        console.log(`✅ Completed ${this.currentFlow} flow`);
        this.currentFlow = null;
        this.flowStep = 0;

        // Schedule next flow (normal interval)
        this.scheduleNextPost();
    }

    async sendMessageForType(messageType) {
        try {
            // Handle Video Type separately
            if (messageType === 'tutorial_video') {
                const videoPath = path.join(__dirname, 'howitworks.mp4');
                const messages = this.messagePool[messageType] || ["🎥 Watch our tutorial to win!"];
                const caption = this.randomFromArray(messages);

                console.log('🎥 Sending tutorial video');
                return await this.sendVideoToChannel(videoPath, caption);
            }

            // Handle standard message types
            let selectedMessages = this.messagePool[messageType];

            // Check if messages exist for this type
            if (!selectedMessages || selectedMessages.length === 0) {
                console.warn(`⚠️ No messages found for type: ${messageType}. Using fallback.`);
                selectedMessages = this.messagePool['promos'];
            }

            // 40% chance to use Kenyan-specific variants when available
            if (Math.random() < 0.4) {
                if (messageType === 'signals' && this.messagePool.kenyan_site_signals) {
                    selectedMessages = this.messagePool.kenyan_site_signals;
                } else if (messageType === 'site_promos' && this.messagePool.kenyan_site_promos) {
                    selectedMessages = this.messagePool.kenyan_site_promos;
                }
            }

            const message = this.randomFromArray(selectedMessages);
            const processedMessage = this.processMessage(message, messageType);

            // Determine persona based on message type
            const useBot = ['signals', 'cancelled_signals', 'analysis_updates', 'signal_confirmations', 'win_results'].includes(messageType);
            const persona = useBot ? this.personas.bot : this.personas.trader;

            console.log(`📤 Sending ${messageType} message from ${persona.name}`);

            // 20% chance to send with image for certain types (reduced to avoid spamming media)
            const shouldSendImage = Math.random() < 0.20 && ['hype', 'promos', 'celebration', 'win_results', 'classy_promos'].includes(messageType);

            if (shouldSendImage) {
                const imagePath = this.getRandomImage();
                if (imagePath) {
                    let caption = processedMessage;
                    if (messageType !== 'signals' && persona) {
                        caption += `\n\n${persona.emoji} ${persona.name}`;
                    }
                    console.log('📸 Sending with image');
                    return await this.sendImageToChannel(imagePath, caption);
                }
            }

            // Send regular message
            const messageData = {
                message: processedMessage,
                persona: persona,
                category: messageType
            };

            return await this.sendToChannel(messageData);
        } catch (error) {
            console.error(`❌ Error sending ${messageType} message:`, error);
            return false;
        }
    }

    getNextPostDelay() {
        // Updated interval: 30 to 90 minutes (User Requested)
        const minDelay = 30 * 60 * 1000;
        const maxDelay = 90 * 60 * 1000;
        return Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);
    }

    async start() {
        if (this.isRunning) {
            console.log('🤖 Marketing bot is already running');
            return;
        }

        console.log('🚀 Starting Telegram Marketing Bot...');
        const connected = await this.testConnection();
        if (!connected) {
            console.error('❌ Failed to start marketing bot');
            return;
        }

        this.isRunning = true;
        console.log('✅ Marketing bot started successfully');
        console.log(`📊 Daily Limits: Max 3 signals, ~20 total messages.`);

        // Send first post immediately (as requested)
        console.log('🚀 Sending immediate startup post...');
        this.sendMarketingPost();

        // Then schedule the next one
        this.scheduleNextPost();
    }

    scheduleNextPost() {
        if (!this.isRunning) return;

        const delay = this.getNextPostDelay();
        console.log(`⏰ Next marketing post in ${Math.round(delay / 60000)} minutes`);

        setTimeout(async () => {
            if (this.isRunning) {
                await this.sendMarketingPost();
                this.scheduleNextPost();
            }
        }, delay);
    }

    stop() {
        console.log('🛑 Stopping marketing bot...');
        this.isRunning = false;
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            lastPostTime: this.lastPostTime,
            messagesLoaded: Object.keys(this.messagePool).length,
            stats: {
                signals: this.signalsToday,
                messages: this.messagesSentToday,
                videoSent: this.videoSentToday
            }
        };
    }
}

module.exports = TelegramMarketingBot;
