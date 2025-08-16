// marketing/telegramMarketing.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class TelegramMarketingBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN || '7688438027:AAFNnge7_oADfxCwCMm2XZGSH1hG2Q0rZfE';
        this.channelId = '-1002107223172';
        this.isRunning = false;
        this.messagePool = this.loadMessagePool();
        this.lastPostTime = 0;
        this.currentFlow = null; // Track current message flow
        this.flowStep = 0; // Track step in current flow
        
        // Define logical message flows
        this.messageFlows = {
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
                { type: 'promos', weight: 0.9, delay: [1, 2] }
            ],
            
            // Cancelled Signal Flow (realistic)
            cancelledSignal: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'hype', weight: 0.8, delay: [1, 2] },
                { type: 'cancelled_signals', weight: 1, delay: [2, 4] },
                { type: 'analysis_updates', weight: 1, delay: [3, 5] },
                { type: 'signal_confirmations', weight: 0.9, delay: [5, 8] }
            ],
            
            // Educational Flow
            educational: [
                { type: 'tips', weight: 1 },
                { type: 'site_promos', weight: 0.7, delay: [1, 2] },
                { type: 'promos', weight: 0.8, delay: [1, 3] }
            ],
            
            // Celebration Flow (after big wins)
            celebration: [
                { type: 'celebration', weight: 1 },
                { type: 'hype', weight: 0.8, delay: [0.5, 1] },
                { type: 'promos', weight: 0.9, delay: [1, 2] }
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
                categories: ['tips', 'hype', 'promos', 'betting_sites'],
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
                promos: ["💜 Visit avisignals.com for premium predictions ✅"]
            };
        }
    }

    randomFromArray(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    processMessage(message, category = null) {
        const sites = ['1Win', 'Bet365', '1xBet', '22Bet', 'Betway', 'SportPesa'];
        const preferredSites = ['1Win', 'Bet365', '1xBet', '22Bet'];
        const siteList = Math.random() < 0.7 ? preferredSites : sites;
        const randomSite = this.randomFromArray(siteList);
        
        let processedMessage = message
            .replace(/{{site}}/g, randomSite)
            .replace(/{{link}}/g, 'avisignals.com')
            .replace(/{{accuracy}}/g, '98.72%');
        
        // Add betting site context for message types that need it
        if (['signals', 'signal_confirmations', 'win_results', 'site_promos'].includes(category)) {
            // Already handled by {{site}} placeholder in message templates
        }
        
        // Handle signal confirmation placeholders
        if (category === 'signal_confirmations') {
            const enterAt = (1.10 + Math.random() * 0.30).toFixed(2); // 1.10-1.40
            const exitAt = (1.45 + Math.random() * 0.15).toFixed(2);  // 1.45-1.60
            processedMessage = processedMessage
                .replace(/{{enter_at}}/g, enterAt)
                .replace(/{{exit_at}}/g, exitAt);
        }
        
        // Handle win result placeholders
        if (category === 'win_results') {
            const targetExit = (1.45 + Math.random() * 0.15).toFixed(2); // 1.45-1.60
            let result;
            const winType = Math.random();
            
            if (winType < 0.7) {
                // Normal win (target + 0.1 to 2.0)
                result = (parseFloat(targetExit) + 0.1 + Math.random() * 1.9).toFixed(2);
            } else if (winType < 0.9) {
                // Good win (3x-8x)
                result = (3 + Math.random() * 5).toFixed(2);
            } else {
                // Mega win (10x+)
                result = (10 + Math.random() * 15).toFixed(2);
            }
            
            const wins = 3200 + Math.floor(Math.random() * 100);
            const losses = 40 + Math.floor(Math.random() * 10);
            const accuracy = ((wins / (wins + losses)) * 100).toFixed(2);
            
            let bonusType = '';
            if (parseFloat(result) >= 10) bonusType = '10X+';
            else if (parseFloat(result) >= 5) bonusType = '5X+';
            else if (parseFloat(result) >= 3) bonusType = '3X+';
            
            processedMessage = processedMessage
                .replace(/{{result}}/g, result)
                .replace(/{{target}}/g, targetExit)
                .replace(/{{wins}}/g, wins)
                .replace(/{{losses}}/g, losses)
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

    getRandomImage() {
        try {
            const imagesDir = path.join(__dirname, 'images');
            const imageFiles = fs.readdirSync(imagesDir)
                .filter(file => file.endsWith('.jpeg') || file.endsWith('.jpg') || file.endsWith('.png'));
            
            if (imageFiles.length === 0) return null;
            
            const randomImage = this.randomFromArray(imageFiles);
            return path.join(imagesDir, randomImage);
        } catch (error) {
            console.error('❌ Error getting random image:', error);
            return null;
        }
    }

    async sendTestMessage() {
        const message = "🧪 Test message from AviSignals Marketing Bot";
        return await this.sendToChannel(message);
    }

    selectMessageData() {
        const useBot = Math.random() < 0.4;
        const persona = useBot ? this.personas.bot : this.personas.trader;
        
        const availableCategories = persona.categories.filter(cat => 
            this.messagePool[cat] && this.messagePool[cat].length > 0
        );
        
        const category = this.randomFromArray(availableCategories);
        const message = this.randomFromArray(this.messagePool[category]);
        
        return {
            persona,
            category,
            message: this.processMessage(message)
        };
    }

    async sendMarketingPost() {
        try {
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
        // Determine which flow to start based on probabilities
        const random = Math.random();
        let selectedFlow;
        
        if (random < 0.35) {
            selectedFlow = 'premiumSignal'; // 35% - Most engaging
        } else if (random < 0.55) {
            selectedFlow = 'freeSignal'; // 20% - Regular content
        } else if (random < 0.70) {
            selectedFlow = 'cancelledSignal'; // 15% - Realistic cancelled signals
        } else if (random < 0.85) {
            selectedFlow = 'educational'; // 15% - Tips and education
        } else {
            selectedFlow = 'celebration'; // 15% - Celebration content
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
                return await this.executeCurrentFlowStep();
            } else {
                return await this.completeFlow();
            }
        }
        
        // Send the message for this step
        const success = await this.sendMessageForType(currentStep.type);
        
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
            const message = this.randomFromArray(this.messagePool[messageType]);
            const processedMessage = this.processMessage(message, messageType);
            
            // Determine persona based on message type
            const useBot = ['signals', 'cancelled_signals', 'analysis_updates', 'signal_confirmations', 'win_results'].includes(messageType);
            const persona = useBot ? this.personas.bot : this.personas.trader;
            
            console.log(`📤 Sending ${messageType} message from ${persona.name}`);
            
            // 25% chance to send with image for certain types
            const shouldSendImage = Math.random() < 0.25 && ['hype', 'promos', 'celebration'].includes(messageType);
            
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

    async sendSignalSequence() {
        try {
            console.log('🎭 Sending realistic signal sequence...');
            
            // Send cancelled signal
            const cancelledMessage = this.randomFromArray(this.messagePool.cancelled_signals);
            await this.sendToChannel({
                message: cancelledMessage,
                persona: this.personas.bot,
                category: 'cancelled_signals'
            });
            
            // Wait 2-3 minutes, then send analysis update
            setTimeout(async () => {
                const analysisMessage = this.randomFromArray(this.messagePool.analysis_updates);
                await this.sendToChannel({
                    message: analysisMessage,
                    persona: this.personas.bot,
                    category: 'analysis_updates'
                });
            }, 120000 + Math.random() * 60000); // 2-3 minutes
            
            // Wait another 3-5 minutes, then send new signal
            setTimeout(async () => {
                const signalMessage = this.randomFromArray(this.messagePool.signals);
                await this.sendToChannel({
                    message: this.processMessage(signalMessage),
                    persona: this.personas.bot,
                    category: 'signals'
                });
            }, 300000 + Math.random() * 120000); // 5-7 minutes total
            
            this.lastPostTime = Date.now();
            return true;
        } catch (error) {
            console.error('❌ Error sending signal sequence:', error);
            return false;
        }
    }
    
    async sendSignalWinSequence() {
        try {
            console.log('🏆 Sending signal + win sequence...');
            
            // Step 1: Send signal confirmation
            const confirmationMessage = this.randomFromArray(this.messagePool.signal_confirmations);
            await this.sendToChannel({
                message: this.processMessage(confirmationMessage, 'signal_confirmations'),
                persona: this.personas.bot,
                category: 'signal_confirmations'
            });
            
            // Wait 30-90 seconds before sending win result
            const delay = 30000 + Math.random() * 60000; // 30-90 seconds
            setTimeout(async () => {
                try {
                    const winMessage = this.randomFromArray(this.messagePool.win_results);
                    await this.sendToChannel({
                        message: this.processMessage(winMessage, 'win_results') + 
                                '\n\n💬 Need help? Contact admin: https://t.me/Aadmin4cnc',
                        persona: this.personas.bot,
                        category: 'win_results'
                    });
                } catch (error) {
                    console.error('❌ Error sending win result:', error);
                }
            }, delay);
            
            this.lastPostTime = Date.now();
            return true;
        } catch (error) {
            console.error('❌ Error sending signal win sequence:', error);
            return false;
        }
    }

    getNextPostDelay() {
        const minDelay = 30 * 60 * 1000; // 30 minutes
        const maxDelay = 60 * 60 * 1000; // 60 minutes
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
            messagesLoaded: Object.keys(this.messagePool).length
        };
    }
}

module.exports = TelegramMarketingBot;
