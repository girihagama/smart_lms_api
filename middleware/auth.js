// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Middleware to authenticate JWT token
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1];

        jwt.verify(token, req.app.locals.jwt_secret, (err, user) => {
            if (err) {
                return res.sendStatus(403); // Forbidden
            }

            req.user = user;  // Add user information to the request
            next();
        });
    } else {
        res.sendStatus(401); // Unauthorized
    }
};

// Middleware to authorize user role
const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (req.user && roles.includes(req.user.user_role)) {
            next();  // User has the required role, proceed
        } else {
            res.sendStatus(403);  // Forbidden
        }
    };
};

module.exports = {
    authenticateJWT,
    authorizeRole
};
