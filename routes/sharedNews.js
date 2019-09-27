"use strict";

const express = require('express');
const joi = require('joi');
const authHelper = require('./authHelper');

const router = express.Router();

router.post('/', authHelper.checkAuth, (req, res, next) => {
    const schema = {
        contentSnippet: joi.string().max(200).required(),
        date: joi.date().required(),
        hours: joi.string().max(20),
        imageUrl: joi.string().max(300).required(),
        keep: joi.boolean().required(),
        link: joi.string().max(300).required(),
        source: joi.string().max(50).required(),
        storyID: joi.string().max(100).required(),
        title: joi.string().max(200).required()
    };

    joi.validate(req.body, schema, (err) => {
        if(err)
            return next(err);
        
        //check if story limit is reached
        req.db.collection.count({ type: 'SHAREDSTORY_TYPE' }, (err, count) => {
            if(err)
                return next(err);
            if(count > process.env.MAX_SHARED_STORIES)
                return next(new Error('Shared story limit reached'));
            
            //check if story is already shared
            req.db.collection.count({type: 'SHAREDSTORY_TYPE', _id: req.body.storyID }, (err, count) => {
                if(err)
                    return next(err)
                if(count > 0) 
                    return next(new Error('Story already shared'));

                const xferStory = {
                    _id: req.body.storyID,
                    type: 'SHAREDSTORY_TYPE',
                    story: req.body,
                    comments: [{
                        displayName: req.auth.displayName,
                        userId: req.auth.userId,
                        dateTime: Date.now(),
                        comment: req.auth.displayName + " thought everyone might enjoy this!"
                    }]
                };

                req.db.collection.insertOne(xferStory, (err, result) => {
                    if(err)
                        return next(err);
                    res.status(201).json(result.ops[0]);
                });
            });
        });
    });
});

router.get('/', authHelper.checkAuth, (req, res, next) => {
    req.db.collection.find({ type: 'SHAREDSTORY_TYPE' }).toArray((err, docs) => {
        if(err)
            return next(err);
        
        res.status(200).json(docs);
    });
});

router.delete('/:sid', authHelper.checkAuth, (req, res, next) => {
    req.db.collection.findOneAndDelete({ type: 'SHAREDSTORY_TYPE', _id: req.params.sid }, (err, result) => {
        if(err) {
            console.log(`Possible contention error ${err}`);
            return next(err);
        }
        else if(result.ok != 1) {
            console.log(`Possible contention error ${result}`);
            return next(new Error('Shared story deletion failure'));
        }

        res.status(200).json({ msg: 'Shared story deleted' });
    });
});

router.post('/:sid/Comments', authHelper.checkAuth, (req, res, next) => {
    const schema = {
        comment: joi.string().max(250).required()
    };

    joi.validate(req.body, schema, (err) => {
        if(err)
            return next(err);

        const xferComment = {
            displayName: req.auth.displayName,
            userId: req.auth.userId,
            dateTime: Date.now(),
            comment: req.body.comment.substring(0, 250)
        };

        req.db.collection.findOneAndUpdate({ type: 'SHAREDSTORY_TYPE', _id: req.params.sid }, 
            { $push: {comments: xferComment} }, (err, result) => {
                if(result && result.value == null)
                    return next(new Error('Comment limit reached'));
                else if(err) {
                    console.log(`Possible contention error ${err}`);
                    return next(err);
                }
                else if(result.ok != 1) {
                    console.log(`Possible contention error ${result}`);
                    return next(new Error('Comment save failure'));
                }

                res.status(200).json({ msg: 'Comment added' });
            });
    });
});

module.exports = router;