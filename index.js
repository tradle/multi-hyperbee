const Hyperbee = require('hyperbee')
const isEqual = require('lodash/isEqual')
const size = require('lodash/size')
const extend = require('lodash/extend')
const Union = require('sorted-union-stream')
const { promisify } = require('util')
const Clock = require('./clock')
const mergeHandler = require('./mergeHandler')
const { Timestamp, MutableTimestamp } = require('./timestamp')()

// This implementation uses HLC Clock implemented by James Long in his crdt demo app

class MultiHyperbee extends Hyperbee {
  constructor (feed, { diffHyperbee, opts={}, customMergeHandler}) {
    if (!diffHyperbee)
      throw new Error('diffHyperbee - is a required option')

    super(feed, opts)
    this.name = opts.name || ''
    this.diffHyperbee = diffHyperbee

    this.mergeHandler =  customMergeHandler && customMergeHandler || mergeHandler
    this.sources = {}
    this.deletedSources = {}
    // this.clock = new Clock(new Timestamp(0, 0, name));
    this.clock = new Clock(new Timestamp(0, 0, feed.key.toString('hex')));
  }
  getDiffHyperbee() {
    return this.diffHyperbee
  }
  async put(key, value, noDiff) {
    let timestamp = value._timestamp
    if (!timestamp)
      timestamp = Timestamp.send(this.clock.getClock()).toString().slice(0, 29)
    let diff = value._diff
    delete value._diff
    let cur = await this.get(key)

    value._timestamp = timestamp
    const prevTimestamp = cur && cur.value._timestamp
    if (prevTimestamp)
      value._prevTimestamp = prevTimestamp

    await super.put(key, value)
    if (diff) {
      diff._timestamp = timestamp
      if (prevTimestamp)
        diff.obj._prevTimestamp = prevTimestamp
      await this.diffHyperbee.put(`${key}/${timestamp}`, diff)
      return
    }
    if (noDiff) return

    debugger
    diff = this._genDiff(key, value, cur  &&  cur.value)
    if (prevTimestamp)
      diff.obj._prevTimestamp = prevTimestamp
    await this.diffHyperbee.put(`${key}/${timestamp}`, diff)
  }
  createUnionStream(key, reverse) {
    if (!key)
      throw new Error('Key is expected')
    let sortedStreams = []
    for (let s in this.sources) {
      let hb  = this.sources[s]
      sortedStreams.push(
        hb.createReadStream({ gte: key, lte: key.split('/').splice(0, 2).join('/') })
      )
    }
    if (sortedStreams.length === 1)
      return sortedStreams[0]
    let union
    for (let i=1; i<sortedStreams.length; i++)
      union = new Union(union || sortedStreams[i-1], sortedStreams[i], (a, b) => {
        return a._timestamp > b._timestamp
      })
    return union
  }
  addHyperbee(hyperbee) {
    const keyString = hyperbee.feed.key.toString('hex')
    this.sources[keyString] = hyperbee
// console.log(`Add hyperbee to ${this.name}: ${keyString}`)
    if (this.deletedSources[keyString])
      delete this.deletedSources[keyString]

    this._update(keyString)
  }

  removeHyperbee (key) {
    const keyString = key.toString('hex')
    const hyperbee = this.sources[keyString]

    if (!hyperbee) return false

    delete this.sources[keyString]
    this.deletedSources[keyString] = hyperbee

    return hyperbee
  }

  _parseTimestamp(timestamp) {
    let tm = timestamp.split('-')
    return {
      millis: new Date(tm[0]).getTime(),
      counter: parseInt(tm[1])
    }
  }
  async _put(key, value) {
    await this.put(key, value, true)
  }
  _genDiff(key, newValue, oldValue) {
    if (!oldValue)
      oldValue = {}
    let add = {}
    for (let p in newValue) {
      if (p.charAt(0) === '_')
        continue
      let oldVal = oldValue[p]
      let newVal = newValue[p]
      delete oldValue[p]
      if (oldVal  &&  (oldVal === newVal  || (typeof oldVal === 'object' && isEqual(oldVal, newVal))))
        continue
      add[p] = newVal
    }
    let remove = {}
    for (let p in oldValue) {
      if (p.charAt(0) === '_')
        continue
      remove[p] = ''
    }
    let list = {}
    if (size(add))
      list.add = add
    if (size(remove))
      list.remove = remove
    let diff = {
      _timestamp: newValue._timestamp,
      obj: {
        _objectId: key
      },
      list
    }
    if (newValue._prevTimestamp)
      diff.obj._prevTimestamp = newValue._prevTimestamp
    return diff
  }
  _update(keyString, seqs) {
    if (this.deletedSources[keyString])
      return
    const peerHyperbee = this.sources[keyString]
    const peerFeed = peerHyperbee.feed
    peerFeed.update(() => {
// console.log(`UPDATE: ${peerFeed.key.toString('hex')}`)
      let rs = peerHyperbee.createHistoryStream({ gte: -1 })
      let newSeqs = []
      let values = []
      rs.on('data', async (data) => {
        let { seq, value } = data
        newSeqs.push(seq)

        let {millis, counter, node} = this._parseTimestamp(value._timestamp)

        let tm = new Timestamp(millis, counter, node)
        tm = Timestamp.recv(this.clock.getClock(), tm)
        if (seqs  &&  seqs.indexOf(seq) !== -1)
          return
        values.push(value)
        // await this.mergeHandler(this, {...value, _replica: true})
      })
      rs.on('end', async (data) => {
        for (let i=0; i<values.length; i++)
          await this.mergeHandler(this, values[i])
      })
      this._update(keyString, newSeqs)
    })
  }
}
module.exports = MultiHyperbee

