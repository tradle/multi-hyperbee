const test = require('tape')
const Hyperbee = require('hyperbee')
const ram = require('random-access-memory')
const cloneDeep = require('lodash/cloneDeep')
const pump = require('pump')
const fs = require('fs')
const path = require('path')
// const { promisify } = require('util')
const { checkForPeers, checkStoreAndDiff, setup, delay } = require('./helpers')

const MultiHyperbee = require('../')
var { object0, object1, object1_1, object2,
      diff0, diff1, diff1_1, diff2 } = require('./constants')

test('Multihyperbee - persistent storage, basic functionality', async t => {
  let storage = './test/mh/'
  // let { multiHBs, hasPeers, streams } = await setupReplChannel(2, storage)
  let { multiHBs } = await setupReplChannel(2, storage)

  let [primary, secondary] = multiHBs
  await put(primary, diff0, object0)
  await delay(100)
  await put(primary, diff1, object1)
  await delay(100)
  await put(secondary, diff1_1, object1_1)
  await delay(100)
  let storeArr = [object0, object1, object1_1]
  let diffArr = [diff0, diff1, diff1_1]
  await checkStoreAndDiff(t, multiHBs, storeArr, diffArr)
  t.end()
})
test('Multihyperbee - auto-generate diff', async t => {
  const { multiHBs } = await setupReplChannel(2)
  const [ primary, secondary ] = multiHBs

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

async function setupReplChannel(count, storage) {
  let { hasPeers, multiHBs } = await setup(count, storage)

  let streams = []
  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed
    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      await multiHBs[j].addPeer(diffFeed.key)
    }
  }

  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed

    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      let cloneFeeds = await multiHBs[j].getPeers()
      for (let ii=0; ii<cloneFeeds.length; ii++) {
        let pstream = diffFeed.replicate(false, {live: true})
        // let pstream = await multiHB.replicate(false, {live: true})
        streams.push(pstream)
        let cstream = cloneFeeds[ii].feed.replicate(true, {live: true})
        streams.push(cstream)
        pump(pstream, cstream, pstream)
      }
    }
  }
  return { multiHBs, hasPeers, streams }
}
async function put(hyperbee, diff, value) {
  // debugger
  let key = `${value._objectId}`
  let val = cloneDeep(value)
  if (diff)
    val._diff = cloneDeep(diff)

  await hyperbee.put(key, val)
}

/*
  // if (hasPeers) {
  //   rmdir(storage, function(error) {
  //     if (error)
  //       console.log(`Error deleting directory ${storage}`, error)
  //     else
  //       console.log(`directory ${storage} was successfully deleted`)
  //   })
  // }
  // for (let i=0; i<streams.length; i++) {
  //   const stream = streams[i]
  //   stream.end()
  //   stream.destroy()
  // }
  // await delay(2000)
  // debugger
  // for (let i=0; i<multiHBs.length; i++) {
  //   let peers = await multiHBs[i].getPeers()
  //   for (let i=0; i<peers.length; i++) {
  //     let peer = prPeers[i]
  //     await promisify(peer.feed.close.bind(peer.feed))()
  //   }
  // }
  // await promisify(primary.feed.close.bind(primary.feed))()
  // await promisify(secondary.feed.close.bind(secondary.feed))()
  // await promisify(primary.diffFeed.close.bind(primary.diffFeed))()
  // await promisify(secondary.diffFeed.close.bind(secondary.diffFeed))()
 */