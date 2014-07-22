# hp
> HTTP Proxy Kit.

## Features
* Web debugging proxy
* Live browser reloads, instantly see changes in your browser
* Remote logging for mobile development

## Install
```shell
$ npm install hp -g
```

## Usage
```shelll
Usage: hp [options]

Options:
  --config, -c  proxy config file                               [default: "Proxyfile.js"]
  --target, -t  target directory                                [default: "."]
  --port, -p    server port                                     [default: 3000]
  --log, -l     log requests                                    [default: "default"]
  --delay, -d   bandwidth delay
  --reload, -r  enable live reload changed files                [default: false]
  --watch, -w   files be watched and reloaded                   [default: "**/*.*"]
  --console     enable remote logging service                   [default: false]
  --proxies     enable request proxy
  --open, -o    open the default browser after server starting  [default: false]
```

## Options

```js
// Proxyfile.js
module.exports = {
    // `default` ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    // `short` ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms'
    //` tiny`  ':method :url :status :res[content-length] - :response-time ms'
    // `dev` concise output colored by response status for development use
    log: 'default'
    proxies: [
        {
            location: "/cgi-bin/",
            host: "127.0.0.1"
        },
        {
            location: "/cgi-bin2/",
            host: "127.0.0.1",
            rewrite: {
                '/cgi-bin2/test': '/rest/test1',
                '/cgi-bin2/test2': '/rest/test2'
            }
        },
        {
            location: "/js/",
            // root specifies the document root for the requests
            // For example, the request "/js/test.js" will return the file "./dist/js/test.js".
            root: "./dist"
        },
        {
            location: "/images/",
            // alias specifies a path to be used as the basis for serving requests for the indicated location
            // For example, the request "/images/test.png" will return the file "./img/test.png".
            alias: "./img"
        },
        {
            location: "/index2.html",
            file: "./index.html"
        }
    ]
}
```
