const test = require('tape')
const Hyperbee = require('hyperbee')
const ram = require('random-access-memory')
const isEqual = require('lodash/isEqual')
const cloneDeep = require('lodash/cloneDeep')

const MultiHyperbee = require('../')
const { promisifyAndExec, create, delay } = require('./helpers')
var { object0, object1, object1_1, object2,
        diff0, diff1, diff1_1, diff2 } = require('./constants')

const OPTIONS = {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
      }

test('Multihyperbee - autogen Diff object', async t => {
  let multiHBs = await setupReplChannel(2)
  let [primary, secondary] = multiHBs
  await put(primary, diff0, object0)
await delay(100)
  await put(primary, diff1, object1)
await delay(100)
  await put(secondary, diff1_1, object1_1)
await delay(100)
  let storeArr = [object0, object1, object1_1]
  for (let i=0; i<multiHBs.length; i++) {
    let multiHB = multiHBs[i]
    let sec = multiHB.createHistoryStream()
    let counter = storeArr.length
    await new Promise((resolve, reject) => {
      sec.on('data', ({value}) => {
        // console.log(multiHB.name + ' ' + JSON.stringify(value, null, 2))
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
    await delay(100)
  }
  t.end()
})

test('Multihyperbee - auto-generate diff', async t => {
  const multiHBs = await setupReplChannel(3, 'test2')
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

  let secDiff = (await secondary.getDiff()).createHistoryStream()
  let primDiff = (await primary.getDiff()).createHistoryStream()
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
  let names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  let multiHBs = []

  for (let i=0; i<count; i++) {
    multiHBs.push(new MultiHyperbee(ram, {...OPTIONS, name: names[i]}))
  }

  let cloneHBs = []
  for (let i=0; i<multiHBs.length; i++) {
    let cur = i
    let j = 0
    let multiHB = multiHBs[i]
    let diffFeed = (await multiHB.getDiff()).feed
    for (; j<multiHBs.length; j++) {
      if (j === cur) continue
      let cloneFeed = (await multiHBs[j].addPeer(diffFeed.key)).feed
      let pstream = diffFeed.replicate(false, {live: true})
      pstream.pipe(cloneFeed.replicate(true, {live: true})).pipe(pstream)
    }
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
