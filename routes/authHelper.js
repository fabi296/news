//
// Module to inject middleware that validates the
// request header User token
//

"use strict";
const jwt = require('jwt-simple');

// Check for token in the header, verify that it is signed and not tampered, exeptions through jwt-simple
module.exports.checkAuth = function(req, res, next) {
    if(req.headers['x-auth']) {
        try {
            req.auth = jwt.decode(req.headers['x-auth'], process.env.JWT_SECRET);
            if(req.auth && req.auth.authorized && req.auth.userId) {
                return next();
            }
            else {
                return next(new Error('User is not logged in'));
            }
        }
        catch(err) {
            return next(err);
        }
    }
    else {
        return next(new Error('User is not logged in'));
    }
}