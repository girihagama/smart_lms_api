const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

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
    const [book] = await req.app.locals.db.query('SELECT * FROM book WHERE book_id = ?', [book_id]);

    if (book.length === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Format response
    const formattedBooks = book.map((book) => ({
      ...book,
      book_image: !book.book_image
        ? ''
        : req.app.locals.fbrc.api_base_url + book.book_image.replace(/\\/g, '/'),
    }));

    res.status(200).json({
      message: 'Book retrieved successfully',
      data: formattedBooks[0], // Return the first matching book
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
    const { searchTerm, page = 1, limit = 10 } = req.body;
    const offset = (page - 1) * limit;

    let query, countQuery, queryParams;

    const searchQuery = `%${searchTerm}%`; // Wildcard for partial matching

    if (searchTerm) {
      query = `
        SELECT * FROM book 
        WHERE book_id LIKE ? OR book_name LIKE ? OR book_description LIKE ? 
        ORDER BY book_id DESC 
        LIMIT ? OFFSET ?`;

      countQuery = `
        SELECT COUNT(*) AS totalBooks 
        FROM book 
        WHERE book_id LIKE ? OR book_name LIKE ? OR book_description LIKE ?`;

      queryParams = [searchQuery, searchQuery, searchQuery, Number(limit), Number(offset)];
    } else {
      query = `SELECT * FROM book ORDER BY book_id DESC LIMIT ? OFFSET ?`; // Latest books
      countQuery = `SELECT COUNT(*) AS totalBooks FROM book`;
      queryParams = [Number(limit), Number(offset)];
    }

    // Get total book count
    const [[{ totalBooks }]] = searchTerm
      ? await req.app.locals.db.query(countQuery, [searchQuery, searchQuery, searchQuery])
      : await req.app.locals.db.query(countQuery);

    // Fetch books
    const [books] = await req.app.locals.db.query(query, queryParams);

    // Format response
    const formattedBooks = books.map((book) => ({
      ...book,
      book_image: !book.book_image
        ? ''
        : req.app.locals.fbrc.api_base_url + book.book_image.replace(/\\/g, '/'),
    }));

    if (books.length === 0) {
      return res.status(404).json({ message: 'No books found' });
    }

    res.status(200).json({
      message: 'Books retrieved successfully',
      data: formattedBooks,
      pagination: {
        totalBooks,
        currentPage: Number(page),
        totalPages: Math.ceil(totalBooks / limit),
        perPage: Number(limit),
      },
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
router.post('/add', authorizeRole(['Librarian']), async (req, res) => {
  try {
    const {
      isNew,
      book_id = Date.now() + Math.round(Math.random() * 1e9),
      book_name,
      book_description,
      book_late_fee,
      book_condition,
      book_status,
      book_image, // Base64 image (optional)
    } = req.body;

    const isUpdating = !isNew; // Check if it's an update

    let imagePath = null;
    if (book_image && book_image.length > 0) {
      const base64Data = book_image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `${book_id}.jpg`;
      const uploadPath = path.join(__dirname, '../uploads', fileName);

      fs.writeFileSync(uploadPath, buffer); // Save the file
      imagePath = `uploads/${fileName}`; // Store path in DB
    } else {
      const fileName = `${book_id}.jpg`;
      imagePath = `uploads/${fileName}`;
    }

    if (!book_name || !book_description) {
      return res.status(400).json({ message: 'Name and description are required' });
    }

    const defaultLateFee = book_late_fee || 0.0;
    const defaultCondition = book_condition || 'Good';
    const defaultStatus = book_status || '1';

    if (isUpdating) {
      // Update existing book
      await req.app.locals.db.query(
        'UPDATE book SET book_name = ?, book_description = ?, book_late_fee = ?, book_condition = ?, book_status = ?, book_image = ? WHERE book_id = ?',
        [
          book_name,
          book_description,
          defaultLateFee,
          defaultCondition,
          defaultStatus,
          imagePath,
          book_id,
        ]
      );
      return res.status(200).json({ message: 'Book updated successfully' });
    } else {
      // Insert new book
      await req.app.locals.db.query(
        'INSERT INTO book (book_id, book_name, book_description, book_late_fee, book_condition, book_status, book_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          book_id,
          book_name,
          book_description,
          defaultLateFee,
          defaultCondition,
          defaultStatus,
          imagePath,
        ]
      );
      return res.status(201).json({ message: 'Book added successfully' });
    }
  } catch (error) {
    console.error('Error processing book:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

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
