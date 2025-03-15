const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const userRoutes = require('./routes/userRoutes');
const bookRoutes = require('./routes/bookRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use('/users', userRoutes);
app.use('/books', bookRoutes);
app.use('/transactions', transactionRoutes);

const db = require('./config/db');

// Function to check if database connection is established
function isDatabaseConnected() {
  return new Promise((resolve, reject) => {
    if (db().state === 'disconnected') {
      setTimeout(() => {
        isDatabaseConnected().then(resolve).catch(reject); // Recursive call
      }, 1000); // Check every 1 second
    } else {
      resolve();
    }
  });
}

// Start server after database connection is established
isDatabaseConnected()
  .then(() => {
    const port = 3000;
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
  });
