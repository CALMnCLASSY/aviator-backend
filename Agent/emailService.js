const nodemailer = require('nodemailer');
require('dotenv').config();
const discordAgent = require('./discordAgent');

// Create reusable transporter object using Resend
const transporter = nodemailer.createTransport({
    host: 'smtp.resend.com',
    port: 465,
    secure: true, 
    auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY 
    }
});

/**
 * Sends an email using the configured SMTP.
 */
async function sendEmail(to, subject, htmlBody) {
    try {
        const info = await transporter.sendMail({
            from: '"AviSignals Predictor" <no-reply@avisignals.com>',
            replyTo: 'avisignalscnc@gmail.com',
            to: to,
            subject: subject,
            html: htmlBody,
        });
        console.log(`📧 Email sent to ${to}: ${info.messageId}`);
        // Notify Discord
        discordAgent.sendSimpleNotification("📭 Outbound Email Sent", `**To:** ${to}\n**Subject:** ${subject}`, 0x9B59B6);
        return true;
    } catch (error) {
        console.error("❌ Failed to send email:", error.message);
        return false;
    }
}

/**
 * Sends a welcome follow-up email.
 */
async function sendWelcomeEmail(to) {
    const subject = "Welcome to AviSignals Predictor! 🚀";
    const htmlBody = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #f1c40f;">Welcome to AviSignals!</h2>
            <p>We are thrilled to have you on board. You're now ready to use our AI-powered predictor to dominate the Aviator game.</p>
            
            <h3 style="margin-top: 20px;">Need Help or Active Support?</h3>
            <p>Our team is available 24/7. Join our channels to get free tips, daily codes, and direct support!</p>
            
            <ul style="list-style: none; padding: 0;">
                <li style="margin-bottom: 10px;">
                    📢 <strong>Official Telegram Channel (Daily Free Signals):</strong><br/>
                    <a href="https://t.me/AviSignalsAviatorPredictorBot" style="color: #3498db; text-decoration: none;">Join Channel Here</a>
                </li>
                <li style="margin-bottom: 10px;">
                    👤 <strong>Admin Telegram (Direct Support):</strong><br/>
                    <a href="https://t.me/Aadmin4cnc" style="color: #3498db; text-decoration: none;">@Aadmin4cnc</a>
                </li>
                <li style="margin-bottom: 10px;">
                    💬 <strong>Admin WhatsApp:</strong><br/>
                    <a href="https://wa.me/447400756162" style="color: #2ecc71; text-decoration: none;">+44 7400 756162</a>
                </li>
            </ul>

            <p style="margin-top: 30px;">Best regards,<br/><strong>The AviSignals Team</strong></p>
        </div>
    `;
    return sendEmail(to, subject, htmlBody);
}

module.exports = { sendEmail, sendWelcomeEmail };
