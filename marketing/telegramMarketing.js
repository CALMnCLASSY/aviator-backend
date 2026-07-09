// marketing/telegramMarketing.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

class TelegramMarketingBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID || '-1002107223172';
        this.isRunning = false;
        this.messagePool = this.loadMessagePool();
        this.lastPostTime = 0;
        this.currentFlow = null;
        this.flowStep = 0;
        this.lastSignalTarget = null;
        this.lastSignalEntry = null;

        // Channel template rotation index (cycles through 0, 1, 2)
        this.channelTemplateIndex = 0;
        this.channelTemplates = [
            // Template 1: Global Reach & Available Countries
            `🚀 *AVIATOR PREDICTOR - NOW AVAILABLE GLOBALLY!* 🌍\n\nDid you know our AI-powered signals work across multiple countries with localized payment support? Stop losing and start winning today!\n\n✅ *Supported Regions & Currencies:*\n🇪🇺 Europe: Euro (€), GBP (£), PLN (zł), RON (lei), SEK (kr), TRY (₺)\n🌍 Middle East: AED, SAR, QAR\n🌎 Americas: USD ($), CAD (C$), BRL (R$), MXN ($), COP ($), CLP ($)\n🌍 Africa: KES (KSh), NGN (₦), ZAR (R), GHS (GH₵), TZS (TSh) ...and more!\n\n🎯 We sync directly with the Aviator algorithms in your region.\n🔒 Secure payments. 100% automated activation.\n\n👉 *Get your 24H Activation Code Now:* avisignals.com\n💬 Need help? Contact Admin: https://t.me/Aadmin4cnc\n\n#AviatorSignals #AviatorPredictor #MakeMoneyOnline #StakeAviator #1WinAviator`,

            // Template 2: Supported Betting Sites
            `🎰 *PLAY AVIATOR? WE SUPPORT YOUR FAVORITE SITE!* 🎰\n\nOur bot connects to the exact game environment of your betting platform to give you precise cash-out signals.\n\n✅ *Works Perfectly On:*\n🔸 Betano • Stake • 1xBet • SportyBet\n🔸 Unibet • LeoVegas • 888casino\n🔸 Pin-Up • Melbet • Betway • Roobet\n🔸 MozzartBet • Betika • BetWinner\n🔸 ...and over 30+ other global platforms!\n\nDon't bet blind. Let our AI do the heavy lifting. Pick your site, enter your activation code, and wait for the signal! 📈💸\n\n👉 *Choose your site & start winning:* avisignals.com\n🔥 Join thousands of profitable players today.\n\n#AviatorSignals #AviatorPredictor #StakeAviator #1WinAviator #CrashGame`,

            // Template 3: Proof of Win / Urgency
            `💥 *BOOM!* Another massive 15x multiplier accurately predicted! 🎯\n\nUsers who activated their bot today are already swimming in profits. What are you waiting for?\n\n✅ Global Support (Europe, Middle East, Africa, Americas)\n✅ Works on Stake, Betano, 1xBet, Unibet & more!\n✅ Pay easily with Crypto (USDT), Card, or Mobile Money\n\nStop guessing. Start predicting.\n👉 *Activate your bot here:* avisignals.com\n\n#AviatorSignals #AviatorPredictor #WinBig #CrashGame`
        ];

        // Image and video queues for fair rotation (no repeats until all used)
        this.imageQueues = {}; // Per-category image queues
        this.videoQueue = [];
        this.totalMessagesSent = 0;

        // ====== ALL 18 VIDEOS with context-aware categories ======
        this.videoLibrary = [
            { file: '1winworks.mp4', category: 'tutorial', caption_type: 'tutorial_video' },
            { file: 'betwayworks.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'sportybetworks.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'stakeworks.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'aviator-works.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'hollywoodworks.mp4', category: 'demo', caption_type: 'bot_demo_video' },
            { file: 'getfreecode.mp4', category: 'demo', caption_type: 'bot_demo_video' },
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
            { file: 'marketingvid15.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid16.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid17.mp4', category: 'marketing', caption_type: 'marketing_video' },
            { file: 'marketingvid18.mp4', category: 'marketing', caption_type: 'marketing_video' },
        ];

        // ====== ALL 36 IMAGES mapped to context categories ======
        this.imageLibrary = {
            // Win proof screenshots (for win_results, celebration)
            win_proof: [
                '1xbetshot1.jpg', '1wintzshot.jpg', 'betikawinshot1.jpg', 'betwaywinshot.jpg', 'betikawinshot1.jpg', 'withdrawalwinshot.jpg',
                'hollywithdraw1.jpg', 'popesshot.jpg', 'stakewithdr1.jpg', 'stakeusshot1.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg'
            ],
            // Bot/site screenshots (for promos, classy_promos)
            site_promo: [
                'avisignalsmainhome.jpg', 'hollywoodshot2.jpg',
                'screenshot1.jpg', 'marketing.jpg', 'selectbsite.jpg'
            ],
            // Signal/prediction related (for signals, analysis_updates, signal_confirmations)
            signal_related: [
                'dailypredictions.jpg', 'stakeusshot1.jpg',
                'withdrawalwinshot.jpg', '1wintzshot.jpg',
                '1xbetshot1.jpg', 'hollywoodshot1.jpg'
            ],
            // Free trial promo (for free trial messaging)
            free_trial: [
                'getfreetrial.jpg', 'entercode.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg'
            ],
            // Payment related (for payment promos)
            payment: [
                '1xbetshot1.jpg', 'popesshot.jpg', 'hollywoodshot1.jpg',
                '1wintzshot.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg'
            ],
            // Hype / motivational (for hype, celebration)
            hype: [
                'withdrawalwinshot.jpg', 'hollywithdraw1.jpg',
                'popesshot.jpg', '1wintzshot.jpg', 'stakewithdr1.jpg', 'hollywoodshot1.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg'
            ],
            // Feature showcase (for tips, promos)
            features: [
                'profitcalculator.jpg', 'profitcalculatorbase.jpg',
                'selectbsite.jpg', 'selectbettingsite.jpg', '1xbetshot1.jpg', 'betikawinshot1.jpg', 'popesshot.jpg', '1wintzshot.jpg', 'stakewithdr1.jpg',
                'securesiteentry.jpg', 'reviewexamples.jpg', 'hollywoodshot1.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg'
            ],
            // General marketing (fallback)
            general: [
                'marketing.jpg', 'marketingpic.jpg', 'hollywoodshot2.jpg', 'hollywithdraw2.jpg',
                'marketingpic2.jpg', 'stakeusshot1.jpg', 'betikawinshot1.jpg', 'popesshot.jpg',
                '1xbetshot1.jpg', '1wintzshot.jpg', 'hollywoodshot1.jpg'
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
            'payment_promo': ['payment', 'general'],
            'plans_promo': ['payment', 'site_promo', 'general'],
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
            ],

            // Plans Promo Flow (highlights the 3-tier pricing)
            plansPromo: [
                { type: 'plans_promo', weight: 1 },
                { type: 'payment_promo', weight: 0.7, delay: [2, 4] },
                { type: 'classy_promos', weight: 0.8, delay: [1, 2] }
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
                categories: ['tips', 'hype', 'promos', 'betting_sites', 'classy_promos', 'free_trial', 'payment_promo', 'plans_promo', 'social_proof'],
                emoji: "💎"
            }
        };

        // Weekly Site & Video Rotation (EAT Timezone)
        this.weeklyRotation = {
            1: { site: 'Betika', video: 'howitworks.mp4' },       // Monday
            2: { site: '1Win', video: '1winworks.mp4' },           // Tuesday
            3: { site: 'Betway', video: 'betwayworks.mp4' },         // Wednesday
            4: { site: 'SportyBet', video: 'sportybetworks.mp4' },   // Thursday
            5: { site: 'Stake', video: 'stakeworks.mp4' },           // Friday
            6: { site: 'MozzartBet', video: 'mozzartworks.mp4' },   // Saturday
            0: { site: 'Hollywoodbets', video: 'hollywoodworks.mp4' } // Sunday
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
        const sites = ['Betika', 'Betsson', 'SportyBet', '1Win', 'Bet365', '1xBet', '22Bet', 'Betway', 'Melbet', 'Hollywoodbets', 'Parimatch', 'Stake'];
        const preferredSites = ['Betika', 'Betway', 'SportyBet', '1Win', 'Stake'];

        const siteList = Math.random() < 0.8 ? preferredSites : sites;
        const randomSite = this.randomFromArray(siteList);

        let processedMessage = message
            .replace(/{{site}}/g, randomSite)
            .replace(/{{link}}/g, 'classybetaviator.com')
            .replace(/{{accuracy}}/g, '100%');

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
            const accuracy = "100";

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
        if (random < 0.20) {
            selectedFlow = 'videoPost';
        } else if (random < 0.30) {
            selectedFlow = 'immediateSignal';
        } else if (random < 0.38) {
            selectedFlow = 'immediateCancellation';
        } else if (random < 0.46) {
            selectedFlow = 'premiumSignal';
        } else if (random < 0.54) {
            selectedFlow = 'freeSignal';
        } else if (random < 0.60) {
            selectedFlow = 'educational';
        } else if (random < 0.66) {
            selectedFlow = 'celebration';
        } else if (random < 0.73) {
            selectedFlow = 'marketing';
        } else if (random < 0.80) {
            selectedFlow = 'freeTrialPromo';
        } else if (random < 0.87) {
            selectedFlow = 'paymentPromo';
        } else if (random < 0.93) {
            selectedFlow = 'plansPromo';
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
                'payment_promo', 'plans_promo', 'social_proof'
            ];
            const shouldSendImage = Math.random() < 0.50 && visualTypes.includes(messageType);

            let success = false;
            if (shouldSendImage) {
                const imagePath = this.getImageForCategory(messageType);
                if (imagePath) {
                    let caption = processedMessage;
                    if (messageType !== 'signals' && persona) {
                        caption += `\n\n${persona.emoji} ${persona.name}`;
                    }
                    console.log('📸 Sending with context-matched image');
                    success = await this.sendImageToChannel(imagePath, caption);
                }
            }

            if (!success) {
                // Send regular text message
                const messageData = {
                    message: processedMessage,
                    persona: persona,
                    category: messageType
                };
                success = await this.sendToChannel(messageData);
            }

            // If successfully sent a signal to the main channel, promote premium channel
            if (success && (messageType === 'signals' || messageType === 'signal_confirmations') && this.channelId === (process.env.TELEGRAM_CHANNEL_ID || '-1002107223172')) {
                setTimeout(() => {
                    this.sendPremiumPromotion();
                }, 15000);
            }

            return success;
        } catch (error) {
            console.error(`❌ Error sending ${messageType} message:`, error);
            return false;
        }
    }

    async sendPremiumPromotion() {
        try {
            const promoImagePath = path.join(__dirname, 'images', 'premium_screenshot.jpg');
            // If the placeholder file does not exist, copy one of the screenshots
            if (!fs.existsSync(promoImagePath)) {
                const srcPath = path.join(__dirname, 'images', 'avisignalsbotpage.jpg');
                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, promoImagePath);
                    console.log('📸 Created premium screenshot placeholder by copying avisignalsbotpage.jpg');
                }
            }

            const caption = `🔥 *AviSignals Premium Channel is LIVE!* 🚀\n\nGet continuous, non-stop signals for *every betting site* sent straight to you! Over 25 signals every hour for your favorite sites.\n\n👑 *Subscribe now for only $2 a week!*\n👉 Get access here: avisignals.com/premium`;

            if (fs.existsSync(promoImagePath)) {
                console.log('📢 Sending premium promo with screenshot to main channel...');
                await this.sendImageToChannel(promoImagePath, caption);
            } else {
                console.log('📢 Sending text-only premium promo to main channel...');
                await this.sendToChannel(caption);
            }
        } catch (error) {
            console.error('❌ Error sending premium promotion to main channel:', error);
        }
    }

    async runCodeGiveaway() {
        try {
            console.log('🎁 Starting code giveaway sequence...');
            // Announce giveaway
            const announceMsg = "🎁 *GIVEAWAY in 30 seconds!*\\n\\nFirst person to comment get a free code! Be ready! 🚀";
            await this.sendToChannel(announceMsg);

            // Wait 30 seconds
            await new Promise(resolve => setTimeout(resolve, 30000));

            // Load today's code (we'll just pull the first daily code we find)
            const codesPath = path.join(__dirname, '..', 'activation_codes.json');
            let dailyCode = 'DAILYCODE';
            if (fs.existsSync(codesPath)) {
                const codes = JSON.parse(fs.readFileSync(codesPath, 'utf8'));
                for (const site in codes) {
                    if (codes[site].daily) {
                        dailyCode = codes[site].daily;
                        break;
                    }
                }
            }

            const codeMsg = '🏆 *CODE REVEALED:* `' + dailyCode + '`\n\n' +
                'First person to use it win free access!\n' +
                '👉 Enter it here: avisignals.com/bot';

            await this.sendToChannel(codeMsg);
            console.log('✅ Giveaway code revealed.');
        } catch (error) {
            console.error('❌ Error in runCodeGiveaway:', error);
        }
    }

    async runCountdownSequence() {
        // Since cron handles the exact times, this method can be called directly
        // for testing, or we can just let the crons handle the individual messages.
        // For /countdown command, we will do a fast-forward version.
        try {
            console.log('⏳ Running manual fast-forward countdown sequence...');
            await this.sendToChannel("🔴 *LIVE session starting soon!* Get your code ready.");
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10s for manual
            await this.sendToChannel("⏳ *Almost time!* Code users, log in now.");
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10s for manual
            await this.sendToChannel("🟢 *WE ARE LIVE!* Today's session is OPEN.\\nFree code at avisignals.com/bot");
            console.log('✅ Manual countdown complete.');
        } catch (error) {
            console.error('❌ Error in runCountdownSequence:', error);
        }
    }

    getNextPostDelay() {
        // Obsolete function, retained for compatibility mapping if needed.
        return 0;
    }

    async sendChatAction(action) {
        try {
            const url = `https://api.telegram.org/bot${this.botToken}/sendChatAction`;
            const payload = {
                chat_id: this.channelId,
                action: action
            };
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('❌ Error sending chat action:', error);
        }
    }

    async executeSequentialQueue(queue) {
        for (const step of queue) {
            if (step.delay) {
                console.log(`⏳ Waiting ${step.delay / 1000}s for human-mimicking delay...`);
                await new Promise(resolve => setTimeout(resolve, step.delay));
            }
            if (!this.isRunning) return;

            if (step.type === 'text') {
                await this.sendChatAction('typing');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.sendToChannel(step.content);
            } else if (step.type === 'image') {
                await this.sendChatAction('upload_photo');
                await new Promise(resolve => setTimeout(resolve, 1500));
                await this.sendImageToChannel(step.path, step.caption);
            } else if (step.type === 'video') {
                await this.sendChatAction('upload_video');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.sendVideoToChannel(step.path, step.caption);
            }
        }
    }

    async runMorningSession() {
        console.log('🌅 Executing scheduled Morning Session...');
        let imagePath = path.join(__dirname, 'images', 'gettheedge.jpeg');
        if (!fs.existsSync(imagePath)) {
            imagePath = path.join(__dirname, 'images', 'avisignalsmainhome.jpg');
        }

        const queue = [
            {
                type: 'text',
                content: `🌅 *Good Morning Family!* Today is a fresh opportunity to dominate the Aviator charts.\n\n🎯 *Daily Target:* We are aiming for a consistent +200% growth on our stakes today. Discipline is key — do not get greedy!\n\n💡 *Basic Rule:* Split your bets, cash out the first at 1.5x to secure your stake, and let the second ride to our predicted multipliers.`
            }
        ];

        if (fs.existsSync(imagePath)) {
            queue.push({
                type: 'image',
                delay: 5000,
                path: imagePath,
                caption: `🤖 *Make sure your bot dashboard is ready.* Get daily codes or activate premium to lock in your predictions.\n\n👉 Start now: avisignals.com/bot.html`
            });
        }

        // Append channel template (supported countries/currencies/sites)
        queue.push({
            type: 'text',
            delay: 15000,
            content: this.getNextChannelTemplate()
        });

        await this.executeSequentialQueue(queue);
    }

    async runNoonSession() {
        console.log('🎰 Executing scheduled Noon Session...');
        const today = new Date().getDay(); // 0 is Sunday, 1 is Monday, etc.
        const rotation = this.weeklyRotation[today] || this.weeklyRotation[1];

        const siteName = rotation.site;
        const videoFile = rotation.video;
        const videoPath = path.join(__dirname, videoFile);

        const queue = [
            {
                type: 'text',
                content: `🎰 *Noon Session: Focus on ${siteName}!* 📈\n\nWe are targeting ${siteName}'s Aviator server for the next few hours. Our algorithms are fully synced and ready.`
            }
        ];

        if (fs.existsSync(videoPath)) {
            queue.push({
                type: 'video',
                delay: 5000,
                path: videoPath,
                caption: `🎥 *Watch this quick tutorial on how to use AviSignals on ${siteName}.* Follow the entry points exactly!`
            });
        }

        const codesPath = path.join(__dirname, '..', 'activation_codes.json');
        let dailyCode = 'DAILYCODE';
        if (fs.existsSync(codesPath)) {
            try {
                const codes = JSON.parse(fs.readFileSync(codesPath, 'utf8'));
                if (codes[siteName] && codes[siteName].daily) {
                    dailyCode = codes[siteName].daily;
                } else {
                    for (const site in codes) {
                        if (codes[site].daily) {
                            dailyCode = codes[site].daily;
                            break;
                        }
                    }
                }
            } catch (e) {
                console.error('Error reading activation codes for Noon Session:', e);
            }
        }

        queue.push({
            type: 'text',
            delay: 10000,
            content: `🎁 *GIVEAWAY - FREE ACCESS CODE REVEALED!* 🏆\n\nWe have released today's free code for *${siteName}*:\n\n🔑 Code: \`${dailyCode}\`\n\nFirst person to use it get free bot predictions!\n👉 Enter it on the app here: avisignals.com/bot`
        });

        // Append channel template (supported countries/currencies/sites)
        queue.push({
            type: 'text',
            delay: 15000,
            content: this.getNextChannelTemplate()
        });

        await this.executeSequentialQueue(queue);
    }

    async runEveningSession() {
        console.log('💥 Executing scheduled Evening Session...');

        const winProofCategory = this.imageLibrary.win_proof || [];
        let winProofImage = winProofCategory[Math.floor(Math.random() * winProofCategory.length)] || 'withdrawalwinshot.jpg';
        let winProofPath = path.join(__dirname, 'images', winProofImage);
        if (!fs.existsSync(winProofPath)) {
            winProofPath = path.join(__dirname, 'images', 'withdrawalwinshot.jpg');
        }

        const featuresCategory = this.imageLibrary.features || [];
        let testimonialImage = featuresCategory[Math.floor(Math.random() * featuresCategory.length)] || 'reviewexamples.jpg';
        let testimonialPath = path.join(__dirname, 'images', testimonialImage);
        if (!fs.existsSync(testimonialPath)) {
            testimonialPath = path.join(__dirname, 'images', 'stakewithdr1.jpg');
        }

        const queue = [
            {
                type: 'text',
                content: `💥 *WHAT A DAY!* Another highly profitable session in the books. Our members absolutely crushed it today! 💰`
            }
        ];

        if (fs.existsSync(winProofPath)) {
            queue.push({
                type: 'image',
                delay: 5000,
                path: winProofPath,
                caption: `📊 *Proof of profits.* One of our members just shared their results from today's session!`
            });
        }

        if (fs.existsSync(testimonialPath)) {
            queue.push({
                type: 'image',
                delay: 5000,
                path: testimonialPath,
                caption: `💬 *Real feedback from the chat.* Consistency is what separates the winners from the gamblers.`
            });
        }

        queue.push({
            type: 'text',
            delay: 5000,
            content: `⏰ *Don't sleep on tomorrow's profits.* Premium codes are selling fast. Buy your 24H or Weekly pass tonight to be ready for the morning session!\n\n👉 Upgrade here: avisignals.com/bot.html`
        });

        // Append channel template (supported countries/currencies/sites)
        queue.push({
            type: 'text',
            delay: 15000,
            content: this.getNextChannelTemplate()
        });

        await this.executeSequentialQueue(queue);
    }

    async sendFreeCodeTutorial() {
        console.log('📚 Executing Free Code Tutorial...');
        const videoPath = path.join(__dirname, 'getfreecode.mp4');

        const queue = [
            {
                type: 'text',
                content: `📚 *Free Code Tutorial!* Learn how to get your daily free activation code.`
            }
        ];

        if (fs.existsSync(videoPath)) {
            queue.push({
                type: 'video',
                delay: 2000,
                path: videoPath,
                caption: `🎥 *Tutorial: How to get your FREE activation code daily.* Follow the steps carefully!`
            });
        } else {
            console.warn('⚠️ getfreecode.mp4 not found in', __dirname);
        }

        await this.executeSequentialQueue(queue);
    }

    /**
     * Returns the next channel template message (rotates through all 3).
     * Ensures every session closes with info about supported currencies,
     * countries, and betting sites.
     */
    getNextChannelTemplate() {
        const template = this.channelTemplates[this.channelTemplateIndex];
        this.channelTemplateIndex = (this.channelTemplateIndex + 1) % this.channelTemplates.length;
        console.log(`📢 Channel template #${this.channelTemplateIndex} queued (global reach / supported sites)`);
        return template;
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
        console.log(`📊 Mode: SCHEDULED signals at exactly :00 and :30`);
        console.log(`🎥 Videos: ${this.videoLibrary.length} in rotation`);
        console.log(`📸 Images: ${Object.values(this.imageLibrary).flat().length} tags`);

        // Send first post immediately, unless we are in the middle of the night
        const currentHour = new Date().getHours();
        if (currentHour >= 6 && currentHour <= 23) {
            console.log('🚀 Sending immediate startup marketing post...');
            this.sendMarketingPost();
        }

        // Schedule to run exactly on the hour and half hour (:00 and :30) between 6am and 11pm
        cron.schedule('0,30 6-23 * * *', async () => {
            if (this.isRunning) {
                await this.sendMarketingPost();
            }
        });

        // ── NEW: Scheduled Marketing Events (EAT timezone = UTC+3) ──

        // Morning Session: 8:00 AM EAT (05:00 UTC)
        cron.schedule('0 5 * * *', async () => {
            if (this.isRunning) await this.runMorningSession();
        });

        // Free Code Tutorial: 9:00 AM EAT (06:00 UTC) - Every Morning
        cron.schedule('0 6 * * *', async () => {
            if (this.isRunning) await this.sendFreeCodeTutorial();
        });

        // Noon Session (Site Rotation & Daily Code Giveaway): 1:00 PM EAT (10:00 UTC)
        cron.schedule('0 10 * * *', async () => {
            if (this.isRunning) await this.runNoonSession();
        });

        // Evening Session (Recap & Testimonials): 8:00 PM EAT (17:00 UTC)
        cron.schedule('0 17 * * *', async () => {
            if (this.isRunning) await this.runEveningSession();
        });

        // 🔴 Live Session Countdown Series
        // T-30: 6:30 PM EAT (15:30 UTC)
        cron.schedule('30 15 * * *', async () => {
            if (this.isRunning) await this.sendToChannel("🔴 *LIVE session starting in 30 minutes!* Get your code ready.");
        });

        // T-10: 6:50 PM EAT (15:50 UTC)
        cron.schedule('50 15 * * *', async () => {
            if (this.isRunning) await this.sendToChannel("⏳ *10 MINUTES to go!* Code users, log in now.");
        });

        // T-0: 7:00 PM EAT (16:00 UTC)
        cron.schedule('0 16 * * *', async () => {
            if (this.isRunning) await this.sendToChannel("🟢 *WE ARE LIVE!* Today's session is OPEN.\\nFree code at avisignals.com/bot");
        });
    }

    scheduleNextPost() {
        // Handled completely by Node Cron now.
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
