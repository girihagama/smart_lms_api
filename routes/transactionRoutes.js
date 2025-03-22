const express = require('express');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');

const router = express.Router();
dayjs.extend(relativeTime);

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
      [user_email, book_id, 'issued', borrowDate, returnDate, parseFloat(book[0].book_late_fee)]
    );

    res.status(200).json({ message: 'Book borrowed successfully' });

    //update book readers count
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

//get list of all books borrwed by the member
router.post('/history', authorizeRole(['Member']), async (req, res) => {
  try {
    const user_id = req.user.user_email;
    //add page and limit
    const { page = 1, limit = 10 } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Query to fetch borrowed books by a specific user join the book table
    const [totalBooks] = await req.app.locals.db.query(
      'SELECT count(*) AS total FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND transaction_status = ? ORDER BY transaction_borrow_date DESC',
      [user_id, 'returned']
    );
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND transaction_status = ? ORDER BY transaction_borrow_date DESC LIMIT ? OFFSET ?',
      [user_id, 'returned', limit, (page - 1) * limit]
    );

    if (borrowedBooks.length === 0) {
      return res.status(404).json({
        message: ['No borrowed books found for the user'],
        data: [],
        pagination: {
          total: totalBooks[0].total,
          limit: limit,
          page: page,
          pages: Math.ceil(borrowedBooks.length / limit),
        },
      });
    }

    res.status(200).json({
      message: 'Borrowed books retrieved successfully',
      data: borrowedBooks,
      pagination: {
        total: totalBooks[0].total,
        limit: limit,
        page: page,
        pages: Math.ceil(borrowedBooks.length / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching borrowed books:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

//get list of books that are currently borrowed by a member
router.post('/borrowed', authorizeRole(['Member']), async (req, res) => {
  try {
    const user_id = req.user.user_email; // Get the user_id from the request body

    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Query to fetch borrowed books by a specific user join the book table
    const [borrowedBooks] = await req.app.locals.db.query(
      'SELECT * FROM transaction JOIN book ON transaction.transaction_book_id = book.book_id WHERE transaction_user_email = ? AND transaction_status = ? OR transaction_status = ?',
      [user_id, 'issued', 'due']
    );

    if (borrowedBooks.length === 0) {
      return res.status(404).json({ message: ['No borrowed books found for the user'], data: [] });
    }

    // Map and assign the result
    const updatedBooks = borrowedBooks.map((txn) => ({
      ...txn,
      transaction_return: 'return '+dayjs(txn.transaction_return_date).fromNow(),
    }));

    res.status(200).json({
      message: 'Borrowed books retrieved successfully',
      data: updatedBooks,
    });
  } catch (error) {
    console.error('Error fetching borrowed books:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

//add transaction rating
router.post('/rate', authorizeRole(['Member']), async (req, res) => {
  try {
    const { transaction_id, rating } = req.body;
    const user_id = req.user.user_email;

    if (!transaction_id || !rating) {
      return res.status(400).json({ message: 'Transaction ID and Rating are required' });
    }

    // Check if the transaction exists
    const [transaction] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_id = ?',
      [transaction_id]
    );

    if (transaction.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check if the transaction is already rated
    if (transaction[0].transaction_rating !== null) {
      return res.status(400).json({ message: 'Transaction is already rated' });
    }

    //rating cannot be added after 1month from return date
    const returnDate = new Date(transaction[0].transaction_return_date);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate - returnDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return res
        .status(400)
        .json({ message: 'Rating cannot be added after 30 days from return date' });
    }

    // Update the transaction with the rating
    await req.app.locals.db.query(
      'UPDATE transaction SET transaction_rating = ? WHERE transaction_id = ? AND transaction_user_email = ?',
      [rating, transaction_id, user_id]
    );

    res.status(200).json({ message: 'Transaction rated successfully' });
  } catch (error) {
    console.error('Error rating transaction:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

module.exports = router;
