const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
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

module.exports = router;
