// ============================================================
// emailService.js — AviSignals Email Service v2
//
// Improvements over v1:
//  - Consistent branded HTML wrapper for every email
//  - Retry logic (3 attempts with backoff) on Resend failures
//  - Email validation before attempting send
//  - Unsubscribe link in every email (legally required)
//  - Discord notification only fires on actual success
//  - All campaign email types defined here as named functions
//  - Transporter lazily initialised (safe if RESEND_API_KEY missing)
// ============================================================

'use strict';

const nodemailer   = require('nodemailer');
const discordAgent = require('./discordAgent');

// ─── Transporter (Resend SMTP) ────────────────────────────────
let _transporter = null;
let _brevoTransporter = null;

let resendEmailCount = 0;
let lastResetDate = new Date().toDateString();
const RESEND_DAILY_LIMIT = 98;
const sentWelcomeEmails = new Set(); // For memory debounce

function getTransporter() {
    if (!_transporter) {
        if (!process.env.RESEND_API_KEY) {
            console.warn('⚠️  RESEND_API_KEY not set — emails will not be sent.');
            return null;
        }
        _transporter = nodemailer.createTransport({
            host:   'smtp.resend.com',
            port:   465,
            secure: true,
            auth:   { user: 'resend', pass: process.env.RESEND_API_KEY }
        });
    }
    return _transporter;
}

function getBrevoTransporter() {
    if (!_brevoTransporter) {
        if (!process.env.BREVO_SMTP_KEY || !process.env.BREVO_USER) {
            console.warn('⚠️  BREVO configuration missing — fallback emails will not be sent.');
            return null;
        }
        _brevoTransporter = nodemailer.createTransport({
            host:   'smtp-relay.brevo.com',
            port:   587,
            secure: false, // true for 465, false for other ports
            auth:   { user: process.env.BREVO_USER, pass: process.env.BREVO_SMTP_KEY }
        });
    }
    return _brevoTransporter;
}

// ─── Constants ────────────────────────────────────────────────
const FROM_NAME    = 'AviSignals';
const FROM_ADDRESS = 'no-reply@avisignals.com';
const REPLY_TO     = 'avisignalscnc@gmail.com';
const SITE_URL     = 'https://avisignals.com';
const BOT_URL      = `${SITE_URL}/bot.html`;
const TELEGRAM_URL = 'https://t.me/AviSignalsAviatorPredictorBot';
const ADMIN_WA     = 'https://wa.me/447400756162';
const ADMIN_TG     = 'https://t.me/Aadmin4cnc';
const BRAND_GOLD   = '#f1c40f';
const BRAND_DARK   = '#10152b';
const BRAND_GREEN  = '#2ecc71';

// ─── Email validator ──────────────────────────────────────────
function isValidEmail(email) {
    return typeof email === 'string' &&
           /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
           email.length < 255;
}

// ─── Unsubscribe URL builder ──────────────────────────────────
// In production, replace with a real signed unsubscribe endpoint
function unsubscribeUrl(email) {
    const encoded = Buffer.from(email).toString('base64url');
    return `${SITE_URL}/unsubscribe?token=${encoded}`;
}

// ============================================================
// BRANDED HTML WRAPPER
// Every email goes through this — consistent look guaranteed
// ============================================================
function wrapInTemplate({ previewText = '', headline, body, ctaText, ctaUrl, footerNote = '' }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${headline}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0b0d1a;font-family:'Segoe UI',Arial,sans-serif;">

<!-- Preview text (hidden) -->
<div style="display:none;max-height:0;overflow:hidden;">${previewText}</div>

<!-- Email wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0d1a;padding:24px 12px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:${BRAND_DARK};border-radius:12px 12px 0 0;padding:24px 32px;text-align:center;border-bottom:3px solid ${BRAND_GOLD};">
      <span style="font-size:26px;font-weight:800;color:${BRAND_GOLD};letter-spacing:1px;">AVI<span style="color:#fff;">SIGNALS</span></span>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;letter-spacing:2px;">AI AVIATOR PREDICTOR</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#12172e;padding:36px 32px;color:#e0e0e0;font-size:15px;line-height:1.7;">
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 20px;">${headline}</h1>
      ${body}

      ${ctaText && ctaUrl ? `
      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0 24px;">
        <a href="${ctaUrl}"
           style="display:inline-block;background:${BRAND_GOLD};color:${BRAND_DARK};
                  font-weight:800;font-size:16px;padding:14px 36px;
                  border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
          ${ctaText}
        </a>
      </div>` : ''}
    </td>
  </tr>

  <!-- Support row -->
  <tr>
    <td style="background:#0f1425;padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 10px;">Need help? Reach us directly:</p>
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:16px;">
            <a href="${ADMIN_WA}" style="color:${BRAND_GREEN};font-size:13px;font-weight:600;text-decoration:none;">💬 WhatsApp Admin</a>
          </td>
          <td>
            <a href="${ADMIN_TG}" style="color:#229ED9;font-size:13px;font-weight:600;text-decoration:none;">✈️ Telegram Admin</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0b0d1a;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
      <p style="color:rgba(255,255,255,0.3);font-size:11px;margin:0 0 8px;">
        © ${new Date().getFullYear()} AviSignals · AI Aviator Predictor Platform
      </p>
      ${footerNote ? `<p style="color:rgba(255,255,255,0.3);font-size:11px;margin:0 0 8px;">${footerNote}</p>` : ''}
      <p style="margin:0;">
        <a href="UNSUBSCRIBE_URL" style="color:rgba(255,255,255,0.25);font-size:11px;">Unsubscribe</a>
        &nbsp;·&nbsp;
        <a href="${TELEGRAM_URL}" style="color:rgba(255,255,255,0.25);font-size:11px;">Join Telegram Channel</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ============================================================
// CORE SEND FUNCTION — with retry
// ============================================================
async function sendEmail(to, subject, htmlBody, retries = 3) {
    if (!isValidEmail(to)) {
        console.warn(`⚠️  Invalid email skipped: ${to}`);
        return false;
    }

    // Reset daily counter if a new day has started
    const today = new Date().toDateString();
    if (lastResetDate !== today) {
        resendEmailCount = 0;
        lastResetDate = today;
    }

    // Inject real unsubscribe URL
    const finalHtml = htmlBody.replace(/UNSUBSCRIBE_URL/g, unsubscribeUrl(to));
    const mailOptions = {
        from:    `"${FROM_NAME}" <${FROM_ADDRESS}>`,
        replyTo: REPLY_TO,
        to,
        subject,
        html:    finalHtml
    };

    // Determine primary transporter
    // We now always start with Brevo as the primary provider
    let useBrevo = true;
    let transporter = getBrevoTransporter();

    // If Brevo is unconfigured, fallback to Resend immediately
    if (!transporter) {
        useBrevo = false;
        transporter = getTransporter();
    }

    if (!transporter) {
         console.warn('⚠️  Email aborted: No email provider (Brevo or Resend) is configured.');
         return false;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const info = await transporter.sendMail(mailOptions);

            console.log(`📧 Email sent (${useBrevo ? 'Brevo' : 'Resend'}) → ${to} | ${info.messageId}`);
            
            // Increment Resend counter only if Resend was actually used
            if (!useBrevo) {
                resendEmailCount++;
            }

            // Discord notification only on success
            try {
                discordAgent.sendSimpleNotification(
                    '📭 Email Sent',
                    `**To:** ${to}\n**Subject:** ${subject}\n**via:** ${useBrevo ? 'Brevo' : 'Resend'}`,
                    0x9B59B6
                );
            } catch (_) {}

            return true;

        } catch (err) {
            console.error(`❌ Email attempt ${attempt}/${retries} failed for ${to} (via ${useBrevo ? 'Brevo' : 'Resend'}):`, err.message);
            
            // FAILOVER LOGIC:
            // If primary (Brevo) fails and we haven't tried Resend yet, switch to Resend for the next attempt.
            // Or if Resend fails and we haven't tried Brevo (unlikely), switch vice versa.
            if (useBrevo) {
                const resendTransporter = getTransporter();
                if (resendTransporter) {
                    console.log(`🔄 Brevo failed. Switching to Resend fallback for attempt ${attempt + 1}.`);
                    useBrevo = false;
                    transporter = resendTransporter;
                }
            } else {
                // If Resend fails, we could try Brevo if we started with Resend (already logic above handles fallback)
                // but since we start with Brevo, this block is if the fallback also fails.
            }

            if (attempt < retries) {
                await new Promise(r => setTimeout(r, attempt * 2000)); // backoff
            }
        }
    }

    console.error(`❌ All ${retries} attempts failed for ${to}`);
    return false;
}

// ============================================================
// NAMED CAMPAIGN EMAILS
// Each function returns { subject, html } or calls sendEmail directly
// ============================================================

// Day 0 — fires immediately on registration
async function sendWelcomeEmail(to, firstName = '') {
    if (sentWelcomeEmails.has(to.toLowerCase())) {
        console.warn(`⚠️ Duplicate welcome email suppressed for: ${to}`);
        return false;
    }
    sentWelcomeEmails.add(to.toLowerCase());

    const name = firstName || to.split('@')[0];
    const subject = `Welcome to AviSignals, ${name}! 🚀 Claim your free code`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>, welcome aboard! 🎉</p>
    <p>You've just joined <strong style="color:${BRAND_GOLD};">thousands of Aviator players</strong> across the world who are using AI to play smarter — not harder.</p>

    <p style="color:#fff;font-weight:600;margin-top:24px;">Here's how to claim your FREE daily prediction code right now:</p>
    <ol style="color:#ccc;padding-left:20px;">
      <li style="margin-bottom:8px;">Go to the <a href="${BOT_URL}" style="color:${BRAND_GOLD};">Bot Page</a></li>
      <li style="margin-bottom:8px;">Click <strong style="color:${BRAND_GOLD};">FREE CODE</strong></li>
      <li style="margin-bottom:8px;">Select your betting site</li>
      <li style="margin-bottom:8px;">Click <strong style="color:${BRAND_GOLD};">Use Bot</strong> → enter your code → click <strong style="color:${BRAND_GOLD};">Activate</strong></li>
      <li>Open your Aviator game alongside the bot and follow the predictions</li>
    </ol>

    <div style="background:rgba(241,196,15,0.08);border-left:3px solid ${BRAND_GOLD};padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;">
      <p style="margin:0;color:#ccc;font-size:14px;">
        💡 <strong style="color:#fff;">Pro tip:</strong> Subscribe to our 
        <a href="${TELEGRAM_URL}" style="color:${BRAND_GOLD};">Telegram Channel</a> 
        for daily free signals and winning strategies.
      </p>
    </div>

    <p style="color:#ccc;">When you're ready for unlimited 24/7 access, our <strong style="color:#fff;">24-Hour Code</strong> is just <strong style="color:${BRAND_GOLD};">$39</strong> and activates instantly via Mobile money or card.</p>
    <p style="color:#ccc;">We'll be in touch. Good luck out there. 🎯</p>`;

    const html = wrapInTemplate({
        previewText: `Your free AviSignals prediction code is waiting, ${name}`,
        headline:    `Your free code is ready, ${name} 🎯`,
        body,
        ctaText: 'Claim My Free Code Now',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// Day 1 — social proof + urgency
async function sendDay1Email(to, firstName = '') {
    const name    = firstName || to.split('@')[0];
    const subject = `${name}, look what you missed last night 💰`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong> 👋</p>
    <p>Last night our members were having a great time on Aviator. Here's a taste of what the bot called:</p>

    <div style="background:#0d1020;border:1px solid rgba(241,196,15,0.2);border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <div style="font-size:40px;font-weight:800;color:${BRAND_GOLD};">10.4×</div>
      <div style="color:#ccc;font-size:13px;margin-top:6px;">Predicted multiplier — members who cashed out at exactly this point walked away with serious returns.</div>
    </div>

    <p style="color:#ccc;">Did you claim your free code yesterday? If not, it resets daily — <strong style="color:#fff;">your new code is waiting for you right now.</strong></p>

    <div style="background:rgba(46,204,113,0.08);border-left:3px solid ${BRAND_GREEN};padding:14px 18px;border-radius:0 8px 8px 0;margin:24px 0;">
      <p style="margin:0;color:#ccc;font-size:14px;">
        🔥 Want unlimited access with no daily reset? Our <strong style="color:#fff;">24-Hour Code</strong> is 
        <strong style="color:${BRAND_GOLD};">$39</strong> — one payment, 24 hours of continuous predictions on any site.
        Pay instantly via <strong>Mobile or card</strong>.
      </p>
    </div>

    <p style="color:#ccc;">Don't let another night pass. Your competitors are already using the bot.</p>`;

    const html = wrapInTemplate({
        previewText: 'You missed some big rounds last night — your code resets daily',
        headline:    'Last night was a good night 🎯',
        body,
        ctaText: 'Get My Code Now',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// Day 3 — success story + social proof
async function sendDay3Email(to, firstName = '') {
    const name    = firstName || to.split('@')[0];
    const subject = `How James turned  $800 into $150000 with AviSignals 📈`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p>We want to share something that happened with one of our members last week.</p>

    <div style="background:#0d1020;border:1px solid rgba(241,196,15,0.15);border-radius:10px;padding:24px;margin:24px 0;">
      <div style="display:flex;align-items:center;margin-bottom:14px;">
        <div style="width:42px;height:42px;background:${BRAND_GOLD};border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:${BRAND_DARK};font-size:18px;flex-shrink:0;">J</div>
        <div style="margin-left:12px;">
          <div style="color:#fff;font-weight:700;">James M.</div>
          <div style="color:rgba(255,255,255,0.4);font-size:12px;">Nairobi, Kenya · AviSignals member</div>
        </div>
      </div>
      <p style="color:#ccc;font-style:italic;margin:0;line-height:1.7;">
        "I was skeptical at first. I tried the free code on SportyBet and it was accurate on the first round. 
        I bought the 24-hour code, followed the predictions carefully, and turned $800 into over  $150,000 
        in two sessions. I've now been a regular member for 3 weeks."
      </p>
    </div>

    <p style="color:#ccc;">James isn't special — he just followed the predictions. The same bot is available to you right now.</p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td width="48%" style="background:rgba(241,196,15,0.06);border-radius:8px;padding:16px;text-align:center;border:1px solid rgba(241,196,15,0.15);">
          <div style="font-size:24px;font-weight:800;color:${BRAND_GOLD};">100%</div>
          <div style="font-size:12px;color:#ccc;margin-top:4px;">Prediction Accuracy</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:rgba(46,204,113,0.06);border-radius:8px;padding:16px;text-align:center;border:1px solid rgba(46,204,113,0.15);">
          <div style="font-size:24px;font-weight:800;color:${BRAND_GREEN};">$39</div>
          <div style="font-size:12px;color:#ccc;margin-top:4px;">24H Unlimited Access</div>
        </td>
      </tr>
    </table>

    <p style="color:#ccc;">Start with your free daily code today. When you're ready, the 24H upgrade is one click away.</p>`;

    const html = wrapInTemplate({
        previewText: 'Real story: $ 800 → $150,000 using the AviSignals predictor',
        headline:    'A story worth reading 📖',
        body,
        ctaText: 'Try It Free Today',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// Day 7 — discount offer + final push
async function sendDay7Email(to, firstName = '') {
    const name    = firstName || to.split('@')[0];
    const subject = `${name} — your exclusive offer expires tonight 🎁`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p>You've been with AviSignals for a week. We appreciate you and we want to make sure you get the most out of the platform before this week is over.</p>

    <div style="background:linear-gradient(135deg,rgba(241,196,15,0.12),rgba(241,196,15,0.04));border:1px solid ${BRAND_GOLD};border-radius:10px;padding:24px;margin:24px 0;text-align:center;">
      <div style="font-size:13px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">This week only</div>
      <div style="font-size:36px;font-weight:800;color:${BRAND_GOLD};">20% OFF</div>
      <div style="font-size:15px;color:#ccc;margin-top:6px;">your first 24-Hour Code</div>
      <div style="margin-top:12px;font-size:13px;color:rgba(255,255,255,0.5);">
        Use code <strong style="color:#fff;background:rgba(0,0,0,0.3);padding:3px 10px;border-radius:4px;font-family:monospace;">WELCOME20</strong> at checkout
      </div>
      <div style="margin-top:16px;font-size:28px;font-weight:800;">
          <span style="text-decoration:line-through;color:rgba(255,255,255,0.3);font-size:18px;">$39</span>
          &nbsp;<span style="color:${BRAND_GOLD};">$31</span>
        </div>
      </div>
  
      <p style="color:#ccc;">This offer expires at midnight tonight. After that, it's back to the standard $39.</p>
    <p style="color:#ccc;">If you have any questions before buying, reply to this email or message our admin directly — we'll respond within the hour.</p>`;

    const html = wrapInTemplate({
        previewText: 'Your 20% discount expires tonight — use code WELCOME20',
        headline:    'A gift from us to you 🎁',
        body,
        ctaText: 'Claim My 20% Discount',
        ctaUrl:  BOT_URL,
        footerNote: 'Offer valid for 24 hours from sending. One use per account.'
    });

    return sendEmail(to, subject, html);
}

// Re-engagement — for users gone cold (day 14+, no purchase)
async function sendReengagementEmail(to, firstName = '', daysSinceSignup = 14) {
    const name    = firstName || to.split('@')[0];
    const subject = `${name}, we saved your spot 👀`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p>It's been ${daysSinceSignup} days since you joined AviSignals and we haven't seen you in a while.</p>
    <p>Your free daily code is still available — it resets every day and it's <strong style="color:#fff;">completely free</strong>. No payment, no commitment.</p>

    <div style="background:rgba(241,196,15,0.06);border-left:3px solid ${BRAND_GOLD};padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0;">
      <p style="margin:0;color:#ccc;">
        The Aviator community on our 
        <a href="${TELEGRAM_URL}" style="color:${BRAND_GOLD};">Telegram channel</a> 
        is growing every day. Members share results, tips, and support each other. It's free to join.
      </p>
    </div>

    <p style="color:#ccc;">We're not giving up on you. Come back, grab your code, and give the predictor one real session. We think it'll change how you play.</p>`;

    const html = wrapInTemplate({
        previewText: `Your free code is still waiting, ${name} — it resets daily`,
        headline:    'We kept your spot 🎯',
        body,
        ctaText: 'Come Back & Get My Code',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// Renewal warning — subscriber expiring in 24 hours
async function sendRenewalWarningEmail(to, firstName = '', expiresAt) {
    const name    = firstName || to.split('@')[0];
    const subject = `⚠️ Your AviSignals access expires in 24 hours`;
    const expiry  = expiresAt ? new Date(expiresAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) : 'soon';

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p>Your 24-Hour AviSignals subscription expires at <strong style="color:${BRAND_GOLD};">${expiry}</strong>.</p>
    <p>After that, you'll lose access to continuous predictions and drop back to the single free daily code.</p>

    <div style="background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.3);border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0;color:#e0ccc;">
        🔴 <strong style="color:#fff;">Don't break your streak.</strong> Renew now to keep uninterrupted access and stay ahead.
      </p>
    </div>

    <p style="color:#ccc;">One click, instant reactivation. Pay with M-Pesa or card — takes under 2 minutes.</p>`;

    const html = wrapInTemplate({
        previewText: 'Your AviSignals access expires in 24 hours — renew now to stay active',
        headline:    'Your access expires soon ⚠️',
        body,
        ctaText: 'Renew My Access — $39',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// Hot lead follow-up — triggered by ARIA intent detection
async function sendHotLeadEmail(to, firstName = '') {
    const name    = firstName || to.split('@')[0];
    const subject = `${name} — you asked about the 24H code. Here's everything.`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p>You were asking about the 24-Hour Activation Code earlier. Here's everything you need to know to get started right now.</p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      ${[
        ['💰', 'Price', '$39 USD (one-time for 24 hours)'],
        ['⚡', 'Activation', 'Instant — works immediately after payment'],
        ['📱', 'Payment', 'Mobile money or Card via Flutterwave (safe & secure)'],
        ['🎯', 'What you get', 'Unlimited predictions for 24 hours on any betting site'],
        ['🔄', 'Reset', 'Each new purchase gives you a fresh 24-hour window'],
      ].map(([icon, label, val]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:18px;">${icon}</span>
          <strong style="color:#fff;margin-left:8px;">${label}:</strong>
          <span style="color:#ccc;margin-left:6px;">${val}</span>
        </td>
      </tr>`).join('')}
    </table>

    <p style="color:#ccc;margin-top:20px;">Ready? Click below and select <strong style="color:#fff;">Buy Code</strong> on the bot page. You'll be predicting within minutes.</p>
    <p style="color:#ccc;">Any questions? Our admin replies fast on <a href="${ADMIN_WA}" style="color:${BRAND_GREEN};">WhatsApp</a> or <a href="${ADMIN_TG}" style="color:#229ED9;">Telegram</a>.</p>`;

    const html = wrapInTemplate({
        previewText: 'Everything about the AviSignals 24H code — price, payment, and activation',
        headline:    'Ready to go unlimited? Here\'s how 🚀',
        body,
        ctaText: 'Get My 24H Code — $39',
        ctaUrl:  BOT_URL
    });

    return sendEmail(to, subject, html);
}

// OTP — Password reset
async function sendOtpEmail(to, otp) {
    const subject = `Your Password Reset OTP 🔐`;
    const body = `
    <p style="color:#ccc;">You requested a password reset for your AviSignals account.</p>
    <p style="color:#ccc;">Please use the following One-Time Password (OTP) to complete the process:</p>
    
    <div style="background:rgba(241,196,15,0.1);border:2px dashed ${BRAND_GOLD};padding:24px;text-align:center;margin:32px 0;border-radius:12px;">
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:${BRAND_GOLD};text-shadow:0 0 10px rgba(241,196,15,0.3);">
        ${otp}
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:10px;text-transform:uppercase;letter-spacing:1px;">
        Expires in 15 minutes
      </div>
    </div>

    <p style="color:#ccc;">If you didn't request this, please ignore this email — your password will remain unchanged.</p>
    <p style="color:#ccc;">For your security, never share this code with anyone.</p>`;

    const html = wrapInTemplate({
        previewText: `Your AviSignals OTP is ${otp}`,
        headline:    `Password Reset Request 🔐`,
        body,
        footerNote:  'Security alert: This code was requested from the AviSignals website.'
    });

    return sendEmail(to, subject, html);
}

// Transactional — Code Activation Delivery
async function sendActivationCodeEmail(to, code, siteName = 'your selected betting site') {
    const name    = to.split('@')[0];
    const subject = `Your AviSignals Activation Code 🚀`;

    const body = `
    <p style="color:#ccc;">Hey <strong style="color:#fff;">${name}</strong>,</p>
    <p style="color:#ccc;">Your payment has been successfully verified! Here is your activation code for <strong style="color:${BRAND_GOLD};">${siteName}</strong>:</p>
    
    <div style="background:rgba(46,204,113,0.1);border:2px dashed ${BRAND_GREEN};padding:24px;text-align:center;margin:32px 0;border-radius:12px;">
      <div style="font-size:36px;font-weight:800;letter-spacing:5px;color:${BRAND_GREEN};text-shadow:0 0 10px rgba(46,204,113,0.3);">
        ${code}
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:10px;text-transform:uppercase;letter-spacing:1px;">
        Valid for 24 hours on ${siteName}
      </div>
    </div>

    <p style="color:#ccc;"><strong>How to use it:</strong></p>
    <ol style="color:#ccc;padding-left:20px;">
      <li style="margin-bottom:8px;">Go to the <a href="${BOT_URL}" style="color:${BRAND_GOLD};">Bot Page</a></li>
      <li style="margin-bottom:8px;">Select <strong style="color:${BRAND_GOLD};">${siteName}</strong> as your betting site</li>
      <li style="margin-bottom:8px;">Click <strong style="color:${BRAND_GOLD};">Use Bot</strong></li>
      <li style="margin-bottom:8px;">Enter your code and click <strong style="color:${BRAND_GOLD};">Activate</strong></li>
    </ol>

    <p style="color:#ccc;">If you need any help, please contact our support team.</p>`;

    const html = wrapInTemplate({
        previewText: `Your payment is verified. Your AviSignals activation code is ${code}`,
        headline:    `Payment Verified ✅`,
        body,
        ctaText: 'Open Bot Now',
        ctaUrl:  BOT_URL,
        footerNote:  'This is a transactional email regarding your recent purchase.'
    });

    return sendEmail(to, subject, html);
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    sendEmail,
    sendWelcomeEmail,
    sendDay1Email,
    sendDay3Email,
    sendDay7Email,
    sendReengagementEmail,
    sendRenewalWarningEmail,
    sendHotLeadEmail,
    sendOtpEmail,
    sendActivationCodeEmail
};
