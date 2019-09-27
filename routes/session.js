"use strict";

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jwt-simple');
const joi = require('joi');
const authHelper = require('./authHelper');

const router = express.Router();

//
// Create a security token as the user logs in that can be passed
// to the client and used on subsequent calls
// The user email and password are sent in the body of the request
//

router.post('/', (req, res, next) => {
    const schema = {
        email: joi.string().email().min(7).max(50).required(),
        password: joi.string().regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{7,15}$/).required()
    };

    joi.validate(req.body, schema, (err) => {
        if(err)
            return next(new Error('Invalid field: password 7 to 15 (one number, one specail character)'));
        
        req.db.collection.findOne({ type: 'USER_TYPE', email: req.body.email }, (err, user) => {
            if(err)
                return next(err);
            if(!user)
                return next(new Error('User was not found'));

            bcrypt.compare(req.body.password, user.passwordHash, (err, match) => {
                if(match) {
                    try {
                        const token = jwt.encode({
                            authorized: true, 
                            sessionIP: req.ip, 
                            sessionUA: req.headers['user-agent'], 
                            userId: user._id.toHexString(), 
                            displayName: user.displayName
                        }, process.env.JWT_SECRET);

                        res.status(201).json({
                            displayName: user.displayName,
                            userId: user._id,
                            token: token,
                            msg: 'Authorized'
                        });
                    }
                    catch(err) {
                        return next(err);
                    }
                }
                else {
                    return next(new Error('Wrong password'));
                }
            });
        });
    });
});

// Delete the token when user loggs out
router.delete('/:id', authHelper.checkAuth, (req, res, next) => {
    if(req.params.id != req.auth.userId)
        return next(new Error('Invalid request for logout'));
    
    res.status(201).json({
        msg: 'Logged out'
    });
});

module.exports = router;