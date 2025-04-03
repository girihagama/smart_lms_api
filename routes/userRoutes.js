const express = require('express');
const nodemailer = require('nodemailer');

const router = express.Router();
const { authorizeRole } = require('../middleware/auth'); // Middleware for role-based authorization

// Default route to check API availability
router.get('/', authorizeRole(['Member', 'Librarian']), (req, res) => {
  try {
    res.sendStatus(200); // Sending a simple status response
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error'); // Ensure headers are not sent before responding
    }
  }
});

router.post('/get-total', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const [total] = await req.app.locals.db.query(
      'SELECT Count(*) AS total FROM user WHERE user_status = ?',
      ['1']
    );
    res.json({ message: 'OK', total: total[0].total }); // Send 200 OK status if the service is running
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

// Endpoint to register and invite a new user through the librarian dashboard
router.post('/register', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { email, name, mobile, address, dob, role, max_books = 2 } = req.body;

    // Validate that all required fields are present
    if (!email || !name || !mobile || !address || !dob || !role) {
      return res.status(400).json({ action: false, message: 'All fields are required' });
    }

    // Check if the user already exists in the database
    const [existingUser] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ?',
      [email]
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ action: false, message: 'User already exists' });
    }

    // Insert new user with inactive status (status = 2)
    await req.app.locals.db.query(
      'INSERT INTO user (user_email, user_name, user_mobile, user_address, user_dob, user_role, user_status, user_max_books) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [email, name, mobile, address, dob, role, role === 'Member' ? max_books : 0]
    );

    // Generate a 6-digit OTP for account activation
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiration = new Date();
    otpExpiration.setHours(otpExpiration.getHours() + 24); // OTP expires in 24 hours

    // Store the OTP and its expiration time in the database
    await req.app.locals.db.query(
      'UPDATE user SET user_otp = ?, user_otp_expire = ? WHERE user_email = ?',
      [otp, otpExpiration, email]
    );

    // Email template for OTP notification
    const emailTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; background-color: #f4f4f4; padding: 20px; }
        .email-container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1); }
        h2 { color: #333; margin-bottom: 10px; }
        p { font-size: 16px; color: #333; }
        .otp-box { font-size: 24px; font-weight: bold; color: #fff; background: #007bff; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 20px 0; }
        .footer { font-size: 12px; color: #777; margin-top: 20px; }
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

    // Email sending configuration
    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port == 465, // Use secure connection for port 465
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false }, // Ignore self-signed certificate errors
    });

    // Send the OTP email
    await transporter.sendMail({
      from: `"Smart Library Account" <${username}>`,
      to: email,
      subject: '🔔 Welcome To Smart Library',
      html: emailTemplate,
    });

    res.json({ action: true, message: 'User registered and invitation email sent successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ action: false, message: 'Server error' });
  }
});

//update user details
router.post('/update', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { email, name, mobile, address, dob, role, status, max_books } = req.body;

    // Validate that the required fields are present
    if (!email) {
      return res.status(400).json({ action: false, message: 'Email is required' });
    }

    // Fetch the existing user
    const [existingUser] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ?',
      [email]
    );

    if (existingUser.length === 0) {
      return res.status(404).json({ action: false, message: 'User not found' });
    }

    // Prepare the update query
    const updateFields = [];
    const updateValues = [];

    if (name) {
      updateFields.push('user_name = ?');
      updateValues.push(name);
    }

    if (mobile) {
      updateFields.push('user_mobile = ?');
      updateValues.push(mobile);
    }

    if (address) {
      updateFields.push('user_address = ?');
      updateValues.push(address);
    }

    if (dob) {
      updateFields.push('user_dob = ?');
      updateValues.push(dob);
    }

    if (role) {
      updateFields.push('user_role = ?');
      updateValues.push(role);
    }

    if (status !== undefined) {
      updateFields.push('user_status = ?');
      updateValues.push(status);
    }

    if (max_books !== undefined) {
      updateFields.push('user_max_books = ?');
      updateValues.push(role === 'Librarian' ? 0 : max_books);
    }

    // Ensure at least one field is updated
    if (updateFields.length === 0) {
      return res.status(400).json({ action: false, message: 'No fields to update' });
    }

    // Add the email as the last parameter for the query (to identify which user to update)
    updateValues.push(email);

    // Execute the update query
    const updateQuery = `UPDATE user SET ${updateFields.join(', ')} WHERE user_email = ?`;
    await req.app.locals.db.query(updateQuery, updateValues);

    res.status(200).json({ action: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ action: false, message: 'Server error' });
  }
});

// Endpoint to update a user's account status
router.post('/status', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ action: false, message: 'All fields are required' });
    }

    // Check if user exists before updating status
    const [existingUser] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ?',
      [email]
    );
    if (existingUser.length === 0) {
      return res.status(400).json({ action: false, message: 'User does not exist' });
    }

    // Update user status in the database
    await req.app.locals.db.query('UPDATE user SET user_status = ? WHERE user_email = ?', [
      status,
      email,
    ]);

    res.json({ action: true, message: 'User status updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ action: false, message: 'Server error' });
  }
});

// Endpoint to fetch user information
router.post('/info', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ action: false, message: 'Email is required' });
    }

    // Fetch user details from the database
    const [userInfo] = await req.app.locals.db.query('SELECT * FROM user WHERE user_email = ?', [
      email,
    ]);

    if (userInfo.length === 0) {
      return res.status(404).json({ action: false, message: 'User not found' });
    }

    // Remove sensitive fields before returning the response
    delete userInfo[0].user_password;
    delete userInfo[0].user_otp;
    delete userInfo[0].user_otp_expire;

    res.json({ action: true, message: 'User found', user: userInfo[0] });
  } catch (error) {
    console.error('Error fetching user information:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

// Endpoint to update a user's device ID
router.post('/device', authorizeRole(['Member']), async (req, res) => {
  const email = req.user.user_email;
  const { device_id } = req.body;

  if (!email || !device_id) {
    return res.status(400).json({ action: false, message: 'Device ID is required' });
  }

  try {
    // Update the user's device ID in the database
    await req.app.locals.db.query('UPDATE user SET user_device_id = ? WHERE user_email = ?', [
      device_id,
      email,
    ]);

    res.json({ action: true, message: 'Device ID updated successfully' });
  } catch (error) {
    console.error('Error updating device ID:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

router.post('/search', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { searchTerm, page = 1, limit = 10 } = req.body;
    const offset = (page - 1) * limit;

    let query, countQuery, queryParams;

    const searchQuery = `%${searchTerm}%`; // Wildcard for partial matching

    if (searchTerm) {
      const searchQuery = `%${searchTerm}%`; // Wildcard for partial matching

      query = `
    SELECT * FROM user 
    WHERE user_email LIKE ? OR user_name LIKE ? OR user_mobile LIKE ? OR user_address LIKE ? 
    ORDER BY user_registration_date DESC 
    LIMIT ? OFFSET ?`;

      countQuery = `
    SELECT COUNT(*) AS totalUsers 
    FROM user 
    WHERE user_email LIKE ? OR user_name LIKE ? OR user_mobile LIKE ? OR user_address LIKE ?`;

      queryParams = [
        searchQuery,
        searchQuery,
        searchQuery,
        searchQuery,
        Number(limit),
        Number(offset),
      ];
      countParams = [searchQuery, searchQuery, searchQuery, searchQuery]; // Separate params for count query
    } else {
      query = `SELECT * FROM user ORDER BY user_registration_date DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) AS totalUsers FROM user`;
      queryParams = [Number(limit), Number(offset)];
      countParams = []; // No params needed for count query
    }

    // Get total user count
    const [[{ totalUsers }]] = await req.app.locals.db.query(countQuery, countParams);

    // Fetch users
    const [users] = await req.app.locals.db.query(query, queryParams);

    // Format response to exclude sensitive data
    const formattedUsers = users.map(
      ({ user_password, user_otp, user_otp_expire, user_device_id, ...safeUser }) => safeUser
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found' });
    }

    res.status(200).json({
      message: 'Users retrieved successfully',
      data: formattedUsers,
      pagination: {
        totalUsers,
        currentPage: Number(page),
        totalPages: Math.ceil(totalUsers / limit),
        perPage: Number(limit),
      },
    });
  } catch (error) {
    console.error('Error searching for users:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

module.exports = router;
