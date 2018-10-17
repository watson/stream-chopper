'use strict'

const util = require('util')
const { Writable, PassThrough } = require('readable-stream')

module.exports = StreamChopper

util.inherits(StreamChopper, Writable)

StreamChopper.split = Symbol('split')
StreamChopper.overflow = Symbol('overflow')
StreamChopper.underflow = Symbol('underflow')

const types = [
  StreamChopper.split,
  StreamChopper.overflow,
  StreamChopper.underflow
]

function StreamChopper (opts) {
  if (!(this instanceof StreamChopper)) return new StreamChopper(opts)
  if (!opts) opts = {}

  Writable.call(this, opts)

  this.size = opts.size || Infinity
  this.time = opts.time || -1
  this.type = types.indexOf(opts.type) === -1
    ? StreamChopper.split
    : opts.type
  this._transform = opts.transform

  if (this._transform && this.type === StreamChopper.split) {
    throw new Error('stream-chopper cannot split a transform stream')
  }

  this._bytes = 0
  this._stream = null

  this._locked = false
  this._draining = false
  this._destroyed = false

  this._onunlock = null
  this._next = noop
  this._oneos = oneos
  this._ondrain = ondrain

  const self = this

  function oneos (err) {
    if (err) self.emit('error', err)
    self._removeStream()
  }

  function ondrain () {
    self._draining = false
    const next = self._next
    self._next = noop
    next()
  }
}

StreamChopper.prototype.chop = function (cb) {
  if (this._destroyed) {
    if (cb) process.nextTick(cb)
  } else if (this._onunlock === null) {
    this._endStream(cb)
  } else {
    const write = this._onunlock
    this._onunlock = () => {
      write()
      this._endStream(cb)
    }
  }
}

StreamChopper.prototype._startStream = function (cb) {
  if (this._destroyed) return
  if (this._locked) {
    this._onunlock = cb
    return
  }

  this._bytes = 0

  if (this._transform) {
    this._stream = this._transform().once('resume', () => {
      // in case `_removeStream` have just been called
      if (this._stream === null) return

      // `resume` will be emitted before the first `data` event
      this._stream.on('data', chunk => {
        this._bytes += chunk.length
        this._maybeEndTransformSteam()
      })
    })
  } else {
    this._stream = new PassThrough()
  }

  this._stream
    .on('close', this._oneos)
    .on('error', this._oneos)
    .on('finish', this._oneos)
    .on('end', this._oneos) // in case stream.destroy() is called by the user
    .on('drain', this._ondrain)

  this._locked = true
  this.emit('stream', this._stream, err => {
    this._locked = false
    if (err) return this.destroy(err)

    const cb = this._onunlock
    if (cb) {
      this._onunlock = null
      cb()
    }
  })

  this.resetTimer()

  // To ensure that the write that caused this stream to be started
  // is perfromed in the same tick, call the callback synchronously.
  // Note that we can't do this in case the chopper is locked.
  cb()
}

StreamChopper.prototype._maybeEndTransformSteam = function () {
  if (this._stream === null) return

  // in case of backpresure on the transform stream, count how many bytes are
  // buffered
  const bufferedSize = getBufferedSize(this._stream)

  const overflow = (this._bytes + bufferedSize) - this.size

  if (overflow >= 0) this._endStream()
}

StreamChopper.prototype.resetTimer = function (time) {
  if (arguments.length > 0) this.time = time
  if (this._timer) {
    clearTimeout(this._timer)
    this._timer = null
  }
  if (this.time !== -1 && !this._destroyed && this._stream) {
    this._timer = setTimeout(() => {
      this._timer = null
      this._endStream()
    }, this.time)
    this._timer.unref()
  }
}

StreamChopper.prototype._endStream = function (cb) {
  if (this._destroyed) return
  if (this._stream === null) {
    if (cb) process.nextTick(cb)
    return
  }

  const stream = this._stream

  // ensure all timers and event listeners related to the current stream is removed
  this._removeStream()

  // if stream hasn't yet ended, make sure to end it properly
  if (!stream._writableState.ending && !stream._writableState.finished) {
    stream.end(cb)
  } else if (cb) {
    process.nextTick(cb)
  }
}

StreamChopper.prototype._removeStream = function () {
  if (this._stream === null) return

  const stream = this._stream
  this._stream = null

  if (this._timer !== null) clearTimeout(this._timer)
  if (stream._writableState.needDrain) this._ondrain()
  stream.removeListener('error', this._oneos)
  stream.removeListener('close', this._oneos)
  stream.removeListener('finish', this._oneos)
  stream.removeListener('end', this._oneos)
  stream.removeListener('drain', this._ondrain)
}

StreamChopper.prototype._write = function (chunk, enc, cb) {
  if (this._destroyed) return
  if (this._stream === null) {
    this._startStream(() => {
      this._write(chunk, enc, cb)
    })
    return
  }

  const destroyed = this._stream._writableState.destroyed || this._stream._readableState.destroyed

  if (destroyed) {
    this._startStream(() => {
      this._write(chunk, enc, cb)
    })
    return
  }

  if (this._transform) {
    // The size of a transform stream is counted post-transform and so the size
    // guard is located elsewhere. We can therefore just write to the stream
    // without any checks.
    this._unprotectedWrite(chunk, enc, cb)
  } else {
    this._protectedWrite(chunk, enc, cb)
  }
}

StreamChopper.prototype._protectedWrite = function (chunk, enc, cb) {
  this._bytes += chunk.length

  const overflow = this._bytes - this.size

  if (overflow > 0 && this.type !== StreamChopper.overflow) {
    if (this.type === StreamChopper.split) {
      const remaining = chunk.length - overflow
      this._stream.write(chunk.slice(0, remaining))
      chunk = chunk.slice(remaining)
    }

    if (this.type === StreamChopper.underflow && this._bytes - chunk.length === 0) {
      cb(new Error(`Cannot write ${chunk.length} byte chunk - only ${this.size} available`))
      return
    }

    this._endStream(() => {
      this._write(chunk, enc, cb)
    })
    return
  }

  if (overflow < 0) {
    this._unprotectedWrite(chunk, enc, cb)
  } else {
    // if we reached the size limit, just end the stream already
    this._stream.end(chunk)
    this._endStream(cb)
  }
}

StreamChopper.prototype._unprotectedWrite = function (chunk, enc, cb) {
  if (this._stream.write(chunk) === false) this._draining = true
  if (this._draining === false) cb()
  else this._next = cb
}

StreamChopper.prototype._destroy = function (err, cb) {
  if (this._destroyed) return
  this._destroyed = true

  if (err) this.emit('error', err)

  const stream = this._stream
  this._removeStream()

  if (stream !== null) {
    stream.once('close', () => {
      this.emit('close')
      cb()
    })
    stream.destroy()
  } else {
    this.emit('close')
    cb()
  }
}

StreamChopper.prototype._final = function (cb) {
  if (this._destroyed) return
  if (this._stream === null) return cb()
  this._stream.end(cb)
}

function noop () {}

function getBufferedSize (stream) {
  const buffer = stream.writableBuffer || stream._writableState.getBuffer()
  return buffer.reduce((total, b) => {
    return total + b.chunk.length
  }, 0)
}
