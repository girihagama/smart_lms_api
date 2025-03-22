const express = require('express');
const multer = require('multer');

const router = express.Router();

// Import middlewares
const { authorizeRole } = require('../middleware/auth');
const upload = require('../middleware/multer');

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

//get all books in the library with pagination
router.post('/list', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { limit, offset } = req.body; // Expect `limit` and `offset` from the request body

    // Default values if not provided
    const rowsLimit = limit || 10; // Default to 10 rows if no limit is provided
    const rowsOffset = offset || 0; // Default to 0 if no offset is provided

    // Query to fetch books with LIMIT and OFFSET
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

//get specific book by id
router.post('/one', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { book_id } = req.body; // Expect `book_id` from the request body

    if (!book_id) {
      return res.status(400).json({ message: 'Book ID is required' }); // Bad Request if no book_id is provided
    }

    // Query to fetch a specific book based on its ID
    const [books] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [
      book_id,
    ]);

    if (books.length === 0) {
      return res.status(404).json({ message: 'Book not found' }); // Not Found if no book matches the given ID
    }

    res.status(200).json({
      message: 'Book retrieved successfully',
      data: books[0], // Return the first (and only) book object
    });
  } catch (error) {
    console.error('Error fetching the book:', error);

    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

//search for books by id, name, or description
router.post('/search', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { searchTerm } = req.body; // Get the search term from the request body

    if (!searchTerm) {
      return res.status(400).json({ message: 'Search term is required' });
    }

    const searchQuery = `%${searchTerm}%`; // Use wildcard for partial matching

    // SQL query to search by ID, name, or description
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

// Add a new book (with image upload)
router.post(
  '/add',
  authorizeRole(['Member', 'Librarian']),
  upload.single('book_image'),
  async (req, res) => {
    try {
      const { book_name, book_description, book_late_fee, book_condition, book_status } = req.body;

      const book_id = Date.now() + Math.round(Math.random() * 1e9);
      const book_image = req.file ? req.file.path : null; // Get uploaded image path

      // Validate required fields
      if (!book_name || !book_description) {
        return res.status(400).json({ message: 'Name and description are required' });
      }

      const defaultLateFee = book_late_fee || 0.0;
      const defaultCondition = book_condition || 'Good';
      const defaultStatus = '1';

      // Insert new book into the database
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

//check if book is available for borrowing
router.post('/check', authorizeRole(['Member', 'Librarian']), async (req, res) => {
  try {
    const { book_id } = req.body; // Get the book_id from the request body

    if (!book_id) {
      return res.status(400).json({ action: false, message: 'Book ID is required' });
    }

    // Query to check if the book is available for borrowing
    const [book] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [book_id]);

    if (book.length === 0) {
      return res.status(404).json({ action: false, message: 'Book not found' });
    } else if (book[0].book_status === '0') {
      return res
        .status(400)
        .json({ action: false, message: 'Book is not available for borrowing' });
    }

    //check if the book is currently borrowed
    const [borrowedBook] = await req.app.locals.db.query(
      'SELECT * FROM transaction WHERE transaction_book_id = ? AND transaction_status = ? OR transaction_status = ?',
      [book_id, 'issued', 'due']
    );

    res.status(200).json({ action: true, message: 'Book is available for borrowing', book , available: borrowedBook.length === 0 });
  } catch (error) {
    console.error('Error checking the book:', error);

    if (!res.headersSent) {
      res.status(500).json({ action: false, message: 'Internal Server Error' });
    }
  }
});

module.exports = router;
