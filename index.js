const Hyperbee = require('hyperbee')
const hypercore = require('hypercore')
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
  constructor(storage, options, customMergeHandler) {
    let { valueEncoding, name } = options
    let feed = hypercore(storage)
    super(feed, options) // this creates the store

    this.storage = storage
    this.options = options
    this.mergeHandler =  customMergeHandler && customMergeHandler || mergeHandler
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

    debugger
    diff = this._genDiff(key, value, cur  &&  cur.value)
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

    let peerHyperbee = new Hyperbee(peerFeed, this.options)
    await peerHyperbee.ready()

    const keyString = key.toString('hex')
    this.sources[keyString] = peerHyperbee

    if (this.deletedSources[keyString])
      delete this.deletedSources[keyString]

    await this._update(keyString)
    return peerHyperbee
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
  _genDiff(key, newValue, oldValue) {
    if (!oldValue)
      oldValue = {}
    let add = {}
    let insert = {}
    let remove = {}

    for (let p in newValue) {
      if (p.charAt(0) === '_')
        continue
      let oldVal = oldValue[p]
      let newVal = newValue[p]
      delete oldValue[p]

      if (!oldVal) {
        add[p] = newVal
        continue
      }

      if (oldVal === newVal  || (typeof oldVal === 'object' && isEqual(oldVal, newVal)))
        continue
      if (Array.isArray(oldVal)) {
        let newVal1 = newVal.slice()
        for (let i=0; i<oldVal.length; i++) {
          let idx = newVal1.indexOf(oldVal[i])
          if (idx !== -1) {
            newVal1.splice(idx, 1)
            continue
          }
          if (!insert.remove)
            insert.remove = {}
          if (!insert.remove[p])
            insert.remove[p] = [{value: oldVal[i]}]
        }
        if (newVal1.length) {
          if (!insert.add)
            insert.add = {}
          insert.add = []
          newVal1.forEach(value => {
            let idx = newVal.indexOf(value)
            insert.add.push({after: newVal[idx - 1], value})
          })
        }
        continue
      }
      if (typeof oldVal === 'object') {
        let result = this._diff(oldVal, newVal)
        for (let pp in result) {
          if (typeof result[pp] === 'undefined') {
            if (!insert.remove)
              insert.remove = {}
            if (!insert.remove[p])
              insert.remove[p] = {}

            extend(insert.remove[p], {
              [pp]: oldVal[pp]
            })
          }
          else {
            if (!insert.add) {
              insert.add = {}
              insert.add[p] = {}
            }
            insert.add[p] = {
              ... insert.add[p],
              [pp]: newVal[pp]
            }
          }
        }
        continue
      }
    }
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
    if (size(insert))
      list.insert = insert
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
  _diff(obj1, obj2) {
    const result = {};
    if (Object.is(obj1, obj2)) {
        return undefined;
    }
    if (!obj2 || typeof obj2 !== 'object') {
        return obj2;
    }
    Object.keys(obj1 || {}).concat(Object.keys(obj2 || {})).forEach(key => {
        if(obj2[key] !== obj1[key] && !Object.is(obj1[key], obj2[key])) {
            result[key] = obj2[key];
        }
        if(typeof obj2[key] === 'object' && typeof obj1[key] === 'object') {
            const value = diff(obj1[key], obj2[key]);
            if (value !== undefined) {
                result[key] = value;
            }
        }
    });
    return result;
  }
  async _update(keyString, seqs) {
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
