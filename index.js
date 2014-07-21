var path = require('path');
var fs = require('fs');
var urlParse = require('url').parse;
var connect = require('connect');
var app = connect();

exports.log = console.log;

/**
 * open application
 */
exports.open = function(target, appName, callback) {
    var opener;

    if (typeof(appName) === 'function') {
        callback = appName;
        appName = null;
    }

    function escape(s) {
        return s.replace(/"/, '\\\"');
    }

    // http://nodejs.org/api/process.html#process_process_platform
    // What platform you're running on: 'darwin', 'freebsd', 'linux', 'sunos' or 'win32'
    switch (process.platform) {
        case 'darwin':
            if (appName) {
                opener = 'open -a "' + escape(appName) + '"';
            } else {
                opener = 'open';
            }
            break;
        case 'win32':
            // if the first parameter to start is quoted, it uses that as the title
            // so we pass a blank title so we can quote the file we are opening
            if (appName) {
                opener = 'start "" "' + escape(appName) + '"';
            } else {
                opener = 'start ""';
            }
            break;
        default:
            if (appName) {
                opener = escape(appName);
            } else {
                opener ='xdg-open';
            }
            break;
    }

    return require('child_process').exec(opener + ' "' + escape(target) + '"', callback);
};

exports.run = function (options, done) {

    var target = path.resolve(options.target);
    var port = options.port;


    var middleware = [];

    if(options.proxies){
        var proxy  = require('./lib/proxy');
        proxy.logger = console;
        proxy.config(options.proxies);
        middleware.push(proxy.proxyRequest);
    }

    if(options.console){
        exports.log("remote logging service enable");

        var consolePort = options.consolePort = Number(String(options.console)) || 9999;
        var consoleId = options.consoleId = String(Math.round(Math.random()*1000));

        // start a standalone logging server
        connect.router =  require('./lib/router');
        var consoleServer = connect.createServer(
            connect.bodyParser(),
            connect.static(path.join(__dirname, './asset/jsconsole')),
            connect.router( require('./lib/remotelogging') )
        );

        consoleServer.listen(consolePort);
        exports.log('success start remote logging server on port: ' + consolePort);

        var url = 'http://127.0.0.1:'+ consolePort + '/?:listen ' + consoleId;
        exports.log('open browser:', url);
        exports.open(url);
    }

    // auto reload server
    if(options.reload) {
        middleware.push( connect.static(path.join(__dirname, './asset/livereload')) );
        exports.log("reload service enable");
    }

    if(options.reload || options.console) {
        middleware.push( injectScript(options, connect) );
    }

    // log config
    if(options.log){
        // `default` ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
        // `short` ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms'
        //` tiny`  ':method :url :status :res[content-length] - :response-time ms'
        // `dev` concise output colored by response status for development use
        middleware.push( connect.logger(options.log) );
    }

    // delay response config
    if(options.delay){
        middleware.push( delay(options, connect));
        exports.log("delay service enable");
    }

    // common middleware
    middleware = middleware.concat([
        // http://www.senchalabs.org/connect/middleware-errorHandler.html
        connect.errorHandler(),
        connect.favicon(),
        connect.static( target ),
        connect.directory( target )
    ]);

    // run server
    app.use(middleware)
        .on('error', function( err ) {
            if ( err.code === 'EADDRINUSE' ) {
                return this.listen(0); // 0 means random port
            }

            // not an EADDRINUSE error, buble up the error
            done(err);
        })
        .listen(port, function(err) {

            if(err){
                done(err);
            }

            var port = this.address().port;

            // if enable reload service
            if(options.reload){
                var Reactor = require('./lib/reactor');
                // create the reactor object
                // reload server
                var reactor = new Reactor( {
                    server: this,
                    apiVersion: '1.7',
                    host: 'localhost',
                    port: port
                } );

                var defaultPatterns = "./**/*.*";
                var Watcher = require('gaze');
                var watcher = new Watcher(options.watch || defaultPatterns);
                watcher.on('ready', function (watcher) {
                    exports.log("reload watch task start");
                });
                // A file has been added/changed/deleted has occurred
                watcher.on('all', function (event, filepath) {
                    reactor.reload(filepath);
                });
            }

            exports.log('success start server on port: ' + port);
            if(options.open) {
                var url = 'http://127.0.0.1:'+port;
                exports.log('open browser:', url);
                exports.open(url);
            }
            done(null);
        });

};

// connect delay middleware
// Fiddler2 provides an option under Rules -> Performance Menu -> Simulate Modem speeds.
// By default the Internet Connection Speed available on selecting this option will be equivalent to 6.6 Kb/s.
function delay(options, connect){

    //From http://publik.tuwien.ac.at/files/pub-et_12521.pdf
    //
    //    Table 1. Measured ping times (32 bytes)
    //Technology Bandwidth (down/up) Mean   Std
    //  GPRS      80/40 kbit/s     488 ms   146 ms
    //  EDGE     240/120 kbit/s     504 ms   89 ms
    //  UMTS     384/128 kbit/s     142 ms   58 ms
    //  HSDPA   1800/384 kbit/s     91 ms    43 ms
    //  ADSL     1000/256 kbit/s    10.9 ms   0.8 ms
    return function delay(req, res, next) {

        if ('GET' != req.method && 'HEAD' != req.method){
            return next();
        }

        var timeout = 0;
        if (typeof options.delay === 'function'){
            timeout = options.delay();
        }else{
            timeout = Number(options.delay);
        }

        var pause = connect.utils.pause(req);
        setTimeout(function() {
            next();
            pause.resume();
        }, timeout);

    };
}

// connect inject middleware for liveload and jsconsole
function injectScript(options, connect) {

    return function (req, res, next){

        // build filepath from req.url and deal with index files for trailing `/`
        var filepath = req.url.slice(-1) === '/' ? req.url + 'index.html' : req.url;
        // strip querystring
        filepath =  urlParse(filepath).pathname;
        // if ext is anything but .html, let it go through usual connect static middleware.
        if ( path.extname(filepath) !== '.html' ) {
            return next();
        }

        // setup some basic headers, at this point it's always text/html anyway
        res.setHeader('Content-Type', connect.static.mime.lookup(filepath));

        // can't use the ideal stream / pipe case, we need to alter the html response
        // by injecting that little livereload snippet
        filepath = path.join(options.target, filepath.replace(/^\//, ''));
        fs.readFile(filepath, 'utf8', function(e, body) {
            if(e) {
                // go next and silently fail
                return next();
            }

            if(options.console)

                body = ["<!-- jsconsole snippet -->",
                    "<script>document.write('<script src=\"http://'",
                    " + (location.host || 'localhost').split(':')[0]",
                        " + ':" + options.consolePort  + "/remote.js?"+ options.consoleId  +"\"><\\/script>')",
                    "</script>"
                ].join('\n') + body;

            if(options.reload){
                var port = res.socket.server.address().port;
                body += ["<!-- livereload snippet -->",
                    "<script>document.write('<script src=\"http://'",
                    " + (location.host || 'localhost').split(':')[0]",
                        " + ':" + port + "/livereload.js?snipver=1\"><\\/script>')",
                    "</script>"
                ].join('\n');
            }

            res.end(body);
        });

    }
}
