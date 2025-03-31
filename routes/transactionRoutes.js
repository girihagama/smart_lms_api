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

// Route to borrow a book
router.post('/borrow', authorizeRole(['Member']), async (req, res) => {
  try {
    const user_email = req.user.user_email; // Get user's email from the request
    const { book_id } = req.body; // Get book ID from the request body

    // Validate input
    if (!user_email || !book_id) {
      return res.status(400).json({ action: false, message: 'User ID and Book ID are required' });
    }

    // Check if the user has reached their borrow limit
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_user_email = ? AND (transaction_status = ? OR transaction_status = ?)',
      [user_email, 'issued', 'due']
    );

    const [borrowLimit] = await req.app.locals.db.query(
      'SELECT user_max_books FROM user WHERE user_email = ?',
      [user_email]
    );

    if (borrowedBooks.length >= borrowLimit[0].user_max_books) {
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
router.get('/return', authorizeRole(['Librarian']), (req, res) => {
  try {
    res.sendStatus(200);
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
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

// Export the router
module.exports = router;
