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
        this.currentFlow = null;
        this.flowStep = 0;
        this.lastSignalTarget = null;
        this.lastSignalEntry = null;

        // Image and video queues for fair rotation (no repeats until all used)
        this.imageQueues = {}; // Per-category image queues
        this.videoQueue = [];
        this.totalMessagesSent = 0;

        // ====== ALL 18 VIDEOS with context-aware categories ======
        this.videoLibrary = [
            { file: 'howitworks.mp4', category: 'tutorial', caption_type: 'tutorial_video' },
            { file: 'botrunning.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'botworking.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'botworking2.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'marketingluckno.mp4', category: 'motivational', caption_type: 'motivational_video' },
            { file: 'marketingvid2.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid3.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid4.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid5.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid6.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid7.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid8.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid9.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid10.mp4.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid11.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid12.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid13.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid14.mp4', category: 'marketing', caption_type: 'marketing_video' },
        ];

        // ====== ALL 36 IMAGES mapped to context categories ======
        this.imageLibrary = {
            // Win proof screenshots (for win_results, celebration)
            win_proof: [
                'chatwinshot1.jpg', 'chatwinshot2.jpg', 'chatwinshot3.jpg', 'chatwinshot4.jpg',
                'chatwinshot5.jpg', 'chatwinshot6.jpg', 'chatwinshot7.jpg', 'chatwinshot8.jpg',
                'betikawinshot1.jpg', 'withdrawalwinshot.jpg',
                'win16.jpeg', 'win19.jpeg', 'win21.jpeg'
            ],
            // Bot/site screenshots (for promos, classy_promos)
            site_promo: [
                'avisignalsmainhome.jpg', 'avisignalsbotpage.jpg',
                'bothomepage.jpg', 'botshot.jpg'
            ],
            // Signal/prediction related (for signals, analysis_updates, signal_confirmations)
            signal_related: [
                'dailypredictions.jpg', 'roundnumber.jpg',
                'roundnumberbot.jpg', 'roundnumbergame.jpg'
            ],
            // Free trial promo (for free trial messaging)
            free_trial: [
                'getfreetrial.jpg', 'entercode.jpg'
            ],
            // Payment related (for payment promos)
            payment: [
                'payment.jpg', 'paymentmethods.jpg'
            ],
            // Hype / motivational (for hype, celebration)
            hype: [
                'gettheedge.jpeg', 'PROMOCODE.jpeg'
            ],
            // Feature showcase (for tips, promos)
            features: [
                'profitcalculator.jpg', 'profitcalculatorbase.jpg',
                'selectbsite.jpg', 'selectbettingsite.jpg',
                'securesiteentry.jpg', 'reviewexamples.jpg'
            ],
            // General marketing (fallback)
            general: [
                'marketing.jpg', 'marketingpic.jpg',
                'marketingpic2.jpg', 'marketingpic3.jpg'
            ]
        };

        // Map message types to preferred image categories
        this.messageTypeToImageCategory = {
            'win_results': ['win_proof'],
            'celebration': ['win_proof', 'hype'],
            'signals': ['signal_related', 'win_proof'],
            'signal_confirmations': ['signal_related'],
            'analysis_updates': ['signal_related', 'features'],
            'hype': ['hype', 'win_proof', 'general'],
            'classy_promos': ['site_promo', 'general', 'features'],
            'promos': ['general', 'site_promo', 'features'],
            'tips': ['features', 'general'],
            'free_trial': ['free_trial', 'site_promo'],
            'payment_promo': ['payment'],
            'social_proof': ['win_proof', 'features']
        };

        // Define logical message flows
        this.messageFlows = {
            // Immediate Signal Flow (analysis -> immediate signal)
            immediateSignal: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'signal_confirmations', weight: 1, delay: [0.25, 0.5] },
                { type: 'win_results', weight: 1, delay: [1.5, 2.5] },
                { type: 'celebration', weight: 0.7, delay: [0.5, 1] }
            ],

            // Immediate Cancellation Flow
            immediateCancellation: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'cancelled_signals', weight: 1, delay: [0.33, 0.67] },
                { type: 'analysis_updates', weight: 1, delay: [1, 2] },
                { type: 'classy_promos', weight: 0.8, delay: [2, 3] }
            ],

            // Premium Signal Flow
            premiumSignal: [
                { type: 'hype', weight: 1 },
                { type: 'signal_confirmations', weight: 1, delay: [2, 4] },
                { type: 'win_results', weight: 1, delay: [1, 3] },
                { type: 'celebration', weight: 0.7, delay: [0.5, 1] }
            ],

            // Free Signal Flow
            freeSignal: [
                { type: 'analysis_updates', weight: 1 },
                { type: 'signals', weight: 1, delay: [1, 2] },
                { type: 'tips', weight: 0.8, delay: [2, 3] },
                { type: 'classy_promos', weight: 0.9, delay: [1, 2] }
            ],

            // Educational Flow
            educational: [
                { type: 'tips', weight: 1 },
                { type: 'classy_promos', weight: 0.7, delay: [1, 2] },
                { type: 'promos', weight: 0.8, delay: [1, 2] }
            ],

            // Celebration Flow
            celebration: [
                { type: 'celebration', weight: 1 },
                { type: 'hype', weight: 0.8, delay: [0.5, 1] },
                { type: 'classy_promos', weight: 0.9, delay: [1, 2] }
            ],

            // Video Flow (sends a random video from the full library)
            videoPost: [
                { type: 'video', weight: 1 },
                { type: 'classy_promos', weight: 0.8, delay: [3, 5] }
            ],

            // Pure Marketing Flow
            marketing: [
                { type: 'classy_promos', weight: 1 },
                { type: 'promos', weight: 0.7, delay: [2, 4] }
            ],

            // Free Trial Promo Flow
            freeTrialPromo: [
                { type: 'free_trial', weight: 1 },
                { type: 'classy_promos', weight: 0.8, delay: [2, 3] }
            ],

            // Payment Promo Flow
            paymentPromo: [
                { type: 'payment_promo', weight: 1 },
                { type: 'promos', weight: 0.7, delay: [2, 3] }
            ],

            // Social Proof Flow
            socialProof: [
                { type: 'social_proof', weight: 1 },
                { type: 'classy_promos', weight: 0.9, delay: [2, 3] }
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
                categories: ['tips', 'hype', 'promos', 'betting_sites', 'classy_promos', 'free_trial', 'payment_promo', 'social_proof'],
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
        const sites = ['Betika', 'OdiBets', 'SportPesa', '1Win', 'Bet365', '1xBet', '22Bet', 'Betway', 'Melbet', 'Hollywoodbets', 'Parimatch', 'Stake'];
        const preferredSites = ['Betika', 'OdiBets', 'SportPesa', '1Win'];

        const siteList = Math.random() < 0.8 ? preferredSites : sites;
        const randomSite = this.randomFromArray(siteList);

        let processedMessage = message
            .replace(/{{site}}/g, randomSite)
            .replace(/{{link}}/g, 'classybetaviator.com')
            .replace(/{{accuracy}}/g, '98.72%');

        // Handle signal confirmation placeholders
        if (category === 'signal_confirmations') {
            const enterAt = (1.10 + Math.random() * 0.30).toFixed(2);
            const exitAt = (1.45 + Math.random() * 0.15).toFixed(2);

            this.lastSignalTarget = parseFloat(exitAt);
            this.lastSignalEntry = parseFloat(enterAt);

            processedMessage = processedMessage
                .replace(/{{enter_at}}/g, enterAt)
                .replace(/{{exit_at}}/g, exitAt);
        }

        // Handle win result placeholders
        if (category === 'win_results') {
            const targetExit = this.lastSignalTarget || (1.45 + Math.random() * 0.15);
            let result;
            const accuracyType = Math.random();

            if (accuracyType < 0.4) {
                result = targetExit.toFixed(2);
            } else if (accuracyType < 0.8) {
                const variance = (Math.random() - 0.5) * 0.10;
                result = Math.max(1.01, targetExit + variance).toFixed(2);
            } else {
                const bonus = 0.05 + Math.random() * 0.15;
                result = (targetExit + bonus).toFixed(2);
            }

            const wins = 3200 + Math.floor(Math.random() * 100);
            const accuracy = (97 + Math.random() * 2).toFixed(2);

            let bonusType = '';
            if (parseFloat(result) >= 10) bonusType = '10X+';
            else if (parseFloat(result) >= 5) bonusType = '5X+';
            else if (parseFloat(result) >= 3) bonusType = '3X+';

            processedMessage = processedMessage
                .replace(/{{result}}/g, result)
                .replace(/{{target}}/g, targetExit.toFixed(2))
                .replace(/{{target}}/g, targetExit)
                .replace(/{{wins}}/g, wins)
                .replace(/{{losses}}/g, '0')
                .replace(/{{accuracy}}/g, accuracy)
                .replace(/{{bonus_type}}/g, bonusType);
        }

        // Handle live updates
        if (category === 'live_updates') {
            const roundNumber = Math.floor(Math.random() * 10000) + 1000;
            processedMessage = processedMessage.replace(/{{round}}/g, roundNumber);
        }

        // 15% chance to add admin contact for non-win messages
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
                this.totalMessagesSent++;
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
                this.totalMessagesSent++;
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
                this.totalMessagesSent++;
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

    // ====== CONTEXT-AWARE IMAGE SELECTION ======
    getImageForCategory(messageType) {
        try {
            const imagesDir = path.join(__dirname, 'images');
            const preferredCategories = this.messageTypeToImageCategory[messageType] || ['general'];

            // Try each preferred category in order
            for (const category of preferredCategories) {
                const categoryImages = this.imageLibrary[category];
                if (!categoryImages || categoryImages.length === 0) continue;

                // Initialize queue for this category if needed
                if (!this.imageQueues[category] || this.imageQueues[category].length === 0) {
                    this.imageQueues[category] = [...categoryImages].sort(() => Math.random() - 0.5);
                }

                // Verify the file exists before returning
                const nextImage = this.imageQueues[category].shift();
                const imagePath = path.join(imagesDir, nextImage);
                if (fs.existsSync(imagePath)) {
                    console.log(`📸 Selected image: ${nextImage} (category: ${category}) for ${messageType}`);
                    return imagePath;
                }
            }

            // Fallback: pick any available image from general
            const generalImages = this.imageLibrary.general || [];
            if (generalImages.length > 0) {
                const fallback = this.randomFromArray(generalImages);
                const fallbackPath = path.join(imagesDir, fallback);
                if (fs.existsSync(fallbackPath)) return fallbackPath;
            }

            return null;
        } catch (error) {
            console.error('❌ Error getting image for category:', error);
            return null;
        }
    }

    // ====== VIDEO SELECTION (round-robin through all 18) ======
    getNextVideo() {
        try {
            // Refill queue when empty (shuffle for variety)
            if (this.videoQueue.length === 0) {
                this.videoQueue = [...this.videoLibrary].sort(() => Math.random() - 0.5);
                console.log('🔄 Video queue refilled and shuffled');
            }

            const videoEntry = this.videoQueue.shift();
            const videoPath = path.join(__dirname, videoEntry.file);

            if (fs.existsSync(videoPath)) {
                console.log(`🎥 Selected video: ${videoEntry.file} (${videoEntry.category})`);
                return videoEntry;
            } else {
                console.warn(`⚠️ Video file not found: ${videoEntry.file}, skipping...`);
                // Try the next one
                return this.videoQueue.length > 0 ? this.getNextVideo() : null;
            }
        } catch (error) {
            console.error('❌ Error getting next video:', error);
            return null;
        }
    }

    async sendTestMessage() {
        const message = "🧪 Test message from AviSignals Marketing Bot";
        return await this.sendToChannel(message);
    }

    async sendMarketingPost() {
        try {
            // NO daily limits — send signals freely

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

    startNewFlow() {
        const random = Math.random();
        let selectedFlow;

        // Flow selection weights — spread across all flow types
        // Ensure videos get sent frequently (target: 6-10 videos per day across ~96 posts)
        // That means ~8-10% of flows should be video flows
        if (random < 0.10) {
            selectedFlow = 'videoPost';
        } else if (random < 0.22) {
            selectedFlow = 'immediateSignal';
        } else if (random < 0.30) {
            selectedFlow = 'immediateCancellation';
        } else if (random < 0.42) {
            selectedFlow = 'premiumSignal';
        } else if (random < 0.54) {
            selectedFlow = 'freeSignal';
        } else if (random < 0.62) {
            selectedFlow = 'educational';
        } else if (random < 0.70) {
            selectedFlow = 'celebration';
        } else if (random < 0.78) {
            selectedFlow = 'marketing';
        } else if (random < 0.85) {
            selectedFlow = 'freeTrialPromo';
        } else if (random < 0.92) {
            selectedFlow = 'paymentPromo';
        } else {
            selectedFlow = 'socialProof';
        }

        console.log(`🎯 Starting new flow: ${selectedFlow} (message #${this.totalMessagesSent + 1})`);
        this.currentFlow = selectedFlow;
        this.flowStep = 0;

        return this.executeCurrentFlowStep();
    }

    async continueCurrentFlow() {
        console.log(`📈 Continuing ${this.currentFlow} flow - Step ${this.flowStep + 1}`);
        return await this.executeCurrentFlowStep();
    }

    async executeCurrentFlowStep() {
        const flow = this.messageFlows[this.currentFlow];
        const currentStep = flow[this.flowStep];

        // Check if we should execute this step based on weight
        if (Math.random() > currentStep.weight) {
            console.log(`⏭️ Skipping step ${this.flowStep} due to weight probability`);
            this.flowStep++;
            if (this.flowStep < flow.length) {
                setTimeout(() => this.executeCurrentFlowStep(), 1000);
                return true;
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
        // Next post scheduled by the main interval loop
    }

    async sendMessageForType(messageType) {
        try {
            // ====== VIDEO TYPE — Uses the full 18-video library ======
            if (messageType === 'video') {
                const videoEntry = this.getNextVideo();
                if (!videoEntry) {
                    console.warn('⚠️ No video available, sending text instead');
                    return await this.sendMessageForType('classy_promos');
                }

                const videoPath = path.join(__dirname, videoEntry.file);

                // Get caption based on video category
                const captionPool = this.messagePool[videoEntry.caption_type] || this.messagePool['marketing_video'] || [
                    "🎥 Watch and learn how to WIN BIG! 🚀\n\n💎 Visit avisignals.com for premium signals!\n🆓 FREE TRIAL available now!"
                ];
                const caption = this.processMessage(this.randomFromArray(captionPool), videoEntry.caption_type);

                console.log(`🎥 Sending video: ${videoEntry.file} (${videoEntry.category})`);
                return await this.sendVideoToChannel(videoPath, caption);
            }

            // ====== STANDARD MESSAGE TYPES ======
            let selectedMessages = this.messagePool[messageType];

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

            // Determine persona
            const useBot = ['signals', 'cancelled_signals', 'analysis_updates', 'signal_confirmations', 'win_results'].includes(messageType);
            const persona = useBot ? this.personas.bot : this.personas.trader;

            console.log(`📤 Sending ${messageType} message from ${persona.name}`);

            // ====== CONTEXT-AWARE IMAGE ATTACHMENT ======
            // 50% chance to attach a context-appropriate image for visual message types
            const visualTypes = [
                'hype', 'promos', 'celebration', 'win_results', 'classy_promos',
                'signals', 'signal_confirmations', 'tips', 'free_trial',
                'payment_promo', 'social_proof'
            ];
            const shouldSendImage = Math.random() < 0.50 && visualTypes.includes(messageType);

            if (shouldSendImage) {
                const imagePath = this.getImageForCategory(messageType);
                if (imagePath) {
                    let caption = processedMessage;
                    if (messageType !== 'signals' && persona) {
                        caption += `\n\n${persona.emoji} ${persona.name}`;
                    }
                    console.log('📸 Sending with context-matched image');
                    return await this.sendImageToChannel(imagePath, caption);
                }
            }

            // Send regular text message
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
        // Fixed 15-minute interval with ±2 min jitter for natural feel
        const baseDelay = 15 * 60 * 1000; // 15 minutes
        const jitter = (Math.random() - 0.5) * 4 * 60 * 1000; // ±2 minutes
        return Math.max(13 * 60 * 1000, baseDelay + jitter); // minimum 13 minutes
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
        console.log(`📊 Mode: UNLIMITED signals every ~15 minutes`);
        console.log(`🎥 Videos: ${this.videoLibrary.length} in rotation (target 6-10/day)`);
        console.log(`📸 Images: ${Object.values(this.imageLibrary).flat().length} mapped across ${Object.keys(this.imageLibrary).length} categories`);

        // Send first post immediately
        console.log('🚀 Sending immediate startup post...');
        this.sendMarketingPost();

        // Then schedule recurring posts
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
            totalMessagesSent: this.totalMessagesSent,
            videosAvailable: this.videoLibrary.length,
            imagesAvailable: Object.values(this.imageLibrary).flat().length,
            imageCategories: Object.keys(this.imageLibrary).length,
            postInterval: '~15 minutes',
            mode: 'UNLIMITED'
        };
    }
}

module.exports = TelegramMarketingBot;
