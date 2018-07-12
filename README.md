# stream-chopper (WIP!)

Chop a single stream of data into a series of readable streams.

[![npm](https://img.shields.io/npm/v/stream-chopper.svg)](https://www.npmjs.com/package/stream-chopper)
[![build status](https://travis-ci.org/watson/stream-chopper.svg?branch=master)](https://travis-ci.org/watson/stream-chopper)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

## Installation

```
npm install stream-chopper --save
```

## Usage

Example app:

```js
const StreamChopper = require('stream-chopper')

const chopper = new StreamChopper({
  maxSize: 30,                      // chop stream when it reaches 30 bytes
  maxDuration: 10000,               // chop stream if it's been open for 10s
  splittype: StreamChopper.overflow // allow size to exeed size slightly
})

chopper.on('stream', function (stream, next) {
  console.log('>> Got a new stream! <<')
  stream.pipe(process.stdout)
  next() // call next when you're ready to receive a new stream
})

chopper.write('This write contains more than 30 bytes\n')
chopper.write('This write contains less\n')
chopper.write('This is the last write\n')
```

Output:

```
>> Got a new stream! <<
This write contains more than 30 bytes
>> Got a new stream! <<
This write contains less
This is the last write
```

## API

### `chopper = new StreamChopper([options])`

Instantiate a `StreamChopper` instance. `StreamChopper` is a [writable]
stream.

Takes an optional `options` object which, besides the normal options
accepted by the [`Writable`][writable] class, accepts the following
config options:

- `maxSize` - The maximum number of bytes that can be written to the
  `chopper` stream before a new output stream is emitted (default:
  `Infinity`)
- `maxDuration` - The maximum number of milliseconds that an output
  stream can be in use before a new output stream is emitted (default:
  `-1` which means no limit)
- `splittype` - Change the algoritm used to determine how a written
  chunk that cannot fit into the current output stream should be
  handled. The following values are possible:
  - `StreamChopper.split` - Fit as much data from the chunk as possible
    into the current stream and write the remainder to the next stream
    (default)
  - `StreamChopper.overflow` - Allow the entire chunk to be written to
    the current stream. After writing, the stream is ended
  - `StreamChopper.underflow` - End the current output stream and write
    the entire chunk to the next stream

If `splittype` is `StreamChopper.underflow` and the size of the written
chunk is larger than `size` and error is emitted.

### Event: `stream`

Emitted every time a new output stream is ready. You mist listen for
this event.

The listener function is called with two arguments:

- `stream` - A [readable] output stream
- `next` - A function you must call when you're ready to receive a new
  output stream. If called with an error, the `chopper` stream is
  destroyed

## License

[MIT](https://github.com/watson/stream-chopper/blob/master/LICENSE)

[writable]: https://nodejs.org/api/stream.html#stream_class_stream_writable
[readable]: https://nodejs.org/api/stream.html#stream_class_stream_readable
