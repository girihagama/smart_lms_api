const mysql = require('mysql2');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function getRemoteConfig() {
  try {
    const remoteConfig = await admin.remoteConfig().getTemplate();
    const parameters = remoteConfig.parameters;

    const dbConfig = {
      host: parameters.db_host.defaultValue.value,
      user: parameters.db_user.defaultValue.value,
      password: parameters.db_password.defaultValue.value,
      database: parameters.db_name.defaultValue.value,
    };

    return dbConfig;
  } catch (error) {
    console.error('Error fetching remote config:', error);
    throw error; // Re-throw the error to prevent the app from starting
  }
}

let connection;

async function initializeConnection() {
  try {
    const dbConfig = await getRemoteConfig();
    connection = mysql.createConnection(dbConfig);

    connection.connect((err) => {
      if (err) {
        console.error('Error connecting to MySQL:', err.message);
        process.exit(1); // Exit if database connection fails
      }
      console.log('Connected to MySQL database');
    });
  } catch (error) {
    console.error('Failed to initialize database connection:', error);
    process.exit(1); // Exit if Remote Config or connection fails
  }
}

initializeConnection();

module.exports = () => connection;