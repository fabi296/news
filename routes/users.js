"use strict";
const express = require('express');
const bcrypt = require('bcryptjs');
const async = require('async');
const joi = require('joi');
const ObjectId = require('mongodb').ObjectID;
const authHelper = require('./authHelper');

const router = express.Router();

router.post('/', (req, res, next) => {
    //Password must be 7 to 15 characters in length and contain at least 
    // one numeric digit and a specail character
    const schema = {
        displayName: joi.string().alphanum().min(3).max(50).required(),
        email: joi.string().email().min(7).max(50).required(),
        password: joi.string().regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{7,15}$/).required(),
    };

    joi.validate(req.body, schema, (err, value) => {
        if(err)
            return next(new Error('Invalid field: display name 3 to 50 alphanumeric, valid email, password 7-50 (one number one special character)'));
        
        req.db.collection.findOne({type: 'USER_TYPE', email: req.body.email}, (err, doc) => {
            if(err)
                return next(err);
            if(doc)
                return next(new Error('Email account already registered'));
            
            let xferUser = {
                type: 'USER_TYPE',
                displayName: req.body.displayName,
                email: req.body.email,
                passwordHash: null,
                date: Date.now(),
                completed: false,
                settings: {
                    requireWIFI: true,
                    enableAlerts: false
                },
                newsFilters: [{
                    name: 'Technology Companies',
                    keyWords: ['Apple', 'Microsoft', 'IBM', 'Amazon', 'Google', 'Intel'],
                    enableAlerts: false,
                    alertFrequency: 0,
                    enableAutoDelete: false,
                    deleteTime: 0,
                    timeOfLastScan: 0,
                    newsStories: []
                }],
                savedStories: []
            };

            bcrypt.hash(req.body.password, 10, (err, hash) => {
                if(err)
                    return next(err);

                xferUser.passwordHash = hash;
                req.db.collection.insertOne(xferUser, (err, result) => {
                    if(err)
                        return next(err);
                    req.node2.send({ message: 'REFRESH_STORIES', doc: result.ops[0] });
                    res.status(201).json(result.ops[0]);
                });
            });
        });
    });
});

router.delete('/:id', authHelper.checkAuth, (req, res, next) => {
    //Check if the passed id is the same as in the token
    if(req.params.id != req.auth.userId) 
        return next(new Error('Invalid request for account deletion'));
    
    req.db.collection.findOneAndDelete({ type: 'USER_TYPE', _id: ObjectId(req.auth.userId) }, (err, result) => {
        if(err) {
            console.log(`Possible user detection error: ${err}`);
            return next(err);
        }
        else if(result.ok != 1) {
            console.log(`Possible user deletion error: ${result}`);
            return next(new Error('Account deletion failed'));
        }

        res.status(201).json({ msg: "User Deleted" });
    });
});

router.get('/:id', authHelper.checkAuth, (req, res, next) => {
    //Verify that the id is logged in
    if(req.params.id != req.auth.userId) 
        return next(new Error('Invalid request for account fetch'));
    
    req.db.collection.findOne({ type: 'USER_TYPE', _id: ObjectId(req.auth.userId) }, (err, doc) => {
        if(err)
            return next(err);
        
        const xferProfile = {
            email: doc.email,
            displayName: doc.displayname,
            date: doc.date,
            settings: doc.settings,
            newsFilters: doc.newsFilters,
            savedStories: doc.savedStories
        };

        res.header("Cache-Control", "no-cache, no-store, must-revalidate");
        res.header("Pragma", "no-cache");
        res.header("Expires", 0);
        res.status(201).json(xferProfile);
    });
});

router.put('/:id', authHelper.checkAuth, (req, res, next) => {
    //Verify that the user is logged in
    if(req.params.id != req.auth.userId)
        return next(new Error('Invalid request for account deletion'));
    
    //Limit the number of newsFilters
    if(req.body.newsFilters.length > process.env.MAX_FILTERS)
        return next(new Error('Too many news newsFilters'));
    
    for(let i = 0; i < req.body.newsFilters.length; i++) {
        if('keyWords' in req.body.newsFilters[i] && req.body.newsFilters[i].keyWords[0] != "") {
            for(let j; j < req.body.newsFilers[i].length; j++) {
                req.body.newsFilters[i][j] = req.body.newsFilters[i][j].trim();
            }
        }
    }

    //Validate the news filters
    const schema = {
        name: joi.string().min(1).max(30).regex(/^[-_ a-zA-Z0-9]+$/).required(),
        keyWords: joi.array().max(10).items(joi.string().max(20)).required(),
        enableAlerts: joi.boolean(),
        alertFrequency: joi.number().min(0),
        enableAutoDelete: joi.boolean(),
        deleteTime: joi.date(),
        timeOfLastScan: joi.date(),
        newsStories: joi.array(),
        keywordsStr: joi.string().min(1).max(100)
    };

    async.eachSeries(req.body.newsFilters, (filter, innercallback) => {
        joi.validate(req.body, schema, (err) => {
            innercallback(err);
        });
    }, (err) => {
        if(err) 
            return next(err);
        else {
            //Update document
            req.db.collection.findOneAndUpdate({type: 'USER_TYPE', _id: ObjectId(req.auth.userId) }, { $set: {
                settings: {
                    requireWIFI: req.body.requireWIFI,
                    enableAlerts: req.body.enableAlerts
                },
                newsFilters: req.body.newsFilters
            }}, {returnOriginal: false}, (err, result) => {
                if(err) {
                    console.log(`Possible user put connection error ${err}`);
                    return next(err);
                }
                else if(result.ok != 1) {
                    console.log(`Possible contention error ${result}`);
                    return next(new Error('User put failure'));
                }
                req.node2.send({ msg: "REFRESH_STORIES", doc: result.value });
                res.status(200).json(result.value);
            });
        }
    });
});

router.post('/:id/savedstories', authHelper.checkAuth, (req, res, next) => {
    if(req.params.id != req.auth.userId)
        return next(new Error('Invalid request for saving story'));
    
    const schema = {
        contentSnippet: joi.string().max(200).required(),
        date: joi.date().required(),
        hours: joi.string().max(20),
        imageUrl: joi.string().max(300).required(),
        keep: joi.boolean().required(),
        link: joi.string().max(300).required(),
        source: joi.string().max(50).required(),
        stroyID: joi.string().max(100).required(),
        title: joi.string().max(200).required()
    };

    joi.validate(req.body, schema, (err) => {
        if(err)
            return next(err);
        
        req.db.collection.findOneAndUpdate({ type: 'USER_TYPE', _id: ObjectId(req.auth.userId) }, { $addToSet: {savedStories:  req.body}}, {returnOriginal: true}, (err, result) => {
            if(result && result.value == null) 
                return next(new Error('Over the save limit or already saved'));
            else if(err) {
                console.log(`Possible contetion error ${err}`);
                return next(err);
            }
            else if(result.ok != 1) {
                console.log(`Possible contention error ${result}`);
                return next(new Error('Story save failure'));
            }

            res.status(200).json(result.value);
        });
    });
});

router.delete('/:id/savedstories/:sid', authHelper.checkAuth, (req, res, next) => {
    if(req.params.id != req.auth.userId)
        return next(new Error('Invalid request for deletion of saved story'));
    req.db.collection.findOneAndUpdate({type: 'USER_TYPE', _id: ObjectId(req.auth.userId)}, 
        {$pull: {savedStories: {storyID: req.params.sid}}}, {returnOriginal: true}, (err, result) => {
            if(err) {
                console.log(`possible contention error ${err}`);
                return next(err);
            }
            else if(result.ok != 1) {
                console.log(`Possible contention error ${err}`);
                return next(new Error('Story delete failure'));
            }
            res.status(200).json(result.value);
        });
});

module.exports = router;