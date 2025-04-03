const express = require('express');
const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');

const router = express.Router();
dayjs.extend(relativeTime);

// Import middleware for role-based access control
const { authorizeRole } = require('../middleware/auth');

// Root route to check if the service is running
router.get('/', authorizeRole(['Member', 'Librarian']), (req, res) => {
  try {
    res.sendStatus(200); // Sends HTTP 200 OK response
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

router.post('/get-total', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const [total] = await req.app.locals.db.query('SELECT Count(*) AS total FROM transaction', []);
    res.json({ message: 'OK', total: total[0].total }); // Send 200 OK status if the service is running
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

// Route to borrow a book
router.post('/borrow', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { book_id, user_email = req.user.user_email } = req.body; // Get book ID from the request body

    // Validate input
    if (!user_email || !book_id) {
      return res.status(400).json({ action: false, message: 'User ID and Book ID are required' });
    }

    // Check if the user has reached their borrow limit
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?)',
      [user_email, 'issued', 'due']
    );

    const [userCheck] = await req.app.locals.db.query(
      'SELECT * FROM user WHERE user_email = ? AND user_status = ? AND user_role = ?',
      [user_email, '1', 'Member']
    );

    if (userCheck.length == 0) {
      return res.status(400).json({ action: false, message: 'Invalid / inactive member.' });
    }

    if (borrowedBooks.length >= userCheck[0].user_max_books) {
      return res
        .status(400)
        .json({ action: false, message: 'User has already borrowed the maximum number of books' });
    }

    // Check if the book exists and is active
    const [book] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [book_id]);

    if (book.length === 0) {
      return res.status(404).json({ action: false, message: 'Book not found' });
    } else if (book[0].book_status === '0') {
      return res.status(400).json({ action: false, message: 'Book is inactive' });
    }

    // Check if the book is already borrowed
    const [bookAvailability] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_book_id = ? AND (transaction_status = ? OR transaction_status = ?)',
      [book_id, 'issued', 'due']
    );

    if (bookAvailability.length > 0) {
      return res.status(400).json({ action: false, message: 'Book is not available to borrow' });
    }

    // Generate borrow and return dates
    const borrowDate = new Date();
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + 14); // Return date set to 14 days later

    // Create a new transaction for borrowing the book
    await req.app.locals.db.query(
      'INSERT INTO transaction (transaction_user_email, transaction_book_id, transaction_status, transaction_borrow_date, transaction_return_date, transaction_late_fee) VALUES (?, ?, ?, ?, ?, ?)',
      [user_email, book_id, 'issued', borrowDate, returnDate, parseFloat(book[0].book_late_fee)]
    );

    // Get user's name
    const [user] = await req.app.locals.db.query(
      'SELECT user_name FROM user WHERE user_email = ?',
      [user_email]
    );

    // Prepare and send email notification
    const emailTemplate = `
      <!DOCTYPE html>
      <html>
      <body>
        <p>Hello ${user[0].user_name},</p>
        <p>You have successfully borrowed the book "${book[0].book_name}".</p>
        <p><b>Borrow Date: ${borrowDate.toDateString()}</b></p>
        <p><b>Return Date: ${returnDate.toDateString()}</b></p>
      </body>
      </html>
    `;

    const { host, port, username, password: emailPassword } = req.app.locals.fbrc.email_config;
    const transporter = nodemailer.createTransport({
      host: host,
      port: parseInt(port),
      secure: port == 465,
      auth: { user: username, pass: emailPassword },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: `"Smart Library" <${username}>`,
      to: user_email,
      subject: '📚 Book Borrowed Successfully',
      html: emailTemplate,
    });

    res.status(200).json({ message: 'Book borrowed successfully' });

    // Update book readers count
    await req.app.locals.db.query(
      'UPDATE book SET book_readers = book_readers + 1 WHERE book_id = ?',
      [book_id]
    );
  } catch (error) {
    console.error('Error borrowing book:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

// Route to return a book
router.post('/return', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { transaction_id, book_id, user_email, receipt_id } = req.body;

    if (!book_id || !transaction_id || !user_email) {
      return res.status(400).json({ message: 'Book ID, Transactio ID, User Email are required' });
    }

    // Fetch the transaction details using the book_id where the status is 'Issued'
    const [transaction] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_id = ? AND transaction_book_id = ? AND transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?) LIMIT 1',
      [transaction_id, book_id, user_email, 'Issued', 'Due']
    );

    if (transaction.length === 0) {
      return res.status(404).json({ message: 'Transaction not found or book already returned' });
    }

    if (transaction[0].transaction_status === 'Due') {
      if (!receipt_id) {
        return res.status(400).json({ message: 'Receipt ID is required' });
      }
      // Update due transaction
      const [result] = await req.app.locals.db.query(
        'UPDATE transaction SET transaction_status = ?, transaction_return_date = NOW(), transaction_late_paid = ?  WHERE transaction_id = ? AND transaction_book_id = ? AND transaction_user_email = ? AND transaction_status = ?',
        ['Returned', receipt_id, transaction[0].transaction_id, book_id, user_email, 'Due']
      );
      if (result.affectedRows === 0) {
        return res.status(400).json({
          message: 'No transaction was updated. Incorrect details provided.',
        });
      }

      res.status(200).json({ message: 'Book returned successfully.' });
    } else if (transaction[0].transaction_status === 'Issued') {
      // Update issued transaction
      const [result] = await req.app.locals.db.query(
        'UPDATE transaction SET transaction_status = ?, transaction_return_date = NOW()  WHERE transaction_id = ? AND transaction_book_id = ? AND transaction_user_email = ? AND transaction_status = ?',
        ['Returned', transaction[0].transaction_id, book_id, user_email, 'Issued']
      );
      if (result.affectedRows === 0) {
        return res.status(400).json({
          message: 'No transaction was updated. Incorrect details provided.',
        });
      }

      res.status(200).json({ message: 'Book returned successfully.' });
    }
  } catch (error) {
    console.error('Error during book return:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

// Route to get borrowing history
router.post('/history', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const user_email = req.user.user_email;
    const { page = 1, limit = 10, user_id = user_email } = req.body;

    if (!user_id) {
      return res.status(400).json({ action: false, message: 'User ID is required' });
    }

    // Get borrowing history from database
    const [totalBooks] = await req.app.locals.db.query(
      'SELECT count(*) AS total FROM transaction WHERE transaction_user_email = ? AND transaction_status = ?',
      [user_id, 'returned']
    );

    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND transaction_status = ? ORDER BY transaction_borrow_date DESC LIMIT ? OFFSET ?',
      [user_id, 'returned', limit, (page - 1) * limit]
    );

    // Format response
    const formattedBooks = borrowedBooks.map((book) => ({
      ...book,
      book_image: req.app.locals.fbrc.api_base_url + book.book_image.replace(/\\/g, '/'),
      transaction_return: 'return ' + dayjs(book.transaction_return_date).fromNow(),
    }));

    res.status(200).json({
      action: true,
      message: 'Borrowed books retrieved successfully',
      data: formattedBooks,
      pagination: {
        total: totalBooks[0].total,
        limit: limit,
        page: page,
        pages: Math.ceil(totalBooks[0].total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching borrowed books:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

//get list of books that are currently borrowed by a member
router.post('/borrowed', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const user_email = req.user.user_email;
    const { user_id = user_email } = req.body;

    if (!user_id) {
      return res.status(400).json({ action: false, message: 'User ID is required' });
    }

    // Query to fetch borrowed books by a specific user join the book table
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?)',
      [user_id, 'issued', 'due']
    );

    if (borrowedBooks.length === 0) {
      return res
        .status(404)
        .json({ action: false, message: ['No borrowed books found for the user'], data: [] });
    }

    // Map and assign the result
    const updatedBooks = borrowedBooks.map((txn) => ({
      ...txn,
      book_image: req.app.locals.fbrc.api_base_url + txn.book_image.replace(/\\/g, '/'),
      transaction_return: 'return ' + dayjs(txn.transaction_return_date).fromNow(),
    }));

    res.status(200).json({
      action: true,
      message: 'Borrowed books retrieved successfully',
      data: updatedBooks,
    });
  } catch (error) {
    console.error('Error fetching borrowed books:', error);

    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

//get list of all books borrwed by the member
router.post('/fined', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const user_email = req.user.user_email;
    //add page and limit
    const { page = 1, limit = 10, user_id = user_email } = req.body;

    if (!user_id) {
      return res.status(400).json({ action: false, message: 'User ID is required' });
    }

    // Query to fetch fined transaction by a specific user join the book table
    const [totalBooks] = await req.app.locals.db.query(
      'SELECT count(*) AS total FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?) AND transaction_late_days > 0 ORDER BY transaction_borrow_date DESC',
      [user_id, 'returned', 'due']
    );
    const [finedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?) AND transaction_late_days > 0 ORDER BY transaction_borrow_date DESC LIMIT ? OFFSET ?',
      [user_id, 'returned', 'due', limit, (page - 1) * limit]
    );

    // Modify the results to include a concatenated field
    const formattedBooks = finedBooks.map((book) => ({
      ...book,
      book_image: req.app.locals.fbrc.api_base_url + book.book_image.replace(/\\/g, '/'),
      transaction_return: 'return ' + dayjs(book.transaction_return_date).fromNow(),
    }));

    if (finedBooks.length === 0) {
      return res.status(404).json({
        action: false,
        message: ['No fined books found for the user'],
        data: [],
        pagination: {
          total: totalBooks[0].total,
          limit: limit,
          page: page,
          pages: Math.ceil(finedBooks.length / limit),
        },
      });
    }

    res.status(200).json({
      action: true,
      message: 'Fined books retrieved successfully',
      data: formattedBooks,
      pagination: {
        total: totalBooks[0].total,
        limit: limit,
        page: page,
        pages: Math.ceil(finedBooks.length / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching fined books:', error);

    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

//add transaction rating
router.post('/rate', authorizeRole(['Member']), async (req, res) => {
  try {
    const { transaction_id, rating } = req.body;
    const user_id = req.user.user_email;

    if (!transaction_id || !rating) {
      return res
        .status(400)
        .json({ action: false, message: 'Transaction ID and Rating are required' });
    }

    // Check if the transaction exists
    const [transaction] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_id = ?',
      [transaction_id]
    );

    if (transaction.length === 0) {
      return res.status(404).json({ action: false, message: 'Transaction not found' });
    }

    // Check if the transaction is already rated
    if (transaction[0].transaction_rating !== null) {
      return res.status(400).json({ action: false, message: 'Transaction is already rated' });
    }

    //rating cannot be added after 1month from return date
    const returnDate = new Date(transaction[0].transaction_return_date);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate - returnDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return res
        .status(400)
        .json({ action: false, message: 'Rating cannot be added after 30 days from return date' });
    }

    // Update the transaction with the rating
    await req.app.locals.db.query(
      'UPDATE transaction SET transaction_rating = ? WHERE transaction_id = ? AND transaction_user_email = ?',
      [rating, transaction_id, user_id]
    );

    res.status(200).json({ action: true, message: 'Transaction rated successfully' });
  } catch (error) {
    console.error('Error rating transaction:', error);

    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

router.post('/search', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { searchTerm, transactionStatus, page = 1, limit = 10 } = req.body;
    const offset = (page - 1) * limit;

    let query,
      countQuery,
      queryParams = [],
      countParams = [];

    // Determine if transaction status should be filtered
    const filterByStatus = transactionStatus && transactionStatus !== 'All';
    const statusCondition = filterByStatus ? 'AND t.transaction_status = ?' : '';

    if (searchTerm) {
      const searchQuery = `%${searchTerm}%`; // Wildcard for partial matching

      query = `
        SELECT t.*, u.user_email, b.book_name 
        FROM transaction t
        LEFT JOIN user u ON t.transaction_user_email = u.user_email
        LEFT JOIN book b ON t.transaction_book_id = b.book_id
        WHERE (t.transaction_id LIKE ? OR u.user_email LIKE ? OR b.book_name LIKE ? OR b.book_id LIKE ?) 
        ${statusCondition}
        ORDER BY t.transaction_borrow_date DESC 
        LIMIT ? OFFSET ?`;

      countQuery = `
        SELECT COUNT(*) AS totalTransactions
        FROM transaction t
        LEFT JOIN user u ON t.transaction_user_email = u.user_email
        LEFT JOIN book b ON t.transaction_book_id = b.book_id
        WHERE (t.transaction_id LIKE ? OR u.user_email LIKE ? OR b.book_name LIKE ? OR b.book_id LIKE ?) 
        ${statusCondition}`;

      queryParams = [searchQuery, searchQuery, searchQuery, searchQuery];
      countParams = [searchQuery, searchQuery, searchQuery, searchQuery];

      if (filterByStatus) {
        queryParams.push(transactionStatus);
        countParams.push(transactionStatus);
      }

      queryParams.push(Number(limit), Number(offset));
    } else {
      query = `
        SELECT t.*, u.user_email, b.book_name 
        FROM transaction t
        LEFT JOIN user u ON t.transaction_user_email = u.user_email
        LEFT JOIN book b ON t.transaction_book_id = b.book_id
        ${filterByStatus ? 'WHERE t.transaction_status = ?' : ''}
        ORDER BY t.transaction_borrow_date DESC 
        LIMIT ? OFFSET ?`;

      countQuery = `
        SELECT COUNT(*) AS totalTransactions 
        FROM transaction t
        ${filterByStatus ? 'WHERE t.transaction_status = ?' : ''}`;

      if (filterByStatus) {
        queryParams.push(transactionStatus);
        countParams.push(transactionStatus);
      }

      queryParams.push(Number(limit), Number(offset));
    }

    // Get total transaction count
    const [[{ totalTransactions }]] = await req.app.locals.db.query(countQuery, countParams);

    // Fetch transactions
    const [transactions] = await req.app.locals.db.query(query, queryParams);

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'No transactions found' });
    }

    res.status(200).json({
      message: 'Transactions retrieved successfully',
      data: transactions,
      pagination: {
        totalTransactions,
        currentPage: Number(page),
        totalPages: Math.ceil(totalTransactions / limit),
        perPage: Number(limit),
      },
    });
  } catch (error) {
    console.error('Error searching for transactions:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

router.post('/one', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const { book_id } = req.body;

    if (!book_id) {
      return res.status(400).json({ message: 'Book ID is required' });
    }

    // Query to fetch the latest transaction of a book
    const query = `
      SELECT t.*, u.user_email, u.user_name, b.book_name 
      FROM transaction t
      LEFT JOIN user u ON t.transaction_user_email = u.user_email
      LEFT JOIN book b ON t.transaction_book_id = b.book_id
      WHERE t.transaction_book_id = ? AND (t.transaction_status = ? OR t.transaction_status = ?)
      LIMIT 1;`;

    const [transaction] = await req.app.locals.db.query(query, [book_id, 'due', 'issued']);

    if (transaction.length === 0) {
      return res.status(404).json({ message: 'No transactions found for this book' });
    }

    res.status(200).json({
      message: 'Transaction retrieved successfully',
      transaction: transaction[0], // Return the latest transaction
    });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

router.post('/due-notify', authorizeRole(['Librarian']), async (req, res) => {
  try {
    // Step 1: Fetch all due transactions along with user details
    const query = `
      SELECT t.transaction_id, b.book_name, u.user_email, u.user_device_id
      FROM transaction t
      JOIN view_fcm_tokens u ON t.transaction_user_email = u.user_email
      JOIN book b ON t.transaction_book_id = b.book_id
      WHERE t.transaction_status = 'Due'
    `;

    const [dueTransactions] = await req.app.locals.db.query(query);

    if (dueTransactions.length === 0) {
      return res.status(200).json({ message: 'No due transactions found' });
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
          title: `Smart Library Due Reminder for ${book_name}`,
          body: `Your book "${book_name}" (Transaction ID: ${transaction_id}) is due. Please return it.`,
        },
      };

      try {
        await req.app.locals.firebaseadmin.messaging().send(firebaseMessage);
        console.log(`FCM notification sent to ${user_email} for "${book_name}"`);
        notificationsSent++;
      } catch (error) {
        console.error(`Error sending FCM notification to ${user_email}:`, error);
      }
    }

    res.status(200).json({
      message: `Due notifications sent successfully to ${notificationsSent} users.`,
    });
  } catch (error) {
    console.error('Error sending due notifications:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.post('/due-early-notify/:days', authorizeRole(['Librarian']), async (req, res) => {
  try {
    // Get the number of days before the due date from the route parameters
    const { days = 7 } = req.params;

    if (!days || isNaN(days)) {
      return res.status(400).json({ message: 'Invalid days parameter' });
    }

    // Step 1: Fetch all due transactions along with user details, considering the days parameter
    const query = `
      SELECT t.transaction_id, b.book_name, u.user_email, u.user_device_id, t.transaction_return_date
      FROM transaction t
      JOIN view_fcm_tokens u ON t.transaction_user_email = u.user_email
      JOIN book b ON t.transaction_book_id = b.book_id
      WHERE t.transaction_status = 'Issued'
      AND t.transaction_return_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY);
    `;

    const [dueTransactions] = await req.app.locals.db.query(query, days);

    if (dueTransactions.length === 0) {
      return res.status(200).json({ message: `No due transactions found for ${days} day(s)` });
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
          body: `Your book "${book_name}" (Transaction ID: ${transaction_id}) is due in few days. Please return it on time to avoide late charges.`,
        },
      };

      try {
        await req.app.locals.firebaseadmin.messaging().send(firebaseMessage);
        console.log(`FCM notification sent to ${user_email} for "${book_name}"`);
        notificationsSent++;
      } catch (error) {
        console.error(`Error sending FCM notification to ${user_email}:`, error);
      }
    }

    res.status(200).json({
      message: `Due notifications sent successfully to ${notificationsSent} users.`,
    });
  } catch (error) {
    console.error('Error sending due notifications:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Export the router
module.exports = router;
