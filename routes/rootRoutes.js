const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    res.status(200).json({ message: 'Service is up and running successfully!', firebase: !!req.app.locals.fbrc, database : !!req.app.locals.db });
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

// Route to authenticate a user and issue a JWT token
router.post('/token', async (req, res) => {
  const { email, password } = req.body; // Extract email and password from the request body

  try {
    // 1. Retrieve user record from the database where email matches and account is active
    const [users] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ? AND user_status = ?',
      [email, '1']
    );
    const user = users[0]; // Get the first user record

    // 2. Check if the user exists
    if (!user) {
      return res
        .status(401)
        .json({ action: false, message: 'Invalid credentials / Inactive account' });
    }

    // 3. Validate the provided password against the stored hashed password
    const passwordMatch = await bcrypt.compare(password, user.user_password);
    if (!passwordMatch) {
      return res.status(401).json({ action: false, message: 'Invalid credentials' });
    }

    // 4. Generate a JWT token with the user's email and role
    const payload = {
      user_email: user.user_email, // Include user's email
      user_role: user.user_role, // Include user's role
    };
    const token = jwt.sign(payload, req.app.locals.jwt_secret, { expiresIn: '30d' });

    // 4. Upadte last login time
    await req.app.locals.db.query('UPDATE user SET user_last_login = ? WHERE user_email = ?', [
      new Date(),
      email,
    ]);

    // 5. Prepare email
    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; background-color: #f4f4f4; padding: 20px; }
      .email-container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); }
      .info-box { font-size: 16px; font-weight: bold; color: #fff; background: #007bff; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 20px 0; }
      .footer { font-size: 12px; color: #777; margin-top: 20px; }
    </style>
    </head>
    <body>
      <div class="email-container">
        <h2>🔔 New Login Alert</h2>
        <p>Hello,</p>
        <p>Your account was recently logged into. If this was you, you can ignore this email.</p>
        <div class="info-box">Login Time: ${new Date().toLocaleString()}</div>
        <p>If this wasn't you, please reset your password immediately and contact support.</p>
        <hr>
        <p class="footer">If you need assistance, contact our support team.</p>
      </div>
    </body>
    </html>
    `;

    // 6. Send email notification
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
      subject: '🔔 New Login Alert',
      html: emailTemplate, // Use HTML content for the email body
    });

    // 7. Send the generated token back to the client
    res.json({ action: true, message: 'Success', token, user: payload });
  } catch (error) {
    // Handle unexpected errors during authentication
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

// Route to forget password
router.post('/forget/:email', async (req, res) => {
  const { email } = req.params;

  try {
    // 1. Retrieve user record from the database where email matches
    const [users] = await req.app.locals.db.query('SELECT * FROM user WHERE user_email = ?', [
      email,
    ]);
    const user = users[0]; // Get the first user record

    // 2. Check if the user exists
    if (!user) {
      return res.status(401).json({ action: false, message: 'Invalid email' });
    }

    // 3. Generate OTP or a unique token
    const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP
    const otpExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); // OTP expires in 1 day.
    const otpExpireFormatted = otpExpire.toLocaleString(); // Convert to readable format

    // 4. Store OTP in the database
    await req.app.locals.db.query(
      'UPDATE user SET user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      [otp, otpExpire, email]
    );

    // 5. Email Template
    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
    body { font-family: Arial, sans-serif; text-align: center; background-color: #f4f4f4; padding: 20px; }
    .email-container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); }
    .otp-box { font-size: 24px; font-weight: bold; color: #fff; background: #007bff; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 20px 0; }
    .footer { font-size: 12px; color: #777; margin-top: 20px; }
    </style>
    </head>
    <body>
    <div class="email-container">
      <h2>🔐 Password Reset Request</h2>
      <p>Hello,</p>
      <p>You recently requested to reset your password. Use the OTP below to proceed:</p>
      <div class="otp-box">${otp}</div>
      <p>This OTP is valid until <strong>${otpExpireFormatted}</strong>. Do not share it with anyone.</p>
      <p>If you did not request this, please ignore this email.</p>
      <hr>
      <p class="footer">If you need assistance, contact our support team.</p>
    </div>
    </body>
    </html>
    `;

    // 6. Send the OTP to the user's email
    console.log(`OTP for ${email}: ${otp}`);
    console.log(`OTP expires at: ${otpExpireFormatted}`);

    // Fetch email config from Firebase Remote Config
    const { host, port, username, password } = req.app.locals.fbrc.email_config;
    
    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port == 465, // Use secure connection only for port 465
      auth: { user: username, pass: password },
      tls: { rejectUnauthorized: false }, // Fixes self-signed certificate issue
    });

    await transporter.sendMail({
      from: `"Smart Library Support" <${username}>`,
      to: email,
      subject: '🔐 Password Reset Request',
      html: emailTemplate, // Use HTML content for the email body
    });

    // 7. Send a success response
    res.json({ action: true, message: 'OTP sent successfully' });
  } catch (error) {
    // Handle unexpected errors during OTP generation and sending
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

// Endpoint to activate member account through email verification
router.post('/verify/:email/:otp', async (req, res) => {
  const { email, otp } = req.params;
  const { password } = req.body;

  try {
    // 1. Retrieve user record from the database where email matches and account is inactive
    const [users] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ? AND (user_status = ? OR user_status = ?)',
      [email, '2', '1']
    );
    const user = users[0]; // Get the first user record

    // 2. Check if the user exists
    if (!user) {
      return res.status(401).json({ action: false, message: 'Invalid / inactive account' });
    }

    // 3. Check if the OTP matches and has not expired
    const currentTimestamp = new Date();
    if (user.user_otp !== parseInt(otp) || currentTimestamp > user.user_otp_expire) {
      return res.status(401).json({ action: false, message: 'Invalid OTP / OTP expired' });
    }

    // 4. Hash the password before storing it in the database
    const hashedPassword = await bcrypt.hash(password, 10); // Secure hashing

    // 5. Update the user record to activate the account and set the password
    await req.app.locals.db.query(
      'UPDATE user SET user_status = ?, user_password = ?, user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      ['1', hashedPassword, null, null, email]
    );

    // 6. Send a confirmation email
    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; background-color: #f4f4f4; padding: 20px; }
      .email-container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); }
      .success-box { font-size: 20px; font-weight: bold; color: #fff; background: #28a745; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 20px 0; }
      .footer { font-size: 12px; color: #777; margin-top: 20px; }
    </style>
    </head>
    <body>
      <div class="email-container">
        <h2>✅ Activation / Password Reset Successful</h2>
        <p>Hello,</p>
        <p>Your account has been successfully activated, and your password has been updated.</p>
        <div class="success-box">You can now log in to your account.</div>
        <p>If you did not request this, please contact our support team immediately.</p>
        <hr>
        <p class="footer">If you need assistance, contact our support team.</p>
      </div>
    </body>
    </html>
    `;

    // Fetch email config from Firebase Remote Config
    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;

    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port == 465, // Secure connection only for port 465
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false }, // Fixes self-signed certificate issue
    });

    await transporter.sendMail({
      from: `"Smart Library Support" <${username}>`,
      to: email,
      subject: '✅ Activation / Password Reset Successful',
      html: emailTemplate, // Use HTML content for the email body
    });

    // 7. Send a success response
    res.json({ action: true, message: 'Account activated & password updated successfully' });
  } catch (error) {
    // Handle unexpected errors during account activation
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

module.exports = router;
