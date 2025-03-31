const express = require('express');
const multer = require('multer');

const router = express.Router();

// Import middlewares
const { authorizeRole } = require('../middleware/auth');
const upload = require('../middleware/multer');

/**
 * @route GET /
 * @description Health check route for the books API
 * @access Member, Librarian
 */
router.get('/', authorizeRole(['Member', 'Librarian']), (req, res) => {
  try {
    res.sendStatus(200); // Send 200 OK status if the service is running
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

/**
 * @route POST /list
 * @description Get all books in the library with pagination
 * @access Member, Librarian
 */
router.post('/list', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { limit, offset } = req.body;

    // Set default values if limit or offset is not provided
    const rowsLimit = limit || 10;
    const rowsOffset = offset || 0;

    // Query database to retrieve books with pagination
    const [books] = await req.app.locals.db.query('SELECT * FROM book LIMIT ? OFFSET ?', [
      rowsLimit,
      rowsOffset,
    ]);

    res.status(200).json({
      action: true,
      message: 'Books retrieved successfully',
      data: books,
    });
  } catch (error) {
    console.error('Error fetching books:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

/**
 * @route POST /one
 * @description Get a specific book by its ID
 * @access Member, Librarian
 */
router.post('/one', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { book_id } = req.body;

    if (!book_id) {
      return res.status(400).json({ message: 'Book ID is required' });
    }

    // Fetch book details by ID
    const [books] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [
      book_id,
    ]);

    if (books.length === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.status(200).json({
      message: 'Book retrieved successfully',
      data: books[0], // Return the first matching book
    });
  } catch (error) {
    console.error('Error fetching the book:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

/**
 * @route POST /search
 * @description Search for books by ID, name, or description
 * @access Member, Librarian
 */
router.post('/search', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { searchTerm } = req.body;

    if (!searchTerm) {
      return res.status(400).json({ message: 'Search term is required' });
    }

    const searchQuery = `%${searchTerm}%`; // Wildcard for partial matching

    // Query to search books using LIKE for partial matching
    const [books] = await req.app.locals.db.query(
      'SELECT * FROM book WHERE book_id LIKE ? OR book_name LIKE ? OR book_description LIKE ?',
      [searchQuery, searchQuery, searchQuery]
    );

    if (books.length === 0) {
      return res.status(404).json({ message: 'No books found matching the search term' });
    }

    res.status(200).json({
      message: 'Books retrieved successfully',
      data: books,
    });
  } catch (error) {
    console.error('Error searching for books:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

/**
 * @route POST /add
 * @description Add a new book (with image upload)
 * @access Member, Librarian
 */
router.post(
  '/add',
  authorizeRole(['Member', 'Librarian']),
  upload.single('book_image'), // Middleware to handle file uploads
  async (req, res) => {
    try {
      const { book_name, book_description, book_late_fee, book_condition, book_status } = req.body;

      // Generate a unique book ID
      const book_id = Date.now() + Math.round(Math.random() * 1e9);
      const book_image = req.file ? req.file.path : null; // Get the uploaded image path

      // Validate required fields
      if (!book_name || !book_description) {
        return res.status(400).json({ message: 'Name and description are required' });
      }

      // Set default values for optional fields
      const defaultLateFee = book_late_fee || 0.0;
      const defaultCondition = book_condition || 'Good';
      const defaultStatus = '1';

      // Insert new book record into the database
      await req.app.locals.db.query(
        'INSERT INTO book (book_id, book_name, book_description, book_late_fee, book_condition, book_status, book_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          book_id,
          book_name,
          book_description,
          defaultLateFee,
          defaultCondition,
          defaultStatus,
          book_image,
        ]
      );

      res.status(201).json({ message: 'Book added successfully' });
    } catch (error) {
      console.error('Error adding the book:', error);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Internal Server Error' });
      }
    }
  }
);

/**
 * @route POST /check
 * @description Check if a book is available for borrowing
 * @access Member, Librarian
 */
router.post('/check', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { book_id } = req.body;

    if (!book_id) {
      return res.status(400).json({ action: false, message: 'Book ID is required' });
    }

    // Query the database to check if the book exists
    const [book] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [book_id]);

    if (book.length === 0) {
      return res.status(404).json({ action: false, message: 'Book not found' });
    } else if (book[0].book_status === '0') {
      return res
        .status(400)
        .json({ action: false, message: 'Book is not available for borrowing' });
    }

    // Check if the book is currently borrowed
    const [borrowedBook] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_book_id = ? AND (transaction_status = ? OR transaction_status = ?)',
      [book_id, 'issued', 'due']
    );

    res.status(200).json({
      action: true,
      message: 'Book is available for borrowing',
      book,
      available: borrowedBook.length === 0, // True if the book is not currently borrowed
    });
  } catch (error) {
    console.error('Error checking the book:', error);
    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

module.exports = router;
