'use strict'

/**
 * This example app will send ndjson objects to an HTTP server.
 *
 * The HTTP server expects that the request body is compressed using gzip. Each
 * ndjson object just contains the current time.
 */

const http = require('http')
const zlib = require('zlib')
const pump = require('pump')
const ndjson = require('ndjson')
const StreamChopper = require('stream-chopper')

let requestCount = 0
let streamCount = 0

// Start a dummy server that will receive streaming ndjson HTTP requests
const server = http.createServer(function (req, res) {
  const count = ++requestCount
  console.log('[server req#%d] new request', count)

  // decompress the request body and parse it as ndjson
  pump(req, zlib.createGunzip(), ndjson.parse(), function (err) {
    if (err) {
      console.error(err.stack)
      res.statusCode = 500
    }
    console.log('[server req#%d] request body ended - responding with status code %d', count, res.statusCode)
    res.end()
  }).on('data', function (obj) {
    console.log('[server req#%d] got an ndjson object: %j', count, obj)
  })
})

server.listen(function () {
  const port = server.address().port

  const chopper = new StreamChopper({
    size: 512, // close request when 512 bytes data have been written,
    time: 10000, // or when it't been open for 10 seconds,
    type: StreamChopper.overflow // but don't chop ndjson lines up
  })

  chopper.on('stream', function (stream, next) {
    // prepare a new output stream
    const count = ++streamCount
    console.log('[chopper stream#%d] new stream', count)

    const opts = {method: 'POST', port}

    // open a request to the HTTP server
    const req = http.request(opts, function (res) {
      console.log('[chopper stream#%d] got server response: %d', count, res.statusCode)
      res.resume()
    })

    // compress all data written to the stream with gzip before sending it to
    // the HTTP server
    pump(stream, zlib.createGzip(), req, function (err) {
      if (err) throw err
      console.log('[chopper stream#%d] stream ended', count)
      next()
    })
  })

  const serialize = ndjson.serialize()

  // pipe the serialize stream into the chopper stream
  pump(serialize, chopper, function (err) {
    if (err) throw err
    console.error('unexpected end of chopper')
  })

  // start writing ndjson to the serialize stream
  write()

  function write () {
    // prepare dummy json object
    const obj = {time: new Date()}

    // write it to the serialize stream
    if (serialize.write(obj) === false) {
      // backpressure detected, pause writing until the stream is ready
      serialize.once('drain', next)
      return
    }

    // queue next write
    next()
  }

  function next () {
    // queue next write to happen somewhere between 250 and 500 ms
    setTimeout(write, Math.floor(Math.random() * 250) + 250)
  }
})
