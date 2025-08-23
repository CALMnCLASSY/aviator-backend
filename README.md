# Aviator Predictions Backend

A comprehensive backend system for handling Aviator game predictions with Selar payments and M-Pesa mobile money integration.

## Features

### 🎯 Core Features
- **Prediction Generation**: Advanced algorithms for different multiplier packages (2x, 5x, 10x, 20x)
- **Multi-Payment Support**: Selar and M-Pesa payments
- **Real-time Notifications**: Telegram bot and email notifications
- **User Management**: Complete user lifecycle management
- **Payment Verification**: Secure webhook handling for all payment providers

### 💳 Payment Providers
- **Selar**: Digital product payments with instant verification
- **M-Pesa**: Kenya mobile money integration
- **Telegram Integration**: Real-time admin notifications and verification

### 📱 Notification System
- **Telegram Bot**: Real-time payment and prediction notifications
- **Email Notifications**: Professional email templates for users
- **Admin Alerts**: Instant notifications for new payments

## Installation

### Prerequisites
- Node.js (v14 or higher)
- Payment provider accounts (Selar, M-Pesa)

### Quick Start

1. **Install Dependencies**
```bash
npm install
```

2. **Environment Setup**
Create a `.env` file in the root directory with the following variables:

```env

# Server Configuration
PORT=5000
NODE_ENV=development
BASE_URL=http://localhost:5000
FRONTEND_URL=file:///C:/Users/Joshua/OneDrive/Desktop/Avsite%203.0/index.html

# M-Pesa Configuration
MPESA_CONSUMER_KEY=rYDOOcBmVw0B30jVxAQ1v0taJP2AsUqvdkXBGKD4TZqbMmwW
MPESA_CONSUMER_SECRET=F0ZI0UbwK7U1N4VstGAxgPxxE6KUzqKtCCFuvfrjrARPs1JAWKbfB3HCRjHGjTsz
MPESA_SHORTCODE=174379
MPESA_PASSKEY=drdnL1/jdgUqD6AVPDnciu1STH5HSqhu53PjLfPV4supotB/aZUY52Zu/2FpXWPgP6FTcPc5hwYr74oVhtggck21cX578WPi0qiat6Gbc9TkxkaXd2FZfslaZzjVj9PnIF3XqE1zs1KpbxSsPYj5pEVNsZZRhxBoPY6k5xWHSnLT10ckMY8wkdOyRZ1mqRjO42L0yA2ymGfFe46LvuXQPTMm54BGndNzVkDFSmmJ44tbSz9TRS+Ez3Wy1RXxms3GgfsQG7sl5LfqUMbpdPZsfknlzAq1oCc4WQXaBSSZ7EvACY0qRLdbkT6TyLxZjwArWeoZnVflelKkm5girzCWWw==
MPESA_BASE_URL=https://api.safaricom.co.ke

# Telegram Bot
TELEGRAM_BOT_TOKEN=7688438027:AAFNnge7_oADfxCwCMm2XZGSH1hG2Q0rZfE
TELEGRAM_CHAT_ID=5900219209

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=omondijoe204@gmail.com
EMAIL_PASS=omondi325
```

3. **Start the Server**
```bash
npm start
```

## API Endpoints

### User Management
- `POST /api/users` - Create a new user
- `GET /api/users/:email` - Get user by email
- `GET /api/users/:email/predictions` - Get user predictions
- `GET /api/users/:email/predictions/status` - Check prediction status
- `PUT /api/users/:email` - Update user information
- `GET /api/users/:email/payment-status` - Get payment status

### Payment Endpoints

#### Selar Payments
- `POST /api/payments/selar/create-order` - Create Selar payment order
- `POST /api/payments/selar/verify/:reference` - Verify Selar payment
- `POST /api/payments/selar/admin-verify/:reference` - Admin verify payment
- `GET /api/payments/selar/status/:reference` - Check payment status

#### Bot Activation
- `POST /api/payments/bot/verify/:orderId` - Verify bot payment
- `GET /api/payments/bot/status/:orderId` - Check bot activation status

#### Demo/Testing
- `POST /api/payments/demo/verify-payment` - Demo payment verification

## Usage Examples

### 1. Creating a User
```javascript
const response = await fetch('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com',
    packageName: '2x Prediction Package',
    timeSlot: '14:00',
    bettingSite: '1xBet'
  })
});
```
### 3. Getting User Predictions
```javascript
const response = await fetch('/api/users/user@example.com/predictions');
const data = await response.json();
console.log(data.predictions); // Array of prediction multipliers
```

## Payment Flow

### 1. User Registration
1. User fills out the form with email, package, time slot, and betting site
2. System creates a user record with `paymentVerified: false`

### 2. Payment Processing
1. User selects payment method
2. System creates payment intent/request with chosen provider
3. User completes payment with provider
4. Provider sends webhook/callback to our system
5. System verifies payment and updates user record

### 3. Prediction Generation
1. After successful payment verification
2. System generates predictions based on selected package
3. Predictions are stored in user record
4. User receives email and Telegram notifications

### 4. Prediction Access
1. User can access predictions for 24 hours after payment
2. System validates payment status and expiry time
3. Predictions are served via API endpoints

## Prediction Algorithms

### Package Types
- **2x Package**: Conservative predictions (1.5x - 3.0x range)
- **5x Package**: Medium risk predictions (2.0x - 8.0x range)
- **10x Package**: Higher risk predictions (3.0x - 15.0x range)
- **20x Package**: High risk predictions (5.0x - 30.0x range)

### Algorithm Logic
- Each package generates predictions with a focus on the target multiplier
- 60% of predictions are close to the target multiplier
- 40% are distributed across the package range
- Predictions are sorted and validated before delivery

## Security Features

### Payment Security
- Webhook signature verification for all providers
- Secure environment variable handling
- Payment amount validation
- Duplicate payment prevention

### Data Protection
- Input validation and sanitization
- Error handling without information leakage
- Secure API endpoint design

## Monitoring and Logging

### Logging
- Payment transactions logged with timestamps
- User activity tracking
- Error logging with stack traces
- Webhook verification logging

### Notifications
- Real-time payment confirmations
- Admin alerts for new payments
- Error notifications for failed payments
- Prediction delivery confirmations

## Testing


### Webhook Testing
Use tools like ngrok to expose your local server for webhook testing:
```bash
ngrok http 5000
```

## Production Deployment

### Environment Variables
- Update all API keys to production values
- Set `NODE_ENV=production`
- Configure proper database connection
- Set up SSL certificates

### Security Considerations
- Use HTTPS in production
- Implement rate limiting
- Add authentication for admin endpoints
- Regular security audits

## Support

For issues or questions:
1. Check the console logs for error details
2. Verify environment variables are set correctly
3. Test webhook endpoints with provider tools
4. Monitor database connections

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the ISC License.
