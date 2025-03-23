// Import required modules
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Route imports for different functionalities of the app
const rootRoutes = require('./routes/rootRoutes');
const userRoutes = require('./routes/userRoutes');
const bookRoutes = require('./routes/bookRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

// Import middlewares
const { authenticateJWT } = require('./middleware/auth');
const upload = require('./middleware/multer');

const app = express();
// Middleware setup for CORS and parsing JSON request bodies
app.use(cors());
app.use(bodyParser.json());

//serve static file
app.use('/uploads', express.static('uploads'));

// Path to the Firebase service account credentials
const serviceAccount = path.join(__dirname, './firebase-service-account.json');

// Initialize Firebase Admin SDK with the service account credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log('Firebase initialized successfully');

// Function to fetch database configuration from Firebase Remote Config
const getRemoteConfig = async () => {
  try {
    // Fetching the remote config from Firebase
    const remoteConfig = await admin.remoteConfig().getTemplate();

    // Parsing the database configuration from the fetched remote config
    let fbRemConfig = remoteConfig.parameters.REMOTE_CONFIG.defaultValue.value;
    fbRemConfig = JSON.parse(fbRemConfig);

    // Returning the parsed fbRem config
    return fbRemConfig;
  } catch (error) {
    // Log error if fetching remote config fails
    console.error('Error fetching remote config:', error);
    return null; // Return null if there's an error
  }
};

// Initialize MySQL connection after fetching database configuration and then start the server
let db = null;

// Self-executing async function to handle database initialization and server startup
(async () => {
  // Fetch the database config
  const remConfig = await getRemoteConfig().then((config) => {
    return config;
  });
  const dbConfig = remConfig.db_config;
  const jwtSecret = remConfig.jwt_secret;

  // If no config is fetched, exit the process
  if (!dbConfig) {
    console.error('Failed to fetch database config. Exiting...');
    process.exit(1); // Exit with failure status code
  }

  try {
    // Create a MySQL connection pool with the fetched database config
    db = mysql.createPool({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
    });

    // Test the connection by trying to get a connection from the pool
    await db.getConnection(); // This ensures that the connection works
    console.log('Database initialized successfully');

    // Middleware to attach firebase
    app.use((req, res, next) => {
      req.app.locals.fbrc = remConfig;
      next();
    });
    app.use((req, res, next) => {
      req.app.locals.firebaseadmin = admin;
      next();
    });

    // Middleware to attach db to request object
    app.use((req, res, next) => {
      req.app.locals.db = db;
      next();
    });
    // Middleware to attach jwt secret to request object
    app.use((req, res, next) => {
      req.app.locals.jwt_secret = jwtSecret;
      next();
    });

    // Define and use the application routes
    app.use('/', rootRoutes); // Root routes for the app
    app.use('/user', authenticateJWT, userRoutes); // Routes related to user operations
    app.use('/book', authenticateJWT, bookRoutes); // Routes related to book operations
    app.use('/transaction', authenticateJWT, transactionRoutes); // Routes for transaction management

    // Handle 404 errors for any other undefined routes
    app.use((req, res, next) => {
      res.status(404).json({
        message: 'Route not found. Please check the URL and try again.',
      });
    });

    // update due fees of transactions
    const updateDue = () => {
      console.log("🕒 Function executed at", new Date().toLocaleString());
      //set due status to transactions
      db.query('UPDATE transaction SET transaction_status = ?, transaction_late_days = DATEDIFF(NOW(), transaction_return_date), transaction_late_payments = transaction_late_fee * DATEDIFF(NOW(), transaction_return_date) WHERE transaction_status = ? AND transaction_return_date < NOW()', ['Due', 'issued'])
        .then(() => {
          console.log('Transaction status updated successfully!');
        })
        .catch((error) => {
          console.error('Error updating transactions:', error);
        });

      // update due fees of transactions
      db.query('UPDATE transaction SET transaction_late_days = DATEDIFF(NOW(), transaction_return_date), transaction_late_payments = transaction_late_fee * DATEDIFF(NOW(), transaction_return_date) WHERE transaction_status = ? AND transaction_return_date < NOW()', ['due'])
        .then(() => {
          console.log('Late fees updated successfully!');
        })
        .catch((error) => {
          console.error('Error updating late fees:', error);
        });
    };

    // send return push notification and email
    const sendDueNotification = () => {
      console.log("🕒 Function executed at", new Date().toLocaleString());
      // Send firebase cloud message to everyone who has due and remaining days are less than 3
    };

    //cron.schedule('0 0,6,12,18 * * *', automatedTask); // Schedule the cron job to run every 6 hours
    cron.schedule('0 6,12,18 * * *', sendDueNotification); // Schedule the cron job to run at 6,12,18 hours
    cron.schedule('* * * * *', updateDue); // Schedule the cron job to run every 1 min
    console.log('✅ Cron jobs scheduled!');

    // Start the server on the specified port
    const PORT = process.env.PORT || 8090; // Use environment variable or fallback to 8080
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    // Handle errors in database connection or initialization
    console.error('Failed to initialize or connect to the database:', error);
    process.exit(1); // Exit the process with failure if database initialization fails
  }
})();
