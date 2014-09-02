var path = require('path');
var fs = require('fs');
var urlParse = require('url').parse;
var connect = require('connect');

exports.log = function(){
    console.log.apply(console, arguments)
};

/**
 * open application
 */
exports.open = function(target, appName, callback) {
    exports.log('Open:', target);
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

    var log = (options.logger || exports).log;
    var open = (options.opener || exports).open;
    exports.log = log;

    var middleware = [];
    var consoleServer = null;

    if(options.proxies){
        var proxy  = require('./lib/proxy');
        proxy.logger = options.logger || console;
        proxy.config(options.proxies);
        middleware.push(proxy.proxyRequest);
    }

    if(options.console){
        log("Remote logging service enable");

        var consolePort = options.consolePort = Number(String(options.console)) || 9999;
        var consoleId = options.consoleId = String(Math.round(Math.random()*1000));

        // start a standalone logging server
        connect.router =  require('./lib/router');

        consoleServer = connect.createServer(
            connect.bodyParser(),
            connect.static(path.join(__dirname, './asset/jsconsole')),
            connect.router( require('./lib/remotelogging') )
        ).listen(consolePort);

        consoleServer.sockets = [];

        // record all connections
        consoleServer.on('connection', function (socket) {
            consoleServer.sockets.push(socket);
            socket.on('close', function () {
                consoleServer.sockets.splice(consoleServer.sockets.indexOf(socket), 1);
            });
        });

        log('Success start remote logging server on port: ' + consolePort);

        var url = 'http://127.0.0.1:'+ consolePort + '/?:listen ' + consoleId;
        open(url);
    }

    // live reload server
    if(options.live) {
        middleware.push( connect.static(path.join(__dirname, './asset/livereload')) );
        log("Live reload service enable");
    }

    if(options.live || options.console) {
        middleware.push( injectScript(options, connect) );
    }

    // log config
    if(options.log){
        // `default` ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
        // `short` ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms'
        //` tiny`  ':method :url :status :res[content-length] - :response-time ms'
        // `dev` concise output colored by response status for development use
        middleware.push( connect.logger({ stream: {
            write: function(str){
                log(str.trim());
            }
        }, format: options.log }) );
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
    return connect.apply(null, middleware)
        .listen(port, function(err) {

            if(err){
                done(err);
            }

            var port = this.address().port;

            // if enable live reload service
            if(options.live){
                var Reactor = require('./lib/reactor');
                // create the reactor object
                // reload server
                var reactor = new Reactor( {
                    server: this,
                    apiVersion: '1.7',
                    host: 'localhost',
                    port: port
                } );

                var Watcher = require('gaze');
                var watcher = new Watcher(options.watch);
                watcher.on('ready', function (watcher) {
                    log("Watch on file patterns:", options.watch);
                });
                // A file has been added/changed/deleted has occurred
                watcher.on('all', function (event, filepath) {
                    var changedFiles = [];
                    changedFiles[filepath] = event;
                    reactor.reload(changedFiles);
                });
            }
            log('Success start server on port: ' + port);
            if(options.open) {
                var url = 'http://127.0.0.1:'+port;
                exports.open(url);
            }
            done(null);
        })
        .on('error', function( err ) {
            if ( err.code === 'EADDRINUSE' ) {
                return this.listen(0); // 0 means random port
            }

            // not an EADDRINUSE error, buble up the error
            done(err);
        })
        .on('close', function(){
            if(consoleServer){
                for (var i = 0; i < consoleServer.sockets.length; i++) {
                    consoleServer.sockets[i].destroy();
                }

                consoleServer.close(function(){
                    log('Console server closed')
                })
            }
        });

};

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

            if(options.live){
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
