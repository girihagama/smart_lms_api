const express = require('express');
const router = express.Router();

const { authorizeRole } = require('../middleware/auth'); // Import middlewares

router.get('/',authorizeRole(['Member', 'Librarian']), (req, res) => {
    // Ensure no other response is sent before returning
    try {
        // Some logic
        res.sendStatus(200);  // Properly sending a status response
    } catch (error) {
        // Handling error and sending a response only once
        console.error("Error:", error);
        if (!res.headersSent) {  // Ensure headers are not already sent
            res.status(500).send("Internal Server Error");
        }
    }
});

//endpoint to register a new member through the librarian dashboard
router.post('/register/member',authorizeRole(['Librarian']), async (req, res) => {
});



module.exports = router;
