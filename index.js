const Hyperbee = require('hyperbee')
const hypercore = require('hypercore')
const { isEqual, size, extend } = require('lodash')
const Union = require('sorted-union-stream')
const Clock = require('./clock')
const MergeHandler = require('./mergeHandler')
const { Timestamp, MutableTimestamp } = require('./timestamp')()

const KEY_TO_PEERS = '__peers'
// This implementation uses HLC Clock implemented by James Long in his crdt demo app
class MultiHyperbee extends Hyperbee {
  constructor(storage, options, customMergeHandler) {
    let { valueEncoding, name, metadata } = options
    let feed = hypercore(storage)
    let peersListKey
    if (!metadata)
      options.metadata = metadata = {}
    else
      peersListKey = metadata.contentFeed
    // Save the key to peers in the head block
    if (!peersListKey)
      extend(options.metadata, {contentFeed: KEY_TO_PEERS})

    super(feed, options) // this creates the store

    this.peerListKey = metadata.contentFeed
    this.storage = storage
    this.options = options
    this.mergeHandler =  customMergeHandler && customMergeHandler || new MergeHandler(this)
    this.sources = {}
    this.deletedSources = {}
    this.name = name || ''
    this._init = this.init()
  }

  async init() {
    await this.ready()

    let diffStorage
    let presistentStorage = typeof this.storage === 'string'
    if (presistentStorage)
      diffStorage = `${this.storage}_diff` // place diffHyperbee in the same directory
    else
      diffStorage = this.storage // storage function chosen by user: could be ram, ras3, etc.

    this.diffFeed = hypercore(diffStorage)
    this.diffHyperbee = new Hyperbee(this.diffFeed, this.options)

    await this.diffHyperbee.ready()

    let peers = presistentStorage  &&  await this._restorePeers()

    this.clock = await this._createClock(peers)
  }
  async _createClock(hasPeers) {
    let keyString = this.feed.key.toString('hex')
    let clock = new Clock(new Timestamp(0, 0, keyString))
    if (!hasPeers)
      return clock

    let hs = this.createHistoryStream({gte: -1, limit: 1})
    let entries
    try {
      entries = await this._collect(hs)
    } catch (err) {
      console.log('No entries found', err)
    }
    if (!entries  ||  !entries.length || !entries[0].value._timestamp)
      return clock

    let timestamp = entries[0].value._timestamp
    let idx = timestamp.length - 5
    let millis = new Date(timestamp.slice(0, idx)).getTime()
    let counter = parseInt(timestamp.slice(idx + 1))
    return new Clock(new Timestamp(millis, counter, keyString))
  }
  async get(key) {
    await this._init
    return this._get(key)
  }
  async del(key) {
    await this._init
    await super.del(key)
  }
  async put(key, value, noDiff) {
    await this._init
    if (key === this.peerListKey) {
      super.put(key, value)
      return
    }

    if (!value)
      throw new Error('multi-hyperbee: value parameter is required')
    if (!noDiff  &&  (typeof value !== 'object'  || value.constructor !== Object))
      throw new Error('multi-hyperbee: value expected to be JSON object')

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

  async addPeer(key, allPeersKeyStrings) {
    await this._init
    return await this._addPeer(key)
  }

  async _restorePeers() {
    let hs = this.feed.createReadStream({start: 0, end: 1})
    let entries = await this._collect(hs)
    let peerListKey = entries[0].toString().split('\n')[2]
    this.peerListKey = peerListKey.replace(/[^a-zA-Z0-9_]/g, '')
    debugger

    let peerList = await this._get(this.peerListKey)
    if (!peerList || !peerList.value ||  !peerList.value.length)
      return
    let peersHB = []
    let keys = peerList.value
    let keyStrings = keys.map(key => key.toString('hex'))
    for (let i=0; i<keys.length; i++) {
      let key = keys[i]
      let keyString = keyStrings[i]

      let peer = await this._addPeer(key, keyStrings)
      peersHB.push(peer)
      this.sources[keyString] = peer
    }
    return peersHB
  }
  async removePeer (key) {
    await this._init

    const keyString = key.toString('hex')
    const hyperbee = this.sources[keyString]

    if (!hyperbee) return false

    delete this.sources[keyString]
    this.deletedSources[keyString] = hyperbee

    return hyperbee
  }
  async getPeers() {
    await this._init
    return Object.values(this.sources)
  }
  createUnionStream(key) {
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
    throw new Error('Not supported yet')
  }

    // need this for restore peers on init stage
  async _get(key) {
    return super.get(key)
  }
  async _put(key, value) {
    await this.put(key, value, true)
  }
  async _addPeer(key, allPeersKeyStrings) {
    const keyString = key.toString('hex')
    let peer = this.sources[keyString]
    if (peer)
      return peer
    let peerStorage
    if (typeof this.storage === 'string')
      peerStorage = `${this.storage}_peer_${size(this.sources) + 1}`
    else
      peerStorage = this.storage
    let { valueEncoding } = this.options
    let peerFeed = hypercore(peerStorage, key)

    peer = new Hyperbee(peerFeed, this.options)
    await peer.ready()

    this.sources[keyString] = peer

    if (!allPeersKeyStrings || allPeersKeyStrings.indexOf(keyString) === -1)
      await this._addRemovePeer(keyString, true)

    if (this.deletedSources[keyString])
      delete this.deletedSources[keyString]

    await this._update(keyString)

    return peer
  }
  // replicate(isInitiator, options) {
  //   return this.diffFeed.replicate(isInitiator, options)
  // }
  async _addRemovePeer(keyString, isAdd) {
    let peersList
    try {
      peersList = await this.get(this.peerListKey)
    } catch (err) {
      debugger
    }

    if (!peersList)
      peersList = []
    else
      peersList = peersList.value
    if (isAdd)
      peersList.push(keyString)
    else {
      let idx = peersList.indexOf(keyString)
      if (idx === -1) {
        debugger
        console.log('Something went wrong. The key was not found in peers list')
        return
      }
      peersList.splice(idx, 1)
    }

    await this._put(this.peerListKey, peersList)
  }
  _parseTimestamp(timestamp) {
    let tm = timestamp.split('-')
    return {
      millis: new Date(tm[0]).getTime(),
      counter: parseInt(tm[1])
    }
  }
  async _update(keyString, seqs) {
    if (this.deletedSources[keyString])
      return
    const peer = this.sources[keyString]
    const peerFeed = peer.feed
    peerFeed.update(() => {
      if (peer.name)
        console.log(`UPDATE: ${peer.name}`)
 // console.log(`UPDATE: ${peerFeed.key.toString('hex')}`)
      let rs = peer.createHistoryStream({ gte: -1 })
      let newSeqs = []
      let values = []
      rs.on('data', async (data) => {
        let { key, seq, value } = data
        newSeqs.push(seq)
        if (!value) //  &&  key.trim().replace(/[^a-zA-Z0-9_]/g, '') === KEY_TO_PEERS)
          return

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
  async _collect(stream) {
    return new Promise((resolve, reject) => {
      const entries = []
      stream.on('data', d => entries.push(d))
      stream.on('end', () => resolve(entries))
      stream.on('error', err => reject(err))
      stream.on('close', () => reject(new Error('Premature close')))
    })
  }
}
module.exports = MultiHyperbee
