const express = require('express'); //Route handlers and template usage
const path = require('path'); // Populating the path property of the request
const logger = require('morgan'); // HTTP request logging
const bodyParser = require('body-parser'); // Access to the HTTP request body
const cp = require('child_process'); // Forking a separate Node.js process
const responseTime = require('response-time'); // Performance loading
const assert = require('assert'); // Asert testing for values
const helmet = require('helmet'); // Security measures
const RateLimit = require('express-rate-limit'); //IP based rate limit
const csp = require('helmet-csp');
const MongoClient = require('mongodb').MongoClient;
if(process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
} // When on local machine use some configurations stored in .env

const users = require('./routes/users');
const session = require('./routes/session');
const sharedNews = require('./routes/sharedNews');
const homeNews = require('./routes/homeNews');


const app = express();
app.enable('trust proxy'); // When run in AWS, just show the IP address of actual machine instead of AWS load balancer

const limiter = new RateLimit({
    windowsMs: 15 * 60 * 1000,
    max: 100, //Maximum 100 requests in windows ms
    delayMs: 0
});
app.use(limiter);

app.use(helmet()); // Some default safety settings, later configured in csp
app.use(csp({
    //Specify the content source directives
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'ajax.google.com', 'maxcdn.bootstrapcdn.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'ajax.google.com'],
        fontSrc: ["'self'", 'maxcdn.bootstrapcdn.com'],
        imgSrc: ['*']
    }
}));

//measure response time
app.use(responseTime());

//debug logging all http req with special dev styling
app.use(logger('dev'));

//ability to process json bodys
app.use(bodyParser.json({limit: '100kb'}));

//Main html file that is returned in the build directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

//Serving up of static content such as html for react
app.use(express.static(path.join(__dirname, 'build')));

let node2 = cp.fork('./worker/app_FORK.js');

// if error in node2 child process, start it again
node2.on('exit', (code) => {
    node2 = undefined;
    node2 = cp.fork('./worker/app_FORK.js');
});

//Database
let db = {};
MongoClient.connect(process.env.MONGO_CONNECT_URL, {useNewUrlParser: true}, (err, client) => {
    assert.equal(null, err); //if not throw assert error
    db.client = client;
    db.collection = client.db('newswatcherdb').collection('newswatcher');
});

//Insert db and node2 through middle ware to req model -> global access
app.use((req, res, next) => {
    req.db = db;
    req.node2 = node2;
    next();
});

//Rest API routes
app.use('/api/users', users);
app.use('/api/sessions', session);
app.use('/api/sharednews', sharedNews);
app.use('/api/homenews', homeNews);

//Recognizes an unvalid route and returns an error
app.use((req, res, next) => {
    let err = new Error('Not found');
    err.status = 404;
    next(err);
});

//Handles returned error in development environment
if(app.get('env') == 'development') {
    app.use((err, req, res, next) => {
        res.status(err.status || 500).json({message: err.toString(), error: err});
        console.log(err);
    });
}
//Handles returned error in production env with no stacktraces exposed to user
app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.toString(), err: {} });
    console.log(err);
})

app.set('port', process.env.PORT || 3000);

let server = app.listen(app.get('port'), () => {
    console.log(`Express server listening on port: ${server.address().port}`);
    console.log(path.join(__dirname));
});
server.db = db;
server.node2 = node2;
module.exports = server;