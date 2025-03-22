const express = require('express');
const nodemailer = require('nodemailer');

const router = express.Router();
const { authorizeRole } = require('../middleware/auth'); // Import middlewares

router.get('/', authorizeRole(['Member', 'Librarian']), (req, res) => {
  // Ensure no other response is sent before returning
  try {
    // Some logic
    res.sendStatus(200); // Properly sending a status response
  } catch (error) {
    // Handling error and sending a response only once
    console.error('Error:', error);
    if (!res.headersSent) {
      // Ensure headers are not already sent
      res.status(500).send('Internal Server Error');
    }
  }
});

// Endpoint to register and invite a new user through the librarian dashboard
router.post('/register', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { email, name, mobile, address, dob, role } = req.body;

    // Check if all required fields are present
    if (!email || !name || !mobile || !address || !dob || !role) {
      return res.status(400).json({ action: false, message: 'All fields are required' });
    }

    // Check if user already exists
    const [existingUser] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ?',
      [email]
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ action: false, message: 'User already exists' });
    }

    // Insert new user record into the database with inactive status (status 2)
    await req.app.locals.db.query(
      'INSERT INTO user (user_email, user_name, user_mobile, user_address, user_dob, user_role, user_status, user_max_books) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [email, name, mobile, address, dob, role, '2', (role === 'Member' ? 2 : 0)]
    );

    // Generate OTP and set OTP expiration (24 hours from now)
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate a 6-digit OTP
    const otpExpiration = new Date();
    otpExpiration.setHours(otpExpiration.getHours() + 24); // Set expiration time to 24 hours
    await req.app.locals.db.query(
      'UPDATE user SET user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      [otp, otpExpiration, email]
    );

    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
    body { 
      font-family: Arial, sans-serif; 
      text-align: center; 
      background-color: #f4f4f4; 
      padding: 20px; 
    }
    .email-container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: white; 
      padding: 20px; 
      border-radius: 10px; 
      box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); 
    }
    h2 {
      color: #333;
      margin-bottom: 10px;
    }
    p {
      font-size: 16px;
      color: #333;
    }
    .otp-box { 
      font-size: 24px; 
      font-weight: bold; 
      color: #fff; 
      background: #007bff; 
      padding: 10px 20px; 
      border-radius: 5px; 
      display: inline-block; 
      margin: 20px 0; 
    }
    .footer { 
      font-size: 12px; 
      color: #777; 
      margin-top: 20px; 
    }
    </style>
    </head>
    <body>
      <div class="email-container">
        <h2>🎉 Welcome to the System!</h2>
        <p>Hello ${name},</p>
        <p>You have been successfully registered in the Smart Library system.</p>
        <p>Your OTP to activate your account is:</p>
        <div class="otp-box">${otp}</div>
        <p>This OTP will expire in 24 hours. Please use it to activate your account.</p>
        <p>If you did not request this registration, please ignore this email.</p>
        <hr>
        <p class="footer">If you need assistance, please contact our support team.</p>
      </div>
    </body>
    </html>
  `;

    // Setup the email transporter
    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port == 465, // Secure connection only for port 465
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false }, // Fixes self-signed certificate issue
    });

    await transporter.sendMail({
      from: `"Smart Library Account" <${username}>`,
      to: email,
      subject: '🔔 Welcome To Smart Library',
      html: emailTemplate, // Use HTML content for the email body
    });

    // Respond with success message
    res.json({ action: true, message: 'User registered and invitation email sent successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ action: false, message: 'Server error' });
  }
});
module.exports = router;
