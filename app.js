// Import required modules
const express = require('express'); // Web framework for Node.js
const bodyParser = require('body-parser'); // Middleware for parsing JSON request bodies
const cors = require('cors'); // Middleware for handling Cross-Origin Resource Sharing
const mysql = require('mysql2/promise'); // MySQL client with Promise support
const admin = require('firebase-admin'); // Firebase Admin SDK for authentication and remote config
const cron = require('node-cron'); // Scheduler for running automated tasks
const path = require('path'); // Utility for handling file paths
const fs = require('fs'); // File system module

// Import route handlers
const rootRoutes = require('./routes/rootRoutes');
const userRoutes = require('./routes/userRoutes');
const bookRoutes = require('./routes/bookRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

// Import middleware functions
const { authenticateJWT } = require('./middleware/auth');
const upload = require('./middleware/multer');

const app = express();

// Middleware setup
//allow requests from everywhere
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST'],
  })
);

// Increase JSON payload size limit (default is 1MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json());

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static('uploads'));

// Path to Firebase service account credentials
const serviceAccount = path.join(__dirname, './firebase-service-account.json');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log('✅ Firebase initialized successfully');

// Function to fetch database configuration from Firebase Remote Config
const getRemoteConfig = async () => {
  try {
    const remoteConfig = await admin.remoteConfig().getTemplate();
    let fbRemConfig = remoteConfig.parameters.REMOTE_CONFIG.defaultValue.value;
    return JSON.parse(fbRemConfig);
  } catch (error) {
    console.error('❌ Error fetching remote config:', error);
    return null;
  }
};

// Database connection variable
let db = null;

// Self-executing async function to initialize database and start server
(async () => {
  const remConfig = await getRemoteConfig();
  if (!remConfig || !remConfig.db_config) {
    console.error('❌ Failed to fetch database config. Exiting...');
    process.exit(1);
  }

  const { db_config, jwt_secret } = remConfig;

  try {
    db = mysql.createPool({
      host: db_config.host,
      user: db_config.user,
      password: db_config.password,
      database: db_config.database,
    });

    await db.getConnection(); // Verify database connection
    console.log('✅ Database initialized successfully');

    // Middleware to attach config, Firebase, and DB to requests
    app.use((req, res, next) => {
      req.app.locals.fbrc = remConfig;
      req.app.locals.firebaseadmin = admin;
      req.app.locals.db = db;
      req.app.locals.jwt_secret = jwt_secret;
      next();
    });

    // Define API routes
    app.use('/', rootRoutes);
    app.use('/user', authenticateJWT, userRoutes);
    app.use('/book', authenticateJWT, bookRoutes);
    app.use('/transaction', authenticateJWT, transactionRoutes);

    // Handle 404 errors for undefined routes
    app.use((req, res) => {
      res.status(404).json({ message: '❌ Route not found.' });
    });

    // Function to update overdue transactions
    const updateDue = () => {
      console.log('Running updateDue at', new Date().toLocaleString());

      // Set transaction status to 'Due' if return date has passed
      db.query(
        `UPDATE transaction 
         SET transaction_status = ?, 
             transaction_late_days = DATEDIFF(NOW(), transaction_return_date), 
             transaction_late_payments = transaction_late_fee * DATEDIFF(NOW(), transaction_return_date) 
         WHERE transaction_status = ? 
           AND transaction_return_date < NOW()`,
        ['Due', 'issued']
      )
        .then(() => console.log('✅ Transaction status updated'))
        .catch((error) => console.error('❌ Error updating transactions:', error));

      // Update late fees for transactions already marked as 'Due'
      db.query(
        `UPDATE transaction 
         SET transaction_late_days = DATEDIFF(NOW(), transaction_return_date), 
             transaction_late_payments = transaction_late_fee * DATEDIFF(NOW(), transaction_return_date) 
         WHERE transaction_status = ? 
           AND transaction_return_date < NOW()`,
        ['Due']
      )
        .then(() => console.log('✅ Late fees updated'))
        .catch((error) => console.error('❌ Error updating late fees:', error));
    };

    // Function to update late fees separately
    const updateFees = () => {
      console.log('Running updateFees at', new Date().toLocaleString());
      db.query(
        `UPDATE transaction 
         SET transaction_late_payments = transaction_late_fee * transaction_late_days 
         WHERE transaction_late_days > 0`
      )
        .then(() => console.log('✅ Late fees updated'))
        .catch((error) => console.error('❌ Error updating late fees:', error));
    };

    // Function to send due reminders via push notifications and email
    const sendDueNotification = async () => {
      const days = 7;
      try {
        console.log('Running sendDueNotification at', new Date().toLocaleString());

        // Step 1: Fetch all due transactions along with user details, considering the days parameter
        const query = `
      SELECT t.transaction_id, b.book_name, u.user_email, u.user_device_id, t.transaction_return_date
      FROM transaction t
      JOIN view_fcm_tokens u ON t.transaction_user_email = u.user_email
      JOIN book b ON t.transaction_book_id = b.book_id
      WHERE t.transaction_status = 'Issued'
      AND t.transaction_return_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY);
    `;

        const [dueTransactions] = await db.query(query, [days]);

        if (dueTransactions.length === 0) {
          console.log(`No due transactions found for ${days} day(s)`);
          return { message: `No due transactions found for ${days} day(s)` };
        }

        let notificationsSent = 0;

        // Step 2: Send notifications for each due transaction
        for (const transaction of dueTransactions) {
          const { transaction_id, book_name, user_email, user_device_id } = transaction;

          if (!user_device_id) {
            console.warn(`Skipping user ${user_email} (No device ID)`);
            continue; // Skip if no device ID
          }

          const firebaseMessage = {
            token: user_device_id,
            notification: {
              title: `Smart Library Return Reminder for ${book_name}`,
              body: `Your book "${book_name}" (Transaction ID: ${transaction_id}) is due in a few days. Please return it on time to avoid late charges.`,
            },
          };

          try {
            await admin.messaging().send(firebaseMessage);
            console.log(`FCM notification sent to ${user_email} for "${book_name}"`);
            notificationsSent++;
          } catch (error) {
            console.error(`Error sending FCM notification to ${user_email}:`, error);
          }
        }

        // Return status of notifications sent
        return { message: `${notificationsSent} notifications sent successfully.` };
      } catch (error) {
        console.error('Error in sendDueNotification:', error);
        throw new Error('Internal server error while sending due notifications.');
      }
    };

    // Schedule cron jobs
    cron.schedule('0 12,18 * * *', sendDueNotification); // Runs at 12 PM, and 6 PM
    cron.schedule('0 6,12,18 * * *', updateFees); // Runs at 6 AM, 12 PM, and 6 PM
    cron.schedule('* * * * *', updateDue); // Runs every minute
    console.log('✅ Cron jobs scheduled successfully');

    // Start the server
    const PORT = process.env.PORT || 8090;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error('Failed to initialize or connect to the database:', error);
    process.exit(1);
  }
})();

// Export the app for testing purposes
module.exports = app;
