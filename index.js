'use strict'

const util = require('util')
const Writable = require('readable-stream').Writable
const PassThrough = require('readable-stream').PassThrough

module.exports = StreamChopper

util.inherits(StreamChopper, Writable)

StreamChopper.split = Symbol('split')
StreamChopper.overflow = Symbol('overflow')
StreamChopper.underflow = Symbol('underflow')

const splittypes = [
  StreamChopper.split,
  StreamChopper.overflow,
  StreamChopper.underflow
]

function StreamChopper (opts) {
  if (!(this instanceof StreamChopper)) return new StreamChopper(opts)
  if (!opts) opts = {}

  Writable.call(this, opts)

  this._maxSize = opts.maxSize || Infinity // TODO: Consider calling this size instead
  this._maxDuration = opts.maxDuration || -1 // TODO: Consider calling this either duration or time instead
  this._splittype = splittypes.indexOf(opts.splittype) === -1 // TODO: Find better name
    ? StreamChopper.split
    : opts.splittype

  this._bytes = 0
  this._stream = null

  this._locked = false
  this._starting = false
  this._ending = false
  this._draining = false
  this._destroyed = false

  this._onunlock = noop
  this._next = noop
  this._oneos = oneos
  this._ondrain = ondrain

  const self = this

  function oneos (err) {
    if (err) self.emit('error', err) // TODO: Should it be re-emitted?
    self._removeStream()
  }

  function ondrain () {
    self._draining = false
    const next = self._next
    self._next = noop
    next()
  }
}

StreamChopper.prototype._chop = function (cb) {
  if (this._destroyed) return
  this._endStream(err => {
    if (err) {
      if (cb) cb(err)
      else this.emit('error', err) // TODO: Is this the right thing to do?
      return
    }
    if (cb) cb()
  })
}

StreamChopper.prototype._startStream = function (cb) {
  if (this._destroyed) return
  if (this._locked) {
    this._onunlock = cb
    return
  }

  this._bytes = 0
  this._stream = new PassThrough()
    .on('close', this._oneos)
    .on('error', this._oneos)
    .on('finish', this._oneos)
    .on('end', this._oneos) // in case stream.destroy() is called by the user
    .on('drain', this._ondrain)

  this._locked = true
  this._starting = true
  this.emit('stream', this._stream, err => {
    this._locked = false
    if (err) return this.destroy(err)

    const cb = this._onunlock
    if (cb) {
      this._onunlock = null
      cb()
    }
  })
  this._starting = false

  if (this._maxDuration !== -1) {
    this._timer = setTimeout(() => {
      this._timer = null
      this._chop()
    }, this._maxDuration)
    this._timer.unref()
  }

  // To ensure that the write that caused this stream to be started
  // is perfromed in the same tick, call the callback synchronously.
  // Note that we can't do this in case the chopper is locked.
  cb()
}

StreamChopper.prototype._endStream = function (cb) {
  if (this._destroyed) return
  if (this._stream === null) return process.nextTick(cb)

  this._ending = true

  const stream = this._stream
  const done = (err) => {
    this._ending = false
    cb(err)
  }

  // ensure all timers and event listeners related to the current stream is removed
  this._removeStream()

  // if stream hasn't yet ended, make sure to end it properly
  if (!stream._writableState.ending && !stream._writableState.finished) {
    stream.end(done)
  } else {
    process.nextTick(done)
  }
}

StreamChopper.prototype._removeStream = function () {
  if (this._stream === null) return
  if (this._timer !== null) clearTimeout(this._timer)
  if (this._stream._writableState.needDrain) this._ondrain()
  this._stream.removeListener('error', this._oneos)
  this._stream.removeListener('close', this._oneos)
  this._stream.removeListener('finish', this._oneos)
  this._stream.removeListener('end', this._oneos)
  this._stream.removeListener('drain', this._ondrain)
  this._stream = null
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

  this._bytes += chunk.length

  const overflow = this._bytes - this._maxSize
  if (overflow > 0 && this._splittype !== StreamChopper.overflow) {
    if (this._splittype === StreamChopper.split) {
      const remaining = chunk.length - overflow
      this._stream.write(chunk.slice(0, remaining))
      chunk = chunk.slice(remaining)
    }

    if (this._splittype === StreamChopper.underflow && this._bytes - chunk.length === 0) {
      cb(new Error(`Cannot write ${chunk.length} byte chunk - only ${this._maxSize} available`))
      return
    }

    this._chop(err => {
      if (err) return cb(err)
      this._write(chunk, enc, cb)
    })
    return
  }

  if (overflow < 0) {
    if (this._stream.write(chunk) === false) this._draining = true
    if (this._draining === false) cb()
    else this._next = cb
  } else {
    // if we reached the maxSize limit, just end the stream already
    this._stream.end(chunk)
    this._endStream(cb)
  }
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
    stream.destroy() // TODO: Should I listen for `error` even though I'm not passing in an error to destroy()?
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
