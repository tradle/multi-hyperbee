const test = require('tape')
const Hyperbee = require('hyperbee')
const ram = require('random-access-memory')
const isEqual = require('lodash/isEqual')
const cloneDeep = require('lodash/cloneDeep')
const pump = require('pump')
const fs = require('fs')
const path = require('path')
rmdir = require('rimraf')
const { checkForPeers, checkStoreAndDiff } = require('./helpers')

const MultiHyperbee = require('../')
var { object0, object1, object1_1, object2,
      diff0, diff1, diff1_1, diff2 } = require('./constants')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }


test('Multihyperbee - auto-generate diff', async t => {
  const { multiHBs } = await setupReplChannel(3)
  const [ primary, secondary, tertiary ] = multiHBs

  // The delays are artificial. Without them the mesages get lost for some reason
  await put(primary, diff0, object0)
await delay(100)
  await put(primary, diff1, object1)
await delay(100)
  await put(secondary, diff1_1, object1_1)
await delay(100)
  await put(secondary, null, object2)
await delay(100)
  let storeArr = [object0, object1, object1_1, object2]
  let diffArr = [diff0, diff1, diff1_1, diff2]
  await checkStoreAndDiff(t, multiHBs, storeArr, diffArr)

  if (diffArr.length)
    t.fail()
  t.end()
})

test('Multihyperbee - restore peers', async t => {
  let storage = './test/mh/'
  let { multiHBs, hasPeers } = await setupReplChannel(2, storage)

  let [primary, secondary] = multiHBs
  if (!hasPeers) {
    await put(primary, diff0, object0)
    await delay(100)
    await put(primary, diff1, object1)
    await delay(100)
    await put(secondary, diff1_1, object1_1)
    await delay(100)
  }
  let storeArr = [object0, object1, object1_1]
  let diffArr = [diff0, diff1, diff1_1, diff2]
  await checkStoreAndDiff(t, multiHBs, storeArr, diffArr)
  if (hasPeers) {
    rmdir(storage, function(error) {
      if (error)
        console.log(`Error deleting directory ${storage}`, error)
      else
        console.log(`directory ${storage} was successfully deleted`)
    })
  }
  t.end()
})
async function setupReplChannel(count, storage) {
  let names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  let multiHBs = []

  for (let i=0; i<count; i++) {
    let s = storage && `${storage}_${i}` || ram
    let mh = new MultiHyperbee(s, {...OPTIONS, name: names[i]})
    multiHBs.push(mh)
  }

  let hasPeers = await checkForPeers(multiHBs, storage)

  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed
    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      let cloneFeed = (await multiHBs[j].addPeer(diffFeed.key)).feed

      let pstream = diffFeed.replicate(false, {live: true})
      let cstream = cloneFeed.replicate(true, {live: true})
      pump(pstream, cstream, pstream)

      // pstream.pipe(cloneFeed.replicate(true, {live: true})).pipe(pstream)
    }
  }
  return { multiHBs, hasPeers }
}
async function put(hyperbee, diff, value) {
  // debugger
  let key = `${value._objectId}`
  let val = cloneDeep(value)
  if (diff)
    val._diff = cloneDeep(diff)

  await hyperbee.put(key, val)
}
async function delay (ms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

