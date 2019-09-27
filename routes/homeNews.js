"use strict";

const express = require('express');

const router = express.Router();

router.get('/', (req, res, next) => {
    req.db.collection.findOne({_id: process.env.GLOBAL_STORIES_ID}, {homeNewsStories: 1}, (err, doc) => {
        if(err)
            return next(err);
        res.status(200).json(doc.homeNewsStories);
    });
})

module.exports = router;