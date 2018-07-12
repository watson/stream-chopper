'use strict'

const test = require('tape')
const StreamChopper = require('./')

const bools = [true, false]

test('default values', function (t) {
  const chopper = new StreamChopper()
  t.equal(chopper._maxSize, Infinity)
  t.equal(chopper._maxDuration, -1)
  t.equal(chopper._softlimit, false)
  t.equal(chopper._splitWrites, true)
  t.equal(chopper._starting, false)
  t.equal(chopper._ending, false)
  t.equal(chopper._draining, false)
  t.end()
})

test('throws: {softlimit: false, splitWrites: false, maxSize: <Infinity}', function (t) {
  t.throws(function () {
    new StreamChopper({softlimit: false, splitWrites: false, maxSize: Number.MAX_SAFE_INTEGER}) // eslint-disable-line no-new
  })
  t.end()
})

test('does not throw: {softlimit: false, splitWrites: false, maxSize: Infinity}', function (t) {
  t.doesNotThrow(function () {
    new StreamChopper({softlimit: false, splitWrites: false, maxSize: Infinity}) // eslint-disable-line no-new
  })
  t.end()
})

test('chopper.chop(callback)', function (t) {
  t.plan(4)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.ok(true, `stream ${emit} ended`)
      if (emit === 2) t.end()
    })
    next()
  })

  chopper.write('hello')
  chopper.chop(function () {
    chopper.write('world')
    chopper.end()
  })
})

test('chopper.chop()', function (t) {
  t.plan(4)

  let emits = 0
  const chunks = ['hello', 'world']
  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), chunks.shift())
    })
    stream.on('end', function () {
      t.ok(true, `stream ${emit} ended`)
      if (emit === 2) t.end()
    })
    next()
  })

  chopper.write('hello')
  chopper.chop()
  chopper.write('world')
  chopper.end()
})

test('chopper.destroy() - active stream', function (t) {
  t.plan(2)

  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function () {
      t.fail('should not emit error')
    })
    stream.on('end', function () {
      t.ok(true)
    })
    next()
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function () {
    t.fail('should not emit error')
  })

  chopper.write('hello')
  chopper.destroy()
})

test('chopper.destroy(err) - active stream', function (t) {
  t.plan(3)

  const chopper = new StreamChopper()
  const err = new Error('foo')

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function (_err) {
      t.equal(_err, err)
    })
    stream.on('end', function () {
      t.ok(true)
    })
    next()
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function () {
    t.fail('should not emit error')
  })

  chopper.write('hello')
  chopper.destroy(err)
})

test('chopper.destroy() - no active stream', function (t) {
  t.plan(2)

  const chopper = new StreamChopper()

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function () {
      t.fail('should not emit error')
    })
    stream.on('end', function () {
      t.ok(true)
    })
    next()
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function () {
    t.fail('should not emit error')
  })

  chopper.write('hello')
  chopper.chop() // make sure there's no active stream
  chopper.destroy()
})

test('chopper.destroy(err) - no active stream', function (t) {
  t.plan(2)

  const chopper = new StreamChopper()
  const err = new Error('foo')

  chopper.on('stream', function (stream, next) {
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello')
    })
    stream.on('error', function () {
      t.fail('should not emit error')
    })
    stream.on('end', function () {
      t.ok(true)
    })
    next()
  })

  chopper.on('close', function () {
    t.end()
  })

  chopper.on('error', function () {
    t.fail('should not emit error')
  })

  chopper.write('hello')
  chopper.chop() // make sure there's no active stream
  chopper.destroy(err)
})

test('should not chop if no maxSize is given', function (t) {
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

test('should not chop if no maxDuration is given', function (t) {
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

test('should chop when maxDuration timeout occurs', function (t) {
  const chopper = new StreamChopper({maxDuration: 50})
  chopper.on('stream', assertOnStream(t, 2))
  chopper.write('hello world 1')
  setTimeout(function () {
    chopper.write('hello world 2')
    chopper.end()
  }, 100)
})

test('if next() isn\'t called, no data should be emitted', function (t) {
  let emitted = false
  const chopper = new StreamChopper()
  chopper.on('stream', function (stream, next) {
    t.equal(emitted, false)
    emitted = true
    stream.on('data', function (chunk) {
      t.fail('should never emit data')
    })
    stream.on('end', function () {
      t.fail('should never emit end')
    })
  })
  chopper.write('hello')
  chopper.write('world')
  chopper.end()
  setTimeout(function () {
    t.end()
  }, 100)
})

bools.forEach(function (softlimit) {
  bools.forEach(function (splitWrites) {
    if (!softlimit && !splitWrites) return // invalid combo of config options

    const sizeOfWrite = 'hello world 1'.length
    const opts = {
      maxSize: sizeOfWrite * 3, // allow for a length of exactly 3x of a single write
      softlimit,
      splitWrites
    }

    test('write with no remainder: ' + JSON.stringify(opts), function (t) {
      const chopper = new StreamChopper(opts)
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
})

test('write with remainder: maxSize + softlimit + no splitWrites', function (t) {
  const sizeOfWrite = 'hello world 1'.length
  const maxSize = Math.round(sizeOfWrite + sizeOfWrite / 2) // allow for a length of 1.5x of a single write

  const chopper = new StreamChopper({maxSize, softlimit: true, splitWrites: false})
  chopper.on('stream', assertOnStream(t, 3))
  chopper.write('hello world 1')
  chopper.write('hello world 1') // go 0.5 over the limit
  chopper.write('hello world 2')
  chopper.write('hello world 2') // go 0.5 over the limit
  chopper.write('hello world 3')
  chopper.write('hello world 3') // go 0.5 over the limit
  chopper.end()
})

// when splitWrites:true, then softlimit shouldn't have an effect
bools.forEach(function (softlimit) {
  const opts = {
    maxSize: 12,
    splitWrites: true,
    softlimit
  }

  test('write with remainder: ' + JSON.stringify(opts), function (t) {
    const streams = [
      ['hello world', 'h'],
      ['ello world', 'he'],
      ['llo world', 'hel'],
      ['lo world']
    ]

    const chopper = new StreamChopper(opts)

    chopper.on('stream', function (stream, next) {
      const chunks = streams.shift()
      t.ok(chunks)

      stream.on('data', function (chunk) {
        const expected = chunks.shift()
        t.ok(expected)
        t.equal(chunk.toString(), expected)
      })

      if (streams.length === 0) {
        stream.on('end', function () {
          t.end()
        })
      }
      next()
    })

    chopper.write('hello world')
    chopper.write('hello world')
    chopper.write('hello world')
    chopper.write('hello world')
    chopper.end()
  })
})

test('softlimit: false, splitWrites: true, chunk.length > maxSize', function (t) {
  const streams = [
    ['hello'],
    [' worl'],
    ['d', 'hell'],
    ['o wor'],
    ['ld']
  ]

  const chopper = new StreamChopper({softlimit: false, splitWrites: true, maxSize: 5})

  chopper.on('stream', function (stream, next) {
    const chunks = streams.shift()
    t.ok(chunks)

    stream.on('data', function (chunk) {
      const expected = chunks.shift()
      t.ok(expected)
      t.equal(chunk.toString(), expected)
    })

    if (streams.length === 0) {
      stream.on('end', function () {
        t.end()
      })
    }
    next()
  })

  chopper.write('hello world')
  chopper.write('hello world')
  chopper.end()
})

function assertOnStream (t, expectedEmits) {
  let emits = 0
  return function (stream, next) {
    const emit = ++emits
    stream.on('data', function (chunk) {
      t.equal(chunk.toString(), 'hello world ' + emit, 'expected data for stream ' + emit)
    })
    if (emits >= expectedEmits) {
      stream.on('end', function () {
        t.equal(emits, expectedEmits)
        t.end()
      })
    }
    next()
  }
}
