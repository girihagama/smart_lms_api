const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

router.get('/', (req, res) => {
  // A simple GET request handler
  try {
    // Responding with HTTP 200 OK to indicate the service is running
    res.sendStatus(200);
  } catch (error) {
    // Handling any unexpected errors
    console.error('Error:', error);
    if (!res.headersSent) {
      // Ensuring headers are not already sent before responding
      res.status(500).send('Internal Server Error');
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
      return res.status(401).json({ message: 'Invalid credentials / Inactive account' });
    }

    // 3. Validate the provided password against the stored hashed password
    const passwordMatch = await bcrypt.compare(password, user.user_password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 4. Generate a JWT token with the user's email and role
    const payload = {
      user_email: user.user_email, // Include user's email
      user_role: user.user_role, // Include user's role
    };
    const token = jwt.sign(payload, req.app.locals.jwt_secret, { expiresIn: '1h' });

    // 5. Send the generated token back to the client
    res.json({ token });
  } catch (error) {
    // Handle unexpected errors during authentication
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

//endpoint to activate member account through email link
router.post('/verify/:email/:otp', async (req, res) => {});

module.exports = router;
