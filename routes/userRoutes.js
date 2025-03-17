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

//endpoint to register and invite a new member through the librarian dashboard
router.post('/member/invite/:email', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { email } = req.params;

    const { host, port, username, password } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port,
      auth: {
        user: username,
        pass: password,
      },
    });

    return;

    // Check if user already exists
    const [existingUser] = await db.query(
      'SELECT * FROM user WHERE user_email = ? AND user_status IS NOT ?',
      [email, '2']
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP or a unique token
    const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP
    const otpExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); // OTP expires in 15 minutes

    // Store OTP in database
    await db.query(
      'INSERT INTO user (user_email, user_role, user_status, user_otp, user_otp_expire) VALUES (?, ?, ?, ?, ?)',
      [email, 'Member', 0, otp, otpExpire]
    );

    // Send invitation email
    await sendEmail(email, 'Library Membership Invitation', `Your OTP for registration: ${otp}`);

    res.json({ message: 'Invitation sent successfully', otp });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
