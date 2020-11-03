const Hyperbee = require('hyperbee')
const hypercore = require('hypercore')
const isEqual = require('lodash/isEqual')
const size = require('lodash/size')
const extend = require('lodash/extend')
const Union = require('sorted-union-stream')
const { promisify } = require('util')
const Clock = require('./clock')
const MergeHandler = require('./mergeHandler')
const { Timestamp, MutableTimestamp } = require('./timestamp')()

// This implementation uses HLC Clock implemented by James Long in his crdt demo app
class MultiHyperbee extends Hyperbee {
  constructor(storage, options, customMergeHandler) {
    let { valueEncoding, name } = options
    let feed = hypercore(storage)
    super(feed, options) // this creates the store

    this.storage = storage
    this.options = options
    this.mergeHandler =  customMergeHandler && customMergeHandler || new MergeHandler(this)
    this.sources = {}
    this.deletedSources = {}
    this.name = name || ''
    this._init = this.init()
  }

  async init() {
    try {
      await promisify(this.feed.ready.bind(this.feed))()
    } catch (err) {
      throw new Error('something wrong with the feed', err)
    }

    let diffStorage
    if (typeof this.storage === 'string')
      diffStorage = `${this.storage}_diff` // place diffHyperbee in the same directory
    else
      diffStorage = this.storage // storage function chosen by user: could be ram, ras3, etc.

    this.diffFeed = hypercore(diffStorage)
    try {
      await promisify(this.diffFeed.ready.bind(this.diffFeed))()
    } catch (err) {
      throw new Error('something wrong with diff feed', err)
    }
    this.diffHyperbee = new Hyperbee(this.diffFeed, this.options)
    this.clock = new Clock(new Timestamp(0, 0, this.feed.key.toString('hex')));
  }
  async get(key) {
    await this._init
    return super.get(key)
  }
  async del(key) {
    await this._init
    await super.del(key)
  }
  async put(key, value, noDiff) {
    await this._init
    if (!this.diffHyperbee) {
      super.put(key, value)
      return
    }

    if (!value)
      throw new Error('multi-hyperbee: value parameter is required')
    if (!value._objectId)
      value._objectId = key
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

    diff = this.mergeHandler.genDiff(value, cur  &&  cur.value)
    if (prevTimestamp)
      diff.obj._prevTimestamp = prevTimestamp
    await this.diffHyperbee.put(`${key}/${timestamp}`, diff)
  }
  async peek() {
    await this._init
    return await super.peek([options])
  }
  async getDiff() {
    await this._init
    return this.diffHyperbee
  }

  async addPeer(key) {
    await this._init
    let peerStorage
    if (typeof this.storage === 'string')
      peerStorage = `${this.storage}_peer_${size(this.sources) + 1}`
    else
      peerStorage = this.storage
    let { valueEncoding } = this.options
    let peerFeed = hypercore(peerStorage, key)

    let peer = new Hyperbee(peerFeed, this.options)
    await peer.ready()

    const keyString = key.toString('hex')
    this.sources[keyString] = peer

    if (this.deletedSources[keyString])
      delete this.deletedSources[keyString]

    await this._update(keyString)

    return peer
  }

  removePeer (key) {
    if (!this.diffHyperbee)
      throw new Error('Works only with Diff hyperbee')

    const keyString = key.toString('hex')
    const hyperbee = this.sources[keyString]

    if (!hyperbee) return false

    delete this.sources[keyString]
    this.deletedSources[keyString] = hyperbee

    return hyperbee
  }
  async getPeers() {
    return Object.values(this.sources)
  }
  createUnionStream(key) {
    // await this._resolveWithReady

    if (!key)
      throw new Error('Key is expected')
    let sortedStreams = []
    for (let s in this.sources) {
      let hb  = this.sources[s]
      sortedStreams.push(
        hb.createReadStream({ gte: key, lte: key.split('/').splice(0, -1).join('/') })
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
  batch() {
    if (!this.diffHyperbee)
      return super.batch()

    throw new Error('Not supported yet')
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
  async _update(keyString, seqs) {
    if (this.deletedSources[keyString])
      return
    const peer = this.sources[keyString]
    const peerFeed = peer.feed
    peerFeed.update(() => {
// console.log(`UPDATE: ${peerFeed.key.toString('hex')}`)
      let rs = peer.createHistoryStream({ gte: -1 })
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
          await this.mergeHandler.merge(values[i])
      })
      this._update(keyString, newSeqs)
    })
  }
}
module.exports = MultiHyperbee

  // async init() {
  //   await super.ready()
  //   this.clock = new Clock(new Timestamp(0, 0, this.feed.key.toString('hex')));

  //   let diffStorage
  //   if (typeof this.storage === 'string')
  //     diffStorage = `${this.storage}_diff` // place diffHyperbee in the same directory
  //   else
  //     diffStorage = this.storage // storage function chosen by user: could be ram, ras3, etc.

  //   this.diffFeed = hypercore(diffStorage)

  //   this.diffHyperbee = new Hyperbee(this.diffFeed, this.options)
  //   await this.diffHyperbee.ready()
  // }
