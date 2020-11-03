const hypercore = require('hypercore')
const { promisify } = require('util')
const ram = require('random-access-memory')

const helpers = {

  async create({count, key, options, storage, persistent}) {
    if (!options)
      options = {}
    if (!count || key)
      count = 1
    let feeds = []
    let opts = {...options, valueEncoding: 'utf-8' }
    for (let i=0; i<count; i++) {
      let feed = hypercore(persistent && storage && `${storage}_${i}` || ram, key, opts)
      await helpers.promisifyAndExec(feed, 'ready')
      feeds.push(feed)
    }
    return feeds
  },
  async promisifyAndExec(instance, method, params) {
    if (params)
      return await(promisify(instance[method].bind(instance)))(params)
    else
      return await(promisify(instance[method].bind(instance)))()
  },
  delay (ms) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }
}
module.exports = helpers