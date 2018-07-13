'use strict'

const test = require('tape')
const PassThrough = require('readable-stream').PassThrough
const StreamChopper = require('./')

const types = [
  StreamChopper.split,
  StreamChopper.overflow,
  StreamChopper.underflow
]

test('default values', function (t) {
  const chopper = new StreamChopper()
  t.equal(chopper._size, Infinity)
  t.equal(chopper._time, -1)
  t.equal(chopper._type, StreamChopper.split)
  t.equal(chopper._locked, false)
  t.equal(chopper._draining, false)
  t.equal(chopper._destroyed, false)
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

  const chopper = new StreamChopper({size: 5, type: StreamChopper.split})

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
  const chopper = new StreamChopper({size: 5, type: StreamChopper.overflow})
  chopper.on('stream', assertOnStream(t, 2))
  chopper.write('hello world 1')
  chopper.write('hello world 2')
  chopper.end()
})

test('1st write with remainder and type:underflow', function (t) {
  const chopper = new StreamChopper({size: 4, type: StreamChopper.underflow})

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

test('copper.destroy() - synchronously during write', function (t) {
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
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.ok(true)
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
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function (err) {
      t.error(err)
    })
    stream.on('end', function () {
      t.ok(true)
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
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.ok(true)
      next()
      t.end()
    })
  })

  chopper.on('close', function () {
    t.ok(true)
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
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function (err) {
      t.error(err, 'error on the stream')
    })
    stream.on('end', function () {
      t.ok(true)
      next()
      t.end()
    })
  })

  chopper.on('close', function () {
    t.ok(true)
  })

  chopper.on('error', function (_err) {
    t.equal(_err, err)
  })

  chopper.write('hello') // force chop to make sure there's no active stream
  chopper.destroy(err)
})

test('allow output stream to be destroyed without write errors, when destination stream is destoryed', function (t) {
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
        t.ok(true, 'should emit prefinish')
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
  const chopper = new StreamChopper({time: 50})
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
      t.equal(chunk.toString(), 'hello')
      stream.destroy() // force output stream to end unexpectedly
    })
    stream.on('end', function () {
      t.ok(true, `stream ${emit} ended`)
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
      t.ok(true, `stream ${emit} ended`)
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
  const chopper = new StreamChopper({size: 4})

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
      t.ok(true, `stream ${emit} ended`)
      next()
      if (emit === 3) t.end()
    })
  })

  chopper.write('foo')
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
