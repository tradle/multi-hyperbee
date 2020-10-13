const Hyperbee = require('hyperbee')
/*
  This implementation copies the replicated data from all the devices Hyperbees replicas into the primary Hyperbee.
  This guarantees all devices Hyperbees to have the same full set of data
 */

class MultiHyperbee extends Hyperbee {
  constructor (feed, opts = {}) {
    super(feed, opts)
    this.name = opts.name || 'multi-hyperbee'
    this.sources = new Map()
    this.deletedsources = new Map()
  }

  addHyperbee(hyperbee) {
    const keyString = hyperbee.feed.key.toString('hex')
    this.sources.set(keyString, hyperbee)

    if (this.deletedsources.get(keyString))
      this.deletedsources.remove(keyString)

    this._update(keyString)
  }

  removeHyperbee (key) {
    const keyString = key.toString('hex')
    const hyperbee = this.sources.get(keyString)

    if (!hyperbee) return false

    this.sources.delete(keyString)
    this.deletedsources.set(keyString, hyperbee)

    return hyperbee
  }

  _update(keyString) {
    if (this.deletedsources.get(keyString))
      return
    const peerHyperbee = this.sources.get(keyString)
    const peerFeed = peerHyperbee.feed

    peerFeed.update(() => {
      let rs = peerHyperbee.createHistoryStream({ gte: -1 })
      rs.on('data', async (data) => {
        let { key, value } = data
        if (value._replica)
          return
        await this.put(key, {...value, _replica: true})
      })
      this._update(keyString)
    })
  }
}

module.exports = MultiHyperbee

// attempt to simplify caller code, but too many variables needed
//
// async addHyperbee({ key, options }) {
//   if (!options)
//     options = { keyEncoding: 'utf-8', valueEncoding: 'json' }

//   let peerFeed = hypercore(ram, key, { valueEncoding: options.valueEncoding, sparse: true })

//   await promisify(peerFeed.ready.bind(peerFeed))()

//   let peerHyperbee = new Hyperbee(peerFeed, options)

//   const keyString = key.toString('hex')
//   this.sources.set(keyString, peerHyperbee)

//   this._update(keyString)

//   return peerHyperbee
// }

