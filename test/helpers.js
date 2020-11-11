const hypercore = require('hypercore')
const { promisify } = require('util')
const ram = require('random-access-memory')
const isEqual = require('lodash/isEqual')
const MultiHyperbee = require('../')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }

const helpers = {
  async setup(count, storage) {
    let names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    let multiHBs = []

    for (let i=0; i<count; i++) {
      let s = storage && `${storage}_${i}` || ram
      let mh = new MultiHyperbee(s, {...OPTIONS, name: names[i]})
      multiHBs.push(mh)
    }

    let hasPeers = await helpers.checkForPeers(multiHBs, storage)
    return {multiHBs, hasPeers}
  },
  async checkForPeers(multiHBs, storage) {
    if (!storage)
      return
    let peersMap = []
    let hasPeers
    for (let i=0; i<multiHBs.length; i++) {
      let multiHB = multiHBs[i]
      let peers = await multiHB.getPeers()

      if (peers  &&  peers.length)
        hasPeers = true
    }
    return hasPeers
  },
  async put(hyperbee, diff, value) {
    let key = `${value._objectId}`
    let val = cloneDeep(value)
    if (diff)
      val._diff = cloneDeep(diff)

    await hyperbee.put(key, val)
  },
  async delay (ms) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  },

  async checkStoreAndDiff(t, multiHBs, storeArr, diffArr, print) {
    for (let i=0; i<multiHBs.length; i++) {
      let multiHB = multiHBs[i]
      let sec = multiHB.createHistoryStream()
      let counter = storeArr.length
      await new Promise((resolve, reject) => {
        sec.on('data', data => {
          if (print)
            console.log(multiHB.name + ' ' + JSON.stringify(data.value, null, 2))
          // Check that it's not peer list
          if (Array.isArray(data.value))
            return

          let { value } = data
          delete value._timestamp
          delete value._prevTimestamp
          let v = storeArr.find(val => isEqual(val, value))
          t.same(value, v)
          counter--
        })
        sec.on('end', (data) => {
          if (counter)
            t.fail()
          resolve()
        })
      })
    }

    let diffs = await Promise.all(multiHBs.map(mh => mh.getDiff()))
    for (let i=0; i<diffs.length; i++) {
      let hstream = diffs[i].createHistoryStream()
      let multiHB = multiHBs[i]
      await new Promise((resolve, reject) => {
        hstream.on('data', ({value}) => {
          if (print)
            console.log(multiHB.name + 'Diff ' + JSON.stringify(value, null, 2))
          delete value._timestamp
          delete value.obj._prevTimestamp
          t.same(value, diffArr[0])
          diffArr.shift()
        })
        hstream.on('end', (data) => {
          resolve()
        })
      })
    }
  }
}
module.exports = helpers