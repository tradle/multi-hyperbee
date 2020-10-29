const test = require('tape')
const Hyperbee = require('hyperbee')
const ram = require('random-access-memory')
const isEqual = require('lodash/isEqual')
const cloneDeep = require('lodash/cloneDeep')

const MultiHyperbee = require('../')
const { promisifyAndExec, create, createOne, delay } = require('./helpers')
var { object0, object1, object1_1, object2,
        diff0, diff1, diff1_1, diff2 } = require('./constants')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }

test('Multihyperbee - autogen Diff object', async t => {
  const multiHBs = await setupReplChannel(2)
  const [ primary, secondary ] = multiHBs

  await put(primary, diff0, object0)
await delay(100)
  await put(primary, null, object1)
  let storeArr = [object0, object1]
  for (let i=0; i<multiHBs.length; i++) {
    let multiHB = multiHBs[i]
    let counter = storeArr.length
    let sec = multiHB.createHistoryStream()
    await new Promise((resolve, reject) => {
      sec.on('data', ({value}) => {
        // console.log(multiHB.author + ' ' + JSON.stringify(data, null, 2))
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
    await delay(1000)
  }

  let diffArr = [diff0, diff1]
  let hbDiff = primary.getDiffHyperbee().createHistoryStream()
  await new Promise((resolve, reject) => {
    hbDiff.on('data', ({value}) => {
      delete value._timestamp
      delete value.obj._prevTimestamp
      t.same(value, diffArr[0])
      diffArr.shift()
    })
    hbDiff.on('end', (data) => {
      if (diffArr.length)
        t.fail()
      resolve()
    })
  })
  t.end()
})
test('Multihyperbee - crdt with 3 MultiHyperbees - automerge', async t => {
  const multiHBs = await setupReplChannel(3)
  const [ primary, secondary, tertiary ] = multiHBs

  // The delays are artificial. Without them the mesages get lost for some reason
  await put(primary, diff0, object0)
await delay(100)
  await put(primary, diff1, object1)
await delay(100)
  await put(secondary, diff1_1, object1_1)
await delay(100)
  await put(secondary, diff2, object2)
await delay(100)
  let storeArr = [object0, object1, object1_1, object2]
  for (let i=0; i<multiHBs.length; i++) {
    let multiHB = multiHBs[i]
    let counter = storeArr.length
    let sec = multiHB.createHistoryStream()
    await new Promise((resolve, reject) => {
      sec.on('data', ({value}) => {
        // console.log(multiHB.name + ' ' + JSON.stringify(data, null, 2))
        delete value._timestamp
        delete value._prevTimestamp
        let v = storeArr.find(val => isEqual(val, value))
        t.same(value, v)
        counter--
      })
      sec.on('end', (data) => {
        if (counter) {
          debugger
          t.fail()
        }
        resolve()
      })
    })
    await delay(1000)
  }
  let diffArr = [diff0, diff1, diff1_1, diff2]

  let secDiff = secondary.getDiffHyperbee().createHistoryStream()
  let primDiff = primary.getDiffHyperbee().createHistoryStream()
  let arr = [primDiff, secDiff]
  for (let i=0; i<arr.length; i++) {
    let diff = arr[i]
    await new Promise((resolve, reject) => {
      diff.on('data', ({value}) => {
        // console.log(secondary.name + 'Diff ' + JSON.stringify(data, null, 2))
        delete value._timestamp
        delete value.obj._prevTimestamp
        t.same(value, diffArr[0])
        diffArr.shift()
      })
      diff.on('end', (data) => {
        resolve()
      })
    })
  }

  if (diffArr.length)
    t.fail()
  t.end()
})

async function setupReplChannel(count) {
  const stores = await create({count, persistent: false, name: 'storeFeed'})

  let names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const feedOptions = {valueEncoding: 'json'}
  let multiHBs = []
  let cloneHBs = []
  for (let i=0; i<count; i++) {
    const store = stores[i]

    let diffStoreDir = store._storage.key.directory
    if (diffStoreDir)
      diffStoreDir += '_diff'
    else
      diffStoreDir = ram

    let [ diffFeed ] = await create({count: 1, name: diffStoreDir})

    let diffHyperbee = new Hyperbee(diffFeed, OPTIONS)

    const multiHB = await new MultiHyperbee(store, { diffHyperbee, opts: {...OPTIONS, name: names[i] }})
    multiHBs.push(multiHB)

    // debugger
    const diffKey = diffFeed.key
    const cloneFeed = await createOne(diffKey, feedOptions, 'clonePrimary')
    await promisifyAndExec(cloneFeed, 'ready')

    const cloneHB = new Hyperbee(cloneFeed, OPTIONS)
    cloneHBs.push(cloneHB)

    let pstream = diffFeed.replicate(false, {live: true})
    pstream.pipe(cloneFeed.replicate(true, {live: true})).pipe(pstream)
  }
  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    for (; j<cur; j++)
      multiHB.addHyperbee(cloneHBs[j])
    for (++j; j<multiHBs.length; j++)
      multiHB.addHyperbee(cloneHBs[j])
  }

  return multiHBs
}

async function put(hyperbee, diff, value) {
  // debugger
  let key = `${value._objectId}`
  let val = cloneDeep(value)
  if (diff)
    val._diff = cloneDeep(diff)

  await hyperbee.put(key, val)
}
