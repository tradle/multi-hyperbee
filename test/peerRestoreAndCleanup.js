const test = require('tape')
const rmdir = require('rimraf')
const { checkStoreAndDiff, setup } = require('./helpers')

var { object0, object1, object1_1, object2,
      diff0, diff1, diff1_1, diff2 } = require('./constants')

test('Multihyperbee - restore peers, restore HLC clock, cleanup peers', async t => {
  let storage = './test/mh/'
  let { multiHBs, hasPeers } = await setup(2, storage)

  if (hasPeers) {
    let storeArr = [object0, object1, object1_1]
    let diffArr = [diff0, diff1, diff1_1, diff2]

    await checkStoreAndDiff(t, multiHBs, storeArr, diffArr)
    rmstorage()
  }
  else
    t.pass('Nothing to check')
  t.end()
})

function rmstorage() {
  let storages = ['./test/mh/', './test/mht/', './test/mht2']
  storages.forEach(storage => {
    rmdir(storage, error => {
      if (error)
        console.log(`Error deleting directory ${storage}`, error)
      else
        console.log(`directory ${storage} was successfully deleted`)
    })
  })
}
