'use strict'

const test = require('tape')
const zlib = require('zlib')
const crypto = require('crypto')
const PassThrough = require('readable-stream').PassThrough
const StreamChopper = require('./')

const types = [
  StreamChopper.split,
  StreamChopper.overflow,
  StreamChopper.underflow
]

test('default values', function (t) {
  const chopper = new StreamChopper()
  t.equal(chopper.size, Infinity)
  t.equal(chopper.time, -1)
  t.equal(chopper.type, StreamChopper.split)
  t.equal(chopper._transform, undefined)
  t.equal(chopper._locked, false)
  t.equal(chopper._draining, false)
  t.equal(chopper._destroyed, false)
  t.end()
})

test('throw on invalid config', function (t) {
  t.throws(function () {
    new StreamChopper({ // eslint-disable-line no-new
      type: StreamChopper.split,
      transform () {}
    })
  })
  t.throws(function () {
    new StreamChopper({ // eslint-disable-line no-new
      transform () {}
    })
  })
  t.end()
})

types.forEach(function (type) {
  test(`write with no remainder and type:${type.toString()}`, function (t) {
    const sizeOfWrite = 'hello world 1'.length
    const chopper = new StreamChopper({
      size: sizeOfWrite * 3, // allow for a length of exactly 3x of a single write
      type
    })
    chopper.on('stream', assertOnStream(t, 3))
    chopper.write('hello world 1')
    chopper.write('hello world 1')
    chopper.write('hello world 1')
    chopper.write('hello world 2')
    chopper.write('hello world 2')
    chopper.write('hello world 2')
    chopper.write('hello world 3')
    chopper.write('hello world 3')
    chopper.write('hello world 3')
    chopper.end()
  })
})

test('transform: very fast writes should not exceed size limit too much', function (t) {
  const writes = [
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex'),
    crypto.randomBytes(5 * 1024).toString('hex')
  ]
  let emits = 0

  const ZLIB_BUFFER_SIZE = 16 * 1024

  // 33k: two times the zlib buffer + a little extra
  const size = 2 * 16 * 1024 + 1024

  // The internals of zlib works in mysterious ways. The overshoot will in many
  // cases be more than the size of the zlib buffer, but so far we haven't seen
  // it be more than twice that. So we use 2x just to be safe.
  const maxOutputSize = size + 2 * ZLIB_BUFFER_SIZE

  const chopper = new StreamChopper({
    size,
    type: StreamChopper.overflow,
    transform () {
      return zlib.createGzip({
        level: zlib.constants ? zlib.constants.Z_NO_COMPRESSION : zlib.Z_NO_COMPRESSION
      })
    }
  })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const chunks = []

    t.ok(stream instanceof zlib.Gzip, 'emitted stream should be of type Gzip')

    stream.on('data', chunks.push.bind(chunks))
    stream.on('end', function () {
      const data = Buffer.concat(chunks)

      if (emit === 1) {
        t.ok(data.length >= size, `output should be within bounds (${data.length} >= ${size})`)
      }
      t.ok(data.length <= maxOutputSize, `output should be within bounds (${data.length} <= ${maxOutputSize})`)

      next()
      if (emit === 2) t.end()
    })
  })

  write()

  function write (index) {
    if (!index) index = 0
    if (index === writes.length) return chopper.end()
    chopper.write(writes[index])
    setImmediate(write.bind(null, ++index))
  }
})

test('transform: shouldn\'t throw even if transform stream is set to null before first data event', function (t) {
  const chopper = new StreamChopper({
    type: StreamChopper.overflow,
    transform () {
      return zlib.createGzip()
    }
  })

  chopper.on('stream', function (stream, next) {
    stream.resume()
  })

  chopper.write('hello')
  chopper.destroy()

  t.end()
})

test('2nd write with remainder and type:split', function (t) {
  const streams = [
    ['hello world', 'h'],
    ['ello world', 'he'],
    ['llo world', 'hel'],
    ['lo world']
  ]

  const chopper = new StreamChopper({
    size: 'hello world'.length + 1,
    type: StreamChopper.split
  })

  chopper.on('stream', function (stream, next) {
    const chunks = streams.shift()
    const last = streams.length === 0
    t.ok(chunks)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected)
      t.equal(chunk.toString(), expected, `should receive '${expected}'`)
    })

    stream.on('end', function () {
      next()
      if (last) t.end()
    })
  })

  chopper.write('hello world')
  chopper.write('hello world')
  chopper.write('hello world')
  chopper.write('hello world')
  chopper.end()
})

test('2nd write with remainder and type:overflow', function (t) {
  const sizeOfWrite = 'hello world 1'.length
  const chopper = new StreamChopper({
    size: Math.round(sizeOfWrite + sizeOfWrite / 2), // allow for a length of 1.5x of a single write
    type: StreamChopper.overflow
  })
  chopper.on('stream', assertOnStream(t, 3))
  chopper.write('hello world 1') // within limit
  chopper.write('hello world 1') // go 0.5 over the limit
  chopper.write('hello world 2') // within limit
  chopper.write('hello world 2') // go 0.5 over the limit
  chopper.write('hello world 3') // within limit
  chopper.write('hello world 3') // go 0.5 over the limit
  chopper.end()
})

test('2nd write with remainder and type:underflow', function (t) {
  const sizeOfWrite = 'hello world 1'.length
  const chopper = new StreamChopper({
    size: Math.round(sizeOfWrite + sizeOfWrite / 2), // allow for a length of 1.5x of a single write
    type: StreamChopper.underflow
  })
  chopper.on('stream', assertOnStream(t, 4))
  chopper.write('hello world 1') // within limit
  chopper.write('hello world 2') // go 0.5 over the limit
  chopper.write('hello world 3') // within limit
  chopper.write('hello world 4') // go 0.5 over the limit
  chopper.end()
})

test('1st write with remainder and type:split', function (t) {
  const streams = [
    ['hello'],
    [' worl'],
    ['d', 'hell'],
    ['o wor'],
    ['ld']
  ]

  const chopper = new StreamChopper({ size: 5, type: StreamChopper.split })

  chopper.on('stream', function (stream, next) {
    const chunks = streams.shift()
    const last = streams.length === 0
    t.ok(chunks)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected)
      t.equal(chunk.toString(), expected)
    })

    stream.on('end', function () {
      next()
      if (last) t.end()
    })
  })

  chopper.write('hello world')
  chopper.write('hello world')
  chopper.end()
})

test('1st write with remainder and type:overflow', function (t) {
  const chopper = new StreamChopper({ size: 5, type: StreamChopper.overflow })
  chopper.on('stream', assertOnStream(t, 2))
  chopper.write('hello world 1')
  chopper.write('hello world 2')
  chopper.end()
})

test('1st write with remainder and type:underflow', function (t) {
  const chopper = new StreamChopper({ size: 4, type: StreamChopper.underflow })

  chopper.on('stream', function (stream, next) {
    stream.resume()
    next()
  })

  chopper.on('error', function (err) {
    t.equal(err.message, 'Cannot write 5 byte chunk - only 4 available')
    t.end()
  })

  chopper.write('hello')
  chopper.end()
})

test('if next() is not called, next stream should not be emitted', function (t) {
  let emitted = false
  const chopper = new StreamChopper({
    size: 4,
    type: StreamChopper.overflow
  })
  chopper.on('stream', function (stream, next) {
    t.equal(emitted, false)
    emitted = true
    stream.resume()
  })
  chopper.write('hello') // indirect chop
  chopper.end('world') // indirect chop
  setTimeout(function () {
    t.end()
  }, 100)
})

test('call next() with error', function (t) {
  t.plan(1)
  const err = new Error('foo')
  const chopper = new StreamChopper()
  chopper.on('stream', function (stream, next) {
    next(err)
  })
  chopper.on('error', function (_err) {
    t.equal(_err, err)
  })
  chopper.on('close', function () {
    t.end()
  })
  chopper.write('hello')
})

test('chopper.destroy() - synchronously during write', function (t) {
  const chopper = new StreamChopper()
  chopper.on('stream', function (stream, next) {
    // this event is emitted synchronously during the chopper.write call below
    chopper.destroy()
  })
  chopper.on('error', function (err) {
    t.error(err)
  })
  chopper.on('close', function () {
    t.end()
  })
  chopper.write('hello')
})

test('chopper.destroy() - active stream', function (t) {
  t.plan(2)

  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.pass('stream should end')
      next()
    })
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function (err) {
    t.error(err, 'error on the chopper')
  })

  chopper.write('hello')
  chopper.destroy()
})

test('chopper.destroy(err) - active stream', function (t) {
  t.plan(3)

  const err = new Error('foo')
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('error', function (err) {
      t.error(err)
    })
    stream.on('end', function () {
      t.pass('stream should end')
      next()
    })
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function (_err) {
    t.equal(_err, err)
  })

  chopper.write('hello')
  chopper.destroy(err)
})

test('chopper.destroy() - no active stream', function (t) {
  t.plan(3)

  const chopper = new StreamChopper({
    size: 4,
    type: StreamChopper.overflow
  })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.pass('stream should end')
      next()
      t.end()
    })
  })

  chopper.on('close', function () {
    t.pass('chopper should close')
  })

  chopper.on('error', function (err) {
    t.error(err, 'error on the chopper')
  })

  chopper.write('hello') // force chop to make sure there's no active stream
  chopper.destroy()
})

test('chopper.destroy(err) - no active stream', function (t) {
  t.plan(4)

  const err = new Error('foo')
  const chopper = new StreamChopper({
    size: 4,
    type: StreamChopper.overflow
  })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.pass('stream should end')
      next()
      t.end()
    })
  })

  chopper.on('close', function () {
    t.pass('chopper should close')
  })

  chopper.on('error', function (_err) {
    t.equal(_err, err)
  })

  chopper.write('hello') // force chop to make sure there's no active stream
  chopper.destroy(err)
})

test('chopper.chop(callback)', function (t) {
  t.plan(8)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(emit, emits, 'should finish streaming current stream before emitting the next')
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.equal(emit, emits, 'should end current stream before emitting the next')
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 2) t.end()
    })
  })

  chopper.write('hello')
  chopper.chop(function () {
    chopper.write('world')
    chopper.end()
  })
})

test('chopper.chop()', function (t) {
  t.plan(8)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(emit, emits, 'should finish streaming current stream before emitting the next')
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.equal(emit, emits, 'should end current stream before emitting the next')
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 2) t.end()
    })
  })

  chopper.write('hello')
  chopper.chop()
  chopper.write('world')
  chopper.end()
})

test('chopper.chop() - twice with no write in between', function (t) {
  t.plan(8)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(emit, emits, 'should finish streaming current stream before emitting the next')
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.equal(emit, emits, 'should end current stream before emitting the next')
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 2) t.end()
    })
  })

  chopper.write('hello')
  chopper.chop()
  chopper.chop()
  chopper.write('world')
  chopper.end()
})

test('chopper.chop() - twice with write in between', function (t) {
  t.plan(8)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(emit, emits, 'should finish streaming current stream before emitting the next')
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.equal(emit, emits, 'should end current stream before emitting the next')
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 2) {
        t.end()
        chopper.destroy()
      }
    })
  })

  chopper.write('hello')
  chopper.chop()
  chopper.write('world')
  chopper.chop()
})

test('chopper.chop() - destroyed stream', function (t) {
  const chopper = new StreamChopper()
  let emits = 0
  chopper.on('stream', function (stream, next) {
    t.equal(++emits, 1, 'should only get one stream')
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('end', next)
  })
  chopper.write('hello')
  chopper.destroy()
  chopper.chop()
  chopper.end('world')
  t.end()
})

test('chopper.chop(callback) - destroyed stream', function (t) {
  const chopper = new StreamChopper()
  let emits = 0
  chopper.on('stream', function (stream, next) {
    t.equal(++emits, 1, 'should only get one stream')
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
    })
    stream.on('end', next)
  })
  chopper.write('hello')
  chopper.destroy()
  chopper.chop(function () {
    chopper.end('world')
    t.end()
  })
})

test('allow output stream to be destroyed without write errors, when destination stream is destroyed', function (t) {
  t.plan(4)

  let emits = 0
  let dest
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const expected = chunks.shift()

    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), expected)
    })

    stream.on('end', function () {
      next()
      if (emit === 2) {
        t.equal(emits, emit)
        t.end()
      }
    })

    if (emit === 1) {
      dest = new PassThrough()
      // `prefinish` seem to be the only event that's emitted early
      // enough, that even if chopper.write() is called synchronously
      // just after dest.destroy(), that a `write after end` error
      // doesn't occur. Not the `error`, `close` or any other event is
      // emitted in time
      dest.on('prefinish', function () {
        t.pass('should emit prefinish')
        stream.destroy()
      })
      dest.on('error', function (err) {
        t.error(err)
      })
      stream.pipe(dest)
    } else if (emit > 2) {
      t.fail('unexpected number of emits: ' + emit)
      next()
    }
  })

  chopper.write('hello')
  dest.destroy()
  chopper.end('world') // write immediately after dest.destroy to see if we can trick it into throwing an error
})

test('should not chop if no size is given', function (t) {
  const bigString = new Array(10000).join('hello ')
  const totalWrites = 1000
  let emitted = false

  t.plan(totalWrites)

  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    if (emitted) t.fail('should not emit stream more than once')
    emitted = true
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), bigString)
    })
    next()
  })

  for (let n = 0; n < totalWrites; n++) {
    chopper.write(bigString)
  }
})

test('should not chop if no time is given', function (t) {
  setTimeout(function () {
    t.end()
  }, 100)

  const origSetTimeout = global.setTimeout
  global.setTimeout = function () {
    t.fail('should not set a timeout')
  }
  t.on('end', function () {
    global.setTimeout = origSetTimeout
  })

  const chopper = new StreamChopper()
  chopper.on('stream', function (stream, next) {
    stream.resume()
    next()
  })
  chopper.write('test')
})

test('should chop when timeout occurs', function (t) {
  const chopper = new StreamChopper({ time: 50 })
  chopper.on('stream', assertOnStream(t, 2))
  chopper.write('hello world 1')
  setTimeout(function () {
    chopper.write('hello world 2')
    chopper.end()
  }, 100)
})

test('handle backpressure when current stream is full, but next() haven\'t been called yet', function (t) {
  t.plan(4)

  const chunks = ['foo', 'bar', 'baz']
  let emits = 0
  let firstNext

  const chopper = new StreamChopper({
    size: 2,
    type: StreamChopper.overflow
  })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const expected = chunks.shift()

    if (emit === 1) firstNext = next

    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), expected)
    })

    stream.on('end', function () {
      if (emit > 1) next()
      if (emit === 3) t.end()
    })
  })

  chopper.write('foo') // indirect chop
  chopper.write('bar') // indirect chop
  chopper.end('baz') // indirect chop

  t.equal(emits, 1, 'should only have emitted the first stream')

  firstNext()
})

test('output stream destroyed by user', function (t) {
  t.plan(2)

  let emits = 0
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits

    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello', 'stream should get data')
      stream.destroy() // force output stream to end unexpectedly
    })
    stream.on('end', function () {
      t.pass(`stream ${emit} ended`)
      next()
      t.end()
    })
  })

  chopper.write('hello')
})

test('output stream destroyed by user followed by chopper.write() when stream emits end', function (t) {
  t.plan(4)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits

    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), chunks.shift())
      if (emit === 1) stream.destroy() // force output stream to end unexpectedly
    })
    stream.on('end', function () {
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 1) chopper.end('world') // start writing before stream have emitted finish
      else t.end()
    })
  })

  chopper.write('hello')
})

test('output stream destroyed by user followed directly by chopper.write()', function (t) {
  t.plan(14)

  let emits = 0
  const streams = [
    ['foo'],
    ['bar', 'b'],
    ['az']
  ]
  const chopper = new StreamChopper({ size: 4 })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const chunks = streams.shift()
    t.ok(chunks)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected)
      t.equal(chunk.toString(), expected, `should get '${expected}'`)
      if (emit === 1) {
        stream.destroy() // force output stream to end unexpectedly
        chopper.write('bar') // start writing while stream is in the process of being destroyed
        chopper.end('baz') // start writing while stream is locked
      }
    })
    stream.on('end', function () {
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 3) t.end()
    })
  })

  chopper.write('foo')
})

test('change size midflight', function (t) {
  t.plan(12)

  let emits = 0
  const streams = [
    ['foo'],
    ['bar'],
    ['foobar']
  ]

  const chopper = new StreamChopper({ size: 3 })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const chunks = streams.shift()
    t.ok(chunks, `stream ${emit} should be expected`)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected, `chunk event should be expected on stream ${emit}`)
      t.equal(chunk.toString(), expected, `should get '${expected}'`)
      if (emit === 2) {
        chopper.size = 6
        chopper.write('foobar')
        chopper.end()
      }
    })
    stream.on('end', function () {
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 3) t.end()
    })
  })

  chopper.write('foobar')
})

test('change type midflight', function (t) {
  t.plan(12)

  let emits = 0
  const streams = [
    ['foo'],
    ['bar'],
    ['foobar']
  ]

  const chopper = new StreamChopper({ size: 3 })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const chunks = streams.shift()
    t.ok(chunks, `stream ${emit} should be expected`)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected, `chunk event should be expected on stream ${emit}`)
      t.equal(chunk.toString(), expected, `should get '${expected}'`)
      if (emit === 2) {
        chopper.type = StreamChopper.overflow
        chopper.write('foobar')
        chopper.end()
      }
    })
    stream.on('end', function () {
      t.pass(`stream ${emit} ended`)
      next()
      if (emit === 3) t.end()
    })
  })

  chopper.write('foobar')
})

test('change time midflight', function (t) {
  t.plan(8)

  let start
  let emits = 0
  const streams = [
    ['foo'],
    ['bar']
  ]

  const chopper = new StreamChopper({ time: 200 })

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    const chunks = streams.shift()
    t.ok(chunks, `stream ${emit} should be expected`)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected, `chunk event should be expected on stream ${emit}`)
      t.equal(chunk.toString(), expected, `should get '${expected}'`)
    })
    stream.on('end', function () {
      const diff = Date.now() - start
      if (emit === 1) {
        t.ok(diff >= 200 && diff <= 400, `should end the stream witin a window of 200-400ms (was: ${diff})`)
        chopper.time = 500
        start = Date.now()
        chopper.write('bar')
        next()
      } else {
        t.ok(diff >= 500 && diff <= 700, `should end the stream witin a window of 500-700ms (was: ${diff})`)
        clearTimeout(timer)
        next()
        chopper.destroy()
        t.end()
      }
    })
  })

  // we need a timer on the event loop so the test doesn't exit too soon
  const timer = setTimeout(function () {
    t.fail('took too long')
  }, 1101)

  start = Date.now()
  chopper.write('foo')
})

test('#chopper.resetTimer()', function (t) {
  t.plan(2)

  let start
  const chopper = new StreamChopper({ time: 200 })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'foo', 'stream should get data')
    })
    stream.on('end', function () {
      const diff = Date.now() - start
      t.ok(diff >= 300 && diff <= 500, `should end the stream witin a window of 300-500ms (was: ${diff})`)
      clearTimeout(timer)
      next()
      chopper.destroy()
      t.end()
    })
  })

  // we need a timer on the event loop so the test doesn't exit too soon
  const timer = setTimeout(function () {
    t.fail('took too long')
  }, 501)

  start = Date.now()
  chopper.write('foo')

  setTimeout(function () {
    chopper.resetTimer()
  }, 100)
})

test('#chopper.resetTimer() - without an active stream', function (t) {
  const chopper = new StreamChopper({ time: 200 })

  chopper.on('stream', function (stream, next) {
    t.fail('should never emit a stream')
  })

  setTimeout(function () {
    chopper.destroy()
    t.end()
  }, 400)

  chopper.resetTimer()

  t.notOk(chopper._timer)
})

test('#chopper.resetTimer(time) - with current time set to 200', function (t) {
  t.plan(2)

  let start
  const chopper = new StreamChopper({ time: 200 })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'foo', 'stream should get data')
    })
    stream.on('end', function () {
      const diff = Date.now() - start
      t.ok(diff >= 500 && diff <= 700, `should end the stream witin a window of 500-700ms (was: ${diff})`)
      clearTimeout(timer)
      next()
      chopper.destroy()
      t.end()
    })
  })

  // we need a timer on the event loop so the test doesn't exit too soon
  const timer = setTimeout(function () {
    t.fail('took too long')
  }, 701)

  start = Date.now()
  chopper.write('foo')

  setTimeout(function () {
    chopper.resetTimer(400)
  }, 100)
})

test('#chopper.resetTimer(time) - with current time set to -1', function (t) {
  t.plan(2)

  let start
  const chopper = new StreamChopper({ time: -1 })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'foo', 'stream should get data')
    })
    stream.on('end', function () {
      const diff = Date.now() - start
      t.ok(diff >= 400 && diff <= 600, `should end the stream witin a window of 400-600ms (was: ${diff})`)
      clearTimeout(timer)
      next()
      chopper.destroy()
      t.end()
    })
  })

  // we need a timer on the event loop so the test doesn't exit too soon
  const timer = setTimeout(function () {
    t.fail('took too long')
  }, 601)

  start = Date.now()
  chopper.write('foo')
  chopper.resetTimer(400)
})

test('#chopper.resetTimer(-1)', function (t) {
  t.plan(2)

  let ended = false
  const chopper = new StreamChopper({ time: 100 })

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'foo', 'stream should get data')
    })
    stream.on('end', function () {
      ended = true
    })
  })

  setTimeout(function () {
    t.equal(ended, false, 'should successfully have disabled the timer before the stream ended')
    chopper.destroy()
    t.end()
  }, 200)

  chopper.write('foo')

  setTimeout(function () {
    chopper.resetTimer(-1)
  }, 50)
})

function assertOnStream (t, expectedEmits) {
  let emits = 0
  return function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello world ' + emit, 'expected data for stream ' + emit)
    })
    stream.on('end', function () {
      next()
      if (emit >= expectedEmits) {
        t.equal(emits, expectedEmits)
        t.end()
      }
    })
  }
}
