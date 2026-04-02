const nodemailer = require('nodemailer');
require('dotenv').config();

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
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML body of the email
 */
async function sendEmail(to, subject, htmlBody) {
    try {
        const info = await transporter.sendMail({
            from: '"AviSignals Predictor" <no-reply@avisignals.com>',
            replyTo: 'avisignalscnc@gmail.com', // Replies will go to your Gmail
            to: to,
            subject: subject,
            html: htmlBody,
        });
        console.log(`📧 Email sent to ${to}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error("❌ Failed to send email:", error.message);
        return false;
    }
}

module.exports = { sendEmail };
