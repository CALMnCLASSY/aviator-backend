const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        // The user must place their 16-character App Password here, NOT their normal password
        pass: process.env.EMAIL_PASS 
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
            from: '"AviSignals Predictor" <' + process.env.EMAIL_USER + '>',
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
