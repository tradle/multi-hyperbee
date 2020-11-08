const test = require('tape')
const rmdir = require('rimraf')
const { checkStoreAndDiff, setupReplChannel } = require('./helpers')

const MultiHyperbee = require('../')
var { object0, object1, object1_1, object2,
      diff0, diff1, diff1_1, diff2 } = require('./constants')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }


test('Multihyperbee - cleanup peers', async t => {
  let storage = './test/mh/'
  let { multiHBs, hasPeers } = await setupReplChannel(2, storage)

  if (hasPeers) {
    let storeArr = [object0, object1, object1_1]
    let diffArr = [diff0, diff1, diff1_1, diff2]
    await checkStoreAndDiff(t, multiHBs, storeArr, diffArr)
  }
  rmdir(storage, function(error) {
    if (error)
      console.log(`Error deleting directory ${storage}`, error)
    else
      console.log(`directory ${storage} was successfully deleted`)
  })
  if (hasPeers)
    t.end()
  else
    t.fail()
})
