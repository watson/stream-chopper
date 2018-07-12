'use strict'

const util = require('util')
const Writable = require('readable-stream').Writable
const PassThrough = require('readable-stream').PassThrough

module.exports = StreamChopper

util.inherits(StreamChopper, Writable)

function StreamChopper (opts) {
  if (!(this instanceof StreamChopper)) return new StreamChopper(opts)
  if (!opts) opts = {}

  Writable.call(this, opts)

  this._maxSize = opts.maxSize || Infinity // TODO: Consider calling this size instead
  this._maxDuration = opts.maxDuration || -1 // TODO: Consider calling this either duration or time instead
  this._softlimit = !!opts.softlimit
  this._splitWrites = opts.splitWrites !== false

  this._bytes = 0
  this._stream = null

  this._starting = false
  this._ending = false
  this._draining = false

  this._next = noop
  this._oneos = oneos
  this._ondrain = ondrain

  if (this._softlimit === false && this._splitWrites === false && this._maxSize < Infinity) {
    // Without this check we might have a situation where the size of the
    // written data was too big to fit without needing to be split into
    // multiple streams
    throw new Error('If maxSize < Infinity, either softlimit or splitWrites have to be true')
  }

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

StreamChopper.prototype.chop = function (cb) {
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
  this._starting = true

  this._bytes = 0
  this._stream = new PassThrough()
    .on('close', this._oneos)
    .on('error', this._oneos)
    .on('finish', this._oneos)
    .on('drain', this._ondrain)

  this.emit('stream', this._stream, () => {
    // TODO: What if this._stream have been set to null in the meantime?
    this._starting = false

    if (this._maxDuration !== -1) {
      this._timer = setTimeout(() => {
        this._timer = null
        this.chop()
      }, this._maxDuration)
      this._timer.unref()
    }

    if (cb) cb()
  })
}

StreamChopper.prototype._endStream = function (cb) {
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
  this._stream.removeListener('drain', this._ondrain)
  this._stream = null
}

StreamChopper.prototype._write = function (chunk, enc, cb) {
  if (this._stream === null) {
    this._startStream(() => {
      this._write(chunk, enc, cb) // TODO: Is it allowed to call _write in this case?
    })
    return
  } else if (this._bytes >= this._maxSize ||
      (!this._softlimit && (this._bytes + chunk.length) > this._maxSize) ||
      (this._splitWrites && (this._bytes + chunk.length) > this._maxSize)) {
    const missing = this._maxSize - this._bytes
    if (this._writableState.objectMode === false && this._splitWrites && missing > 0) {
      this._stream.write(chunk.slice(0, missing))
      chunk = chunk.slice(missing)
    }

    this.chop(err => {
      if (err) return cb(err)
      this._write(chunk, enc, cb) // TODO: Is it allowed to call _write in this case?
    })
    return
  }

  this._bytes += chunk.length

  if (this._stream.write(chunk) === false) this._draining = true
  if (this._draining === false) cb()
  else this._next = cb
}

StreamChopper.prototype._destroy = function (err, cb) {
  const stream = this._stream
  this._removeStream()
  if (stream !== null) {
    stream.on('error', done)
    stream.on('close', done)
    stream.on('finish', done)
    // TODO: Is this the correct way to handle the error?
    stream.destroy(err)
  } else {
    cb()
  }

  function done (err) {
    stream.removeListener('error', done)
    stream.removeListener('close', done)
    stream.removeListener('finish', done)
    cb(err)
  }
}

StreamChopper.prototype._final = function (cb) {
  if (this._stream === null) return cb()
  this._stream.end(cb)
}

function noop () {}
