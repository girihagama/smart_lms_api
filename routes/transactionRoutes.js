const express = require('express');
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

//borrow a book
router.post('/borrow', authorizeRole(['Member']), async (req, res) => {
  try {
    const { user_email, book_id } = req.body; // Get the user_email and book_id from the request body

    if (!user_email || !book_id) {
      return res.status(400).json({ message: 'User ID and Book ID are required' });
    }

    // Check if the user already has the maximum number of books borrowed
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_user_email = ? AND transaction_status = ? OR transaction_status = ?',
      [user_email, 'issued', 'due']
    );

    const [borrowLimit] = await req.app.locals.db.query(
      'SELECT user_max_books FROM user WHERE user_email = ?',
      [user_email]
    );

    if (borrowedBooks.length >= borrowLimit[0].user_max_books) {
      return res
        .status(400)
        .json({ message: 'User has already borrowed the maximum number of books' });
    }

    // Check if the book is available for borrowing
    const [book] = await req.app.locals.db.query(
      // Query to fetch the book by ID
      'SELECT * FROM book WHERE book_id = ?',
      [book_id]
    );

    // Check if the book exists
    if (book.length === 0) {
      return res.status(404).json({ message: 'Book not found' });
    } else if (book[0].book_status === '0') {
      return res.status(400).json({ message: 'Book is inactive' });
    }

    //check if the book is already borrowed
    const [bookAvailablility] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_book_id = ? AND transaction_status = ? OR transaction_status = ?',
      [book_id, 'issued', 'due']
    );

    if (bookAvailablility.length > 0) {
      return res.status(400).json({ message: 'Book is not available to borrow' });
    }

    //generate borrow date
    const borrowDate = new Date();
    //genetrate return date
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + 14); // Set return date to 14 days from now

    // Insert a new transaction record for the borrowed book
    await req.app.locals.db.query(
      'INSERT INTO transaction (transaction_user_email, transaction_book_id, transaction_status, transaction_borrow_date, transaction_return_date, transaction_late_fee) VALUES (?, ?, ?, ?, ?, ?)',
      [user_email, book_id, 'issued',borrowDate, returnDate, parseFloat(book[0].book_late_fee)]
    );

    res.status(200).json({ message: 'Book borrowed successfully' });
  } catch (error) {
    console.error('Error borrowing book:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

router.get('/return', authorizeRole(['Librarian']), (req, res) => {
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

//get list of books that are currently borrowed by a member
router.post('/borrowed', authorizeRole(['Member']), async (req, res) => {
  try {
    const { user_email } = req.body; // Get the user_id from the request body

    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Query to fetch borrowed books by a specific user
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE user_id = ? AND transaction_status = ?',
      [user_id, '1']
    );

    if (borrowedBooks.length === 0) {
      return res.status(404).json({ message: 'No borrowed books found for the user' });
    }

    res.status(200).json({
      message: 'Borrowed books retrieved successfully',
      data: borrowedBooks,
    });
  } catch (error) {
    console.error('Error fetching borrowed books:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

module.exports = router;
