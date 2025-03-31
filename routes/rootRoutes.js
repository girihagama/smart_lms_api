const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const router = express.Router();

/**
 * Health check endpoint to verify if the service is running
 */
router.get('/', (req, res) => {
  try {
    res.status(200).json({
      message: 'Service is up and running successfully!',
      firebase: !!req.app.locals.fbrc, // Check Firebase config
      database: !!req.app.locals.db, // Check database connection
    });
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

/**
 * User authentication endpoint that validates credentials and returns a JWT token
 */
router.post('/token', async (req, res) => {
  const { email, password } = req.body; // Extract user email and password

  try {
    // Fetch user details from the database
    const [users] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ? AND user_status = ?',
      [email, '1'] // Only active users can log in
    );
    const user = users[0]; // Retrieve the first user record

    // If no matching user found, return an error
    if (!user) {
      return res
        .status(401)
        .json({ action: false, message: 'Invalid credentials / Inactive account' });
    }

    // Compare the provided password with the hashed password in the database
    const passwordMatch = await bcrypt.compare(password, user.user_password);
    if (!passwordMatch) {
      return res.status(401).json({ action: false, message: 'Invalid credentials' });
    }

    // Create a JWT token with user details
    const payload = {
      user_email: user.user_email,
      user_role: user.user_role,
      user_name: user.user_name,
    };
    const token = jwt.sign(payload, req.app.locals.jwt_secret, { expiresIn: '30d' });

    // Update the last login timestamp in the database
    await req.app.locals.db.query('UPDATE user SET user_last_login = ? WHERE user_email = ?', [
      new Date(),
      email,
    ]);

    // Send a login alert email
    const emailTemplate = `
    <html>
    <body>
      <h2>🔔 New Login Alert</h2>
      <p>Your account was logged into on ${new Date().toLocaleString()}.</p>
      <p>If this wasn't you, reset your password immediately.</p>
    </body>
    </html>
    `;

    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: port == 465, // Use secure connection only for port 465
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: `"Smart Library" <${username}>`,
      to: email,
      subject: '🔔 New Login Alert',
      html: emailTemplate,
    });

    // Return the token to the client
    res.json({ action: true, message: 'Success', token, user: payload });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

/**
 * Request a password reset - Generates an OTP and sends it via email
 */
router.post('/forget/:email', async (req, res) => {
  const { email } = req.params;

  try {
    // Fetch user details
    const [users] = await req.app.locals.db.query('SELECT * FROM user WHERE user_email = ?', [
      email,
    ]);
    const user = users[0];

    if (!user) {
      return res.status(401).json({ action: false, message: 'Invalid email' });
    }

    // Generate a 6-digit OTP and expiry time
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Store OTP in the database
    await req.app.locals.db.query(
      'UPDATE user SET user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      [otp, otpExpire, email]
    );

    // Send OTP via email
    const emailTemplate = `
    <html>
    <body>
      <h2>🔐 Password Reset Request</h2>
      <p>Your OTP for password reset is <strong>${otp}</strong>.</p>
      <p>Valid until: ${otpExpire.toLocaleString()}</p>
    </body>
    </html>
    `;

    const { host, port, username, password } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: port == 465,
      auth: { user: username, pass: password },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: `"Smart Library" <${username}>`,
      to: email,
      subject: '🔐 Password Reset OTP',
      html: emailTemplate,
    });

    res.json({ action: true, message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

/**
 * Verify OTP and activate user account or reset password
 */
router.post('/verify/:email/:otp', async (req, res) => {
  const { email, otp } = req.params;
  const { password } = req.body;

  try {
    // Fetch user details
    const [users] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ? AND (user_status = ? OR user_status = ?)',
      [email, '2', '1']
    );
    const user = users[0];

    if (!user) {
      return res.status(401).json({ action: false, message: 'Invalid / inactive account' });
    }

    // Validate OTP and expiry
    if (user.user_otp !== parseInt(otp) || new Date() > user.user_otp_expire) {
      return res.status(401).json({ action: false, message: 'Invalid OTP / OTP expired' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user details to activate the account and reset password
    await req.app.locals.db.query(
      'UPDATE user SET user_status = ?, user_password = ?, user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      ['1', hashedPassword, null, null, email]
    );

    // Send confirmation email
    const emailTemplate = `
    <html>
    <body>
      <h2>✅ Account Activation / Password Reset Successful</h2>
      <p>Your account is now active, and your password has been updated.</p>
    </body>
    </html>
    `;

    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: port == 465,
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: `"Smart Library" <${username}>`,
      to: email,
      subject: '✅ Activation / Password Reset Successful',
      html: emailTemplate,
    });

    res.json({ action: true, message: 'Account activated & password updated successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ action: false, message: 'Internal Server Error' });
  }
});

module.exports = router;
