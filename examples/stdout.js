'use strict'

const StreamChopper = require('stream-chopper')

const chopper = new StreamChopper({
  size: 30, // chop stream when it reaches 30 bytes,
  time: 10000, // or when it's been open for 10s,
  type: StreamChopper.overflow // but allow stream to exceed size slightly
})

chopper.on('stream', function (stream, next) {
  console.log('>> Got a new stream! <<')
  stream.pipe(process.stdout)
  stream.on('end', next) // call next when you're ready to receive a new stream
})

chopper.write('This write contains more than 30 bytes\n')
chopper.write('This write contains less\n')
chopper.write('This is the last write\n')
